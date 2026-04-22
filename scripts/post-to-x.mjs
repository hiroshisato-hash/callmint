import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";

const API_KEY = process.env.X_API_KEY;
const API_KEY_SECRET = process.env.X_API_KEY_SECRET;
const ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;
const FILE_ENV = process.env.FILE || "";
const DRY_RUN = process.env.DRY_RUN === "true";

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

// RFC 3986 percent-encoding (stricter than encodeURIComponent).
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
  if (!res.ok) {
    throw new Error(`X API ${res.status}: ${responseText}`);
  }
  const data = JSON.parse(responseText);
  if (!data?.data?.id) {
    throw new Error(`Unexpected X API response: ${responseText}`);
  }
  return data.data.id;
}

function findLatestUnpostedFile() {
  const files = readdirSync("generated")
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  for (const f of files) {
    const p = join("generated", f);
    try {
      const j = JSON.parse(readFileSync(p, "utf-8"));
      if (j?.posted_to_x) continue;
      if (!Array.isArray(j?.content?.x_thread) || j.content.x_thread.length === 0) continue;
      return p;
    } catch (_) {
      continue;
    }
  }
  return null;
}

const filePath = FILE_ENV || findLatestUnpostedFile();
if (!filePath) {
  console.log("No unposted generated/*.json with x_thread found. Nothing to do.");
  process.exit(0);
}

console.log(`Target file: ${filePath}${DRY_RUN ? " (DRY_RUN)" : ""}`);
const data = JSON.parse(readFileSync(filePath, "utf-8"));

if (data.posted_to_x) {
  console.log(`Already posted: ${filePath}`);
  process.exit(0);
}
const thread = data?.content?.x_thread;
if (!Array.isArray(thread) || thread.length === 0) {
  console.error(`No x_thread in ${filePath}`);
  process.exit(1);
}

const tweetIds = [];
let prevId = null;
for (let i = 0; i < thread.length; i++) {
  const text = String(thread[i]).trim();
  if (!text) continue;
  console.log(`Posting tweet ${i + 1}/${thread.length} (${text.length}字)...`);
  const id = await postTweet(text, prevId);
  tweetIds.push(id);
  prevId = id;
  if (i < thread.length - 1) await new Promise((r) => setTimeout(r, 1500));
}

if (!DRY_RUN) {
  data.posted_to_x = true;
  data.x_thread_tweet_ids = tweetIds;
  data.x_posted_at = new Date().toISOString();
  writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Marked posted: ${filePath}`);
}
console.log(`Done. Tweet IDs: ${tweetIds.join(", ")}`);
