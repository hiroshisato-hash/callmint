import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const MODE = (process.env.MODE || "thread").toLowerCase(); // "thread" | "single"
const FILE_ENV = process.env.FILE || "";
const WEEK_DIR_ENV = process.env.WEEK_DIR || "";
const DRY_RUN = process.env.DRY_RUN === "true";

const API_KEY = process.env.X_API_KEY;
const API_KEY_SECRET = process.env.X_API_KEY_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

if (!DRY_RUN) {
  const missing = [
    ["X_API_KEY", API_KEY],
    ["X_API_KEY_SECRET", API_KEY_SECRET],
    ["X_ACCESS_TOKEN", ACCESS_TOKEN],
    ["X_ACCESS_TOKEN_SECRET", ACCESS_TOKEN_SECRET],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.error(`Missing X OAuth 1.0a secrets: ${missing.join(", ")}`);
    process.exit(1);
  }
}

// ---- OAuth 1.0a signing ----

function pct(s) {
  return encodeURIComponent(String(s)).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildOAuthHeader(method, url) {
  const params = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${pct(k)}=${pct(params[k])}`)
    .join("&");
  const baseString = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const signingKey = `${pct(API_KEY_SECRET)}&${pct(ACCESS_TOKEN_SECRET)}`;
  const signature = createHmac("sha1", signingKey).update(baseString).digest("base64");
  const full = { ...params, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(full)
      .sort()
      .map((k) => `${pct(k)}="${pct(full[k])}"`)
      .join(", ")
  );
}

async function postTweet(text, inReplyToTweetId = null) {
  const url = "https://api.x.com/2/tweets";
  const body = { text };
  if (inReplyToTweetId) body.reply = { in_reply_to_tweet_id: inReplyToTweetId };

  if (DRY_RUN) {
    console.log(`[DRY_RUN] Would post (${text.length}字): ${text}`);
    return `dryrun-${randomBytes(4).toString("hex")}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: buildOAuthHeader("POST", url),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseText = await res.text();
  if (!res.ok) throw new Error(`X API ${res.status}: ${responseText}`);
  const data = JSON.parse(responseText);
  if (!data?.data?.id) throw new Error(`Unexpected X API response: ${responseText}`);
  return data.data.id;
}

// ---- file discovery ----

// Defensive: handle JSON files where `tweets` was accidentally stringified by the LLM.
function coerceTweets(j) {
  if (j && typeof j.tweets === "string") {
    try {
      const parsed = JSON.parse(j.tweets);
      if (Array.isArray(parsed)) {
        j.tweets = parsed;
        console.warn(`[coerce] tweets recovered from JSON-string`);
      }
    } catch {
      // leave as-is; will fail downstream with a clear error
    }
  }
  return j;
}

function findLatestWeekDir() {
  const root = join("generated", "weeks");
  try {
    const dirs = readdirSync(root)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .filter((d) => statSync(join(root, d)).isDirectory())
      .sort()
      .reverse();
    return dirs.length ? join(root, dirs[0]) : null;
  } catch {
    return null;
  }
}

function findLegacyLatestUnposted() {
  // Fallback for old generated/*.json files at root
  const dir = "generated";
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    for (const f of files) {
      const p = join(dir, f);
      try {
        const j = JSON.parse(readFileSync(p, "utf-8"));
        if (j?.posted_to_x) continue;
        const tweets = j?.content?.x_thread || j?.tweets;
        if (!Array.isArray(tweets) || tweets.length === 0) continue;
        return { path: p, tweets, structure: "legacy" };
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ---- thread mode ----

async function runThreadMode() {
  let target = null;

  if (FILE_ENV) {
    const j = coerceTweets(JSON.parse(readFileSync(FILE_ENV, "utf-8")));
    if (j.posted_to_x) {
      console.log(`Already posted: ${FILE_ENV}`);
      return;
    }
    const tweets = j.tweets || j.content?.x_thread;
    if (!Array.isArray(tweets) || tweets.length === 0) {
      throw new Error(`No tweets in ${FILE_ENV}`);
    }
    target = { path: FILE_ENV, tweets, json: j };
  } else {
    // Try latest week dir first, then legacy
    const weekDir = WEEK_DIR_ENV || findLatestWeekDir();
    if (weekDir) {
      // Pick the right thread for today (Mon=monday, Thu=thursday)
      const dow = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCDay(); // JST
      const dayKey = dow === 4 ? "thursday" : "monday";
      const path = join(weekDir, `thread-${dayKey}.json`);
      try {
        const j = coerceTweets(JSON.parse(readFileSync(path, "utf-8")));
        if (!j.posted_to_x && Array.isArray(j.tweets) && j.tweets.length) {
          target = { path, tweets: j.tweets, json: j };
        }
      } catch {
        // Thread file missing or bad; fallthrough
      }
    }
    if (!target) {
      const legacy = findLegacyLatestUnposted();
      if (legacy) {
        const j = JSON.parse(readFileSync(legacy.path, "utf-8"));
        target = { path: legacy.path, tweets: legacy.tweets, json: j };
      }
    }
  }

  if (!target) {
    console.log("No unposted thread found. Nothing to do.");
    return;
  }

  console.log(`Target: ${target.path} (${target.tweets.length} tweets)${DRY_RUN ? " DRY_RUN" : ""}`);
  const tweetIds = [];
  let prevId = null;
  for (let i = 0; i < target.tweets.length; i++) {
    const text = String(target.tweets[i]).trim();
    if (!text) continue;
    console.log(`Posting ${i + 1}/${target.tweets.length} (${text.length}字)...`);
    const id = await postTweet(text, prevId);
    tweetIds.push(id);
    prevId = id;
    if (i < target.tweets.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  if (!DRY_RUN) {
    target.json.posted_to_x = true;
    target.json.x_thread_tweet_ids = tweetIds;
    target.json.x_posted_at = new Date().toISOString();
    writeFileSync(target.path, JSON.stringify(target.json, null, 2));
  }
  console.log(`Done. Tweet IDs: ${tweetIds.join(", ")}`);
}

// ---- single mode ----

async function runSingleMode() {
  const weekDir = WEEK_DIR_ENV || findLatestWeekDir();
  if (!weekDir) {
    console.log("No week directory found. Nothing to do.");
    return;
  }
  const singlesPath = join(weekDir, "singles.json");
  let pool;
  try {
    pool = JSON.parse(readFileSync(singlesPath, "utf-8"));
  } catch (e) {
    console.log(`No singles.json at ${singlesPath}: ${e.message}`);
    return;
  }
  const tweets = pool.tweets || [];
  const idx = tweets.findIndex((t) => !t.posted_to_x);
  if (idx === -1) {
    console.log(`All ${tweets.length} singles already posted in ${singlesPath}.`);
    return;
  }

  const t = tweets[idx];
  console.log(
    `Single ${idx + 1}/${tweets.length} [${t.mode}/${t.topic_label}] (${t.text.length}字)${DRY_RUN ? " DRY_RUN" : ""}`,
  );
  const id = await postTweet(t.text);

  if (!DRY_RUN) {
    tweets[idx] = {
      ...t,
      posted_to_x: true,
      tweet_id: id,
      x_posted_at: new Date().toISOString(),
    };
    pool.tweets = tweets;
    writeFileSync(singlesPath, JSON.stringify(pool, null, 2));
  }
  console.log(`Done. Tweet ID: ${id}`);
}

// ---- entry ----

if (MODE === "thread") {
  await runThreadMode();
} else if (MODE === "single") {
  await runSingleMode();
} else {
  console.error(`Unknown MODE: ${MODE}. Expected: thread | single`);
  process.exit(1);
}
