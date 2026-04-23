import { writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BRAND_GUIDE,
  TOPICS,
  NOTE_ROTATION,
  THURSDAY_THREAD_TOPICS,
  SINGLE_TWEET_TOPICS,
} from "./brand-guide.mjs";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const NOTE_TOPIC_OVERRIDE = process.env.NOTE_TOPIC || ""; // optional

const MODEL_HAIKU = "claude-haiku-4-5-20251001";
const MODEL_SONNET = "claude-sonnet-4-6";
const MODEL_OPUS = "claude-opus-4-7";

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

// ---- helpers ----

function nextMondayDateJST(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dow = jst.getUTCDay();
  let days;
  if (dow === 0) days = 1; // Sun -> next Mon
  else if (dow === 1) days = 0; // Mon -> today
  else days = 8 - dow; // Tue-Sat -> next Mon
  jst.setUTCDate(jst.getUTCDate() + days);
  return jst.toISOString().slice(0, 10);
}

function rotationIndexForDate(dateStr, listLen) {
  // Stable rotation: weeks since 2026-01-05 (a Monday) modulo list length
  const epoch = new Date("2026-01-05T00:00:00Z").getTime();
  const target = new Date(dateStr + "T00:00:00Z").getTime();
  const weeks = Math.floor((target - epoch) / (7 * 24 * 60 * 60 * 1000));
  return ((weeks % listLen) + listLen) % listLen;
}

const cachedSystem = [
  {
    type: "text",
    text: BRAND_GUIDE,
    cache_control: { type: "ephemeral" },
  },
];

// Defensive: deeply walk the result and JSON.parse any string that looks like JSON.
// Handles cases where the LLM stringifies arrays or nested objects despite tool schema.
function deepCoerceStrings(value) {
  if (Array.isArray(value)) return value.map(deepCoerceStrings);
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = deepCoerceStrings(value[k]);
    return value;
  }
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return deepCoerceStrings(JSON.parse(t));
      } catch {
        // not parseable — leave as raw string
      }
    }
  }
  return value;
}

async function callClaude({ model, userPrompt, tool, maxTokens = 4096, retries = 1 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: cachedSystem,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const toolUse = data?.content?.find((c) => c.type === "tool_use");
  if (!toolUse?.input) {
    if (retries > 0) {
      console.warn(`[retry] No tool_use in response, retrying (${retries} left)...`);
      return callClaude({ model, userPrompt, tool, maxTokens, retries: retries - 1 });
    }
    throw new Error(`No tool_use in response: ${JSON.stringify(data)}`);
  }
  const result = deepCoerceStrings(toolUse.input);
  return { result, usage: data.usage, model };
}

// ---- tool schemas ----

const STRATEGY_TOOL = {
  name: "submit_strategy",
  description: "今週のコンテンツ戦略を提出",
  input_schema: {
    type: "object",
    properties: {
      angle: { type: "string", description: "今週の切り口の具体化（200字以内）" },
      primary_pain_point: { type: "string", description: "読者の最大の悩み（100字以内）" },
      key_insight: { type: "string", description: "この記事で伝える1つの核心的洞察（200字以内）" },
      hook_style: {
        type: "string",
        enum: ["number", "question", "contrarian", "story"],
        description: "オープニングフックの型",
      },
      secondary_keywords: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "SEOで意識するキーワード3〜5個",
      },
    },
    required: ["angle", "primary_pain_point", "key_insight", "hook_style", "secondary_keywords"],
  },
};

const OUTLINE_TOOL = {
  name: "submit_outline",
  description: "5つのタイトル候補と詳細アウトラインを提出",
  input_schema: {
    type: "object",
    properties: {
      title_candidates: {
        type: "array",
        items: { type: "string" },
        minItems: 5,
        maxItems: 5,
        description: "5つのタイトル候補（各25〜35字、フックの型違いで多様性確保）",
      },
      outline: {
        type: "object",
        properties: {
          lead_bullets: {
            type: "array",
            items: { type: "string" },
            minItems: 3,
            maxItems: 4,
            description: "リード3〜4行の各行（共感→反転→価値予告）",
          },
          h2_sections: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                key_points: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
                mini_conclusion: { type: "string" },
              },
              required: ["title", "key_points", "mini_conclusion"],
            },
          },
          summary_format: { type: "string", enum: ["table", "checklist", "list"] },
          cta_angle: { type: "string", description: "末尾Callmint誘導ブロックの切り口" },
        },
        required: ["lead_bullets", "h2_sections", "summary_format", "cta_angle"],
      },
    },
    required: ["title_candidates", "outline"],
  },
};

const SELECT_TOOL = {
  name: "submit_title_choice",
  description: "5タイトル候補から最良の1本を選定",
  input_schema: {
    type: "object",
    properties: {
      chosen_title: { type: "string" },
      reasoning: { type: "string", description: "なぜこのタイトルがクリックされやすいかの理由" },
      ranking: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            score: { type: "integer" },
            reason: { type: "string" },
          },
        },
      },
    },
    required: ["chosen_title", "reasoning"],
  },
};

const CONTENT_TOOL = {
  name: "submit_content",
  description: "完成した4チャネルコンテンツを提出",
  input_schema: {
    type: "object",
    properties: {
      main: {
        type: "string",
        description:
          "note記事本文（Markdown）。# H1 / リード / ## H2×3〜5（各末にミニ結論）/ ## まとめ / Callmint誘導。1500〜2200字。",
      },
      x_thread: {
        type: "array",
        items: { type: "string" },
        minItems: 4,
        maxItems: 5,
        description:
          "Xスレッド。1本目フック+🧵、最終本noteへの誘導。各140字以内。**この値は文字列の配列として直接返すこと。配列を JSON 文字列にエンコードして返してはいけない。**",
      },
      reels_script: {
        type: "string",
        description: "Reels台本（30〜45秒、6〜8シーン、各テロップ＋ナレーション両方）",
      },
      instagram_caption: {
        type: "string",
        description: "Instagramキャプション 200〜400字、末尾にハッシュタグ10〜15個",
      },
    },
    required: ["main", "x_thread", "reels_script", "instagram_caption"],
  },
};

const X_ARTICLE_TOOL = {
  name: "submit_x_article",
  description: "X Article 形式の長文記事を提出",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "X Article のタイトル（30〜45字、目を引くもの）" },
      body: {
        type: "string",
        description:
          "X Article 本文（Markdown）。noteよりpunchy・セクション短め・テキスト密度高め。1200〜1800字。最後に強CTA。",
      },
    },
    required: ["title", "body"],
  },
};

const THREAD_TOOL = {
  name: "submit_thread",
  description: "Xスレッド（4〜5ツイート）を提出。配列ではなく個別フィールドで返す。",
  input_schema: {
    type: "object",
    properties: {
      tweet_1: { type: "string", description: "1本目（強フック+🧵、140字以内）" },
      tweet_2: { type: "string", description: "2本目（140字以内）" },
      tweet_3: { type: "string", description: "3本目（140字以内）" },
      tweet_4: { type: "string", description: "4本目 or 締め（140字以内）" },
      tweet_5: { type: "string", description: "5本目（任意、140字以内、不要なら空文字）" },
      topic_label: { type: "string" },
    },
    required: ["tweet_1", "tweet_2", "tweet_3", "tweet_4", "topic_label"],
  },
};

const TWEET_POOL_TOOL = {
  name: "submit_tweet_pool",
  description: "14本の単発ツイートを提出",
  input_schema: {
    type: "object",
    properties: {
      tweets: {
        type: "array",
        minItems: 14,
        maxItems: 14,
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "本文140字以内" },
            mode: {
              type: "string",
              enum: ["tip", "question", "observation"],
              description: "tip=具体ノウハウ / question=問いかけ / observation=共感・洞察",
            },
            topic_label: { type: "string" },
          },
          required: ["text", "mode", "topic_label"],
        },
      },
    },
    required: ["tweets"],
  },
};

// ---- pipeline steps ----

async function runPhaseGamma(topicKey) {
  const topic = TOPICS[topicKey];
  if (!topic) throw new Error(`Unknown topic: ${topicKey}`);

  console.log(`\n[1/5] Strategy Director (${MODEL_HAIKU})...`);
  const strategy = await callClaude({
    model: MODEL_HAIKU,
    userPrompt: `今週のテーマ「${topic.title}」、切り口の出発点「${topic.angle}」。\nブランドガイドの読者像を踏まえ、submit_strategy ツールで戦略を提出してください。`,
    tool: STRATEGY_TOOL,
    maxTokens: 1024,
  });
  console.log(`  → angle: ${strategy.result.angle.slice(0, 60)}...`);
  console.log(`  → hook: ${strategy.result.hook_style}`);

  console.log(`[2/5] Outliner + Title Brainstorm (${MODEL_SONNET})...`);
  const outline = await callClaude({
    model: MODEL_SONNET,
    userPrompt: `今週のテーマ「${topic.title}」。
戦略:
${JSON.stringify(strategy.result, null, 2)}

5つのタイトル候補（フックの型を散らす）と、note記事用の詳細アウトラインを submit_outline ツールで提出してください。`,
    tool: OUTLINE_TOOL,
    maxTokens: 2500,
  });
  if (!outline.result.outline?.h2_sections) {
    console.error("Outline result malformed:", JSON.stringify(outline.result, null, 2));
    throw new Error("Outline missing outline.h2_sections");
  }
  console.log(`  → 5 titles, ${outline.result.outline.h2_sections.length} sections`);

  console.log(`[3/5] Title Selector (${MODEL_OPUS})...`);
  const selected = await callClaude({
    model: MODEL_OPUS,
    userPrompt: `テーマ: ${topic.title}
タイトル候補:
${outline.result.title_candidates.map((t, i) => `${i + 1}. ${t}`).join("\n")}

ブランドガイドの読者像（30-45歳サロンオーナー、スマホで流し読み）を考慮し、最も「クリックして読みたくなる」1本を選定してください。submit_title_choice ツールで提出。`,
    tool: SELECT_TOOL,
    maxTokens: 1500,
  });
  console.log(`  → chosen: "${selected.result.chosen_title}"`);

  console.log(`[4/5] Writer (${MODEL_SONNET})...`);
  const draft = await callClaude({
    model: MODEL_SONNET,
    userPrompt: `今週のテーマ: ${topic.title}
戦略: ${JSON.stringify(strategy.result)}
選ばれたタイトル: ${selected.result.chosen_title}
アウトライン: ${JSON.stringify(outline.result.outline)}

このタイトルとアウトラインに沿って、note記事 + Xスレッド + Reels台本 + Instagramキャプションを作成し、submit_content ツールで提出してください。
- 必ずブランドガイドの構成テンプレと NG表現リストを遵守
- アウトラインの各H2セクションのキーポイントを本文に反映、ミニ結論ラインも忘れずに
- 末尾Callmint誘導ブロックは戦略の cta_angle を踏まえる`,
    tool: CONTENT_TOOL,
    maxTokens: 4096,
  });
  console.log(`  → draft main: ${draft.result.main.length}字, x_thread: ${draft.result.x_thread.length}本`);

  console.log(`[5/5] Editor / Critic (${MODEL_SONNET})...`);
  const final = await callClaude({
    model: MODEL_SONNET,
    userPrompt: `あなたは Callmint メディアの編集長です。以下のドラフトを「ブランドガイド準拠」「読者を逃がさない構成」の観点から徹底的にレビューし、改善した最終版を submit_content ツールで提出してください。

【戦略】
${JSON.stringify(strategy.result)}

【ドラフト】
${JSON.stringify(draft.result)}

【改善観点】
- ブランドガイドのNG表現が混じっていないか（「いかがでしたか」「ぜひ」「絶対」など）
- リードの3段構え（共感→反転→価値予告）になっているか
- 各H2末のミニ結論ラインがあるか
- Xスレッド1本目のフックが弱くないか、最終本のnote誘導が自然か
- CTAブロックが押し売りになっていないか
- 論理の飛躍・冗長な部分はないか

問題があれば修正、なくてもタイトル・冒頭・締めは1段階磨いて提出してください。`,
    tool: CONTENT_TOOL,
    maxTokens: 4096,
  });
  console.log(`  → final main: ${final.result.main.length}字`);

  return {
    strategy: strategy.result,
    title_candidates: outline.result.title_candidates,
    outline: outline.result.outline,
    title_choice: selected.result,
    draft: draft.result,
    final: final.result,
    usages: [strategy.usage, outline.usage, selected.usage, draft.usage, final.usage],
  };
}

async function generateXArticle(topic, noteFinal, strategy) {
  console.log(`\n[X Article] Rewriting for X format (${MODEL_SONNET})...`);
  const result = await callClaude({
    model: MODEL_SONNET,
    userPrompt: `以下のnote記事を、X Article（X長文記事）形式にリライトしてください。

【元のnote記事】
${noteFinal.main}

【リライト指針】
- 中心メッセージ・骨子は同じ
- noteより「punchy」「セクションタイトル短め」「画像なし前提でテキスト密度高め」
- 段落は2〜3行ごとに改行（X 上は縦長スマホ閲覧）
- 末尾CTAは note より直接的に「callmintai.com で詳しく」
- 1200〜1800字
- タイトルは別に付ける（30〜45字、X タイムラインで指が止まる強さ）

submit_x_article ツールで提出。`,
    tool: X_ARTICLE_TOOL,
    maxTokens: 4096,
  });
  console.log(`  → title: "${result.result.title}", body ${result.result.body.length}字`);
  return result;
}

async function generateThursdayThread(weekStartDate) {
  const idx = rotationIndexForDate(weekStartDate, THURSDAY_THREAD_TOPICS.length);
  const topic = THURSDAY_THREAD_TOPICS[idx];
  console.log(`\n[Thursday Thread] Topic: ${topic.title} (${MODEL_SONNET})...`);
  const result = await callClaude({
    model: MODEL_SONNET,
    userPrompt: `木曜日に投稿する独立Xスレッドを作成してください。今週のnote記事とは別トピックです。

【トピック】
${topic.title}（${topic.angle}）

【スレッド要件】
- 4〜5ツイート
- 1本目: 強フック（数字 / 問いかけ / 反転）+「以下スレ🧵」
- 中間: 単体でも価値が成立する具体ノウハウ
- 最終本: 「保存しておいて損はない」「他の話題はプロフから」など、リプ・保存・フォロー誘導
- note誘導はしない（単発スレ）
- 各140字以内厳守

submit_thread ツールで提出。topic_label には「${topic.title}」を入れる。

**重要**: tweet_1, tweet_2, tweet_3, tweet_4, tweet_5 はそれぞれ個別の文字列フィールドです。配列ではなく個別の文字列として返してください。`,
    tool: THREAD_TOOL,
    maxTokens: 2000,
  });
  // Convert individual tweet_N fields back to an array for downstream code
  const tweets = [
    result.result.tweet_1,
    result.result.tweet_2,
    result.result.tweet_3,
    result.result.tweet_4,
    result.result.tweet_5,
  ].filter((t) => t && String(t).trim());
  console.log(`  → ${tweets.length} tweets`);
  return { result: { ...result.result, tweets }, usage: result.usage, model: result.model, topic_meta: topic };
}

async function generateTweetPool() {
  console.log(`\n[Tweet Pool] Generating 14 single tweets (${MODEL_SONNET})...`);
  const result = await callClaude({
    model: MODEL_SONNET,
    userPrompt: `美容室経営者向けのX単発ツイートを **14本** 生成してください。

【内訳】
- tip系: 5本（具体的なノウハウ・行動指針、断言調）
- question系: 5本（読者への問いかけ、リプ誘発）
- observation系: 4本（業界観察・共感・気づき、人柄醸成）

【話題プール】（自由に組み合わせ・発想元として使う）
${SINGLE_TWEET_TOPICS.join(" / ")}

【重要ルール】
- 各ツイートは独立で価値が成立すること
- 14本通して話題を散らすこと（同じ話題2本以上禁止）
- ブランドガイドの NG表現禁止
- 各140字以内厳守
- 1日2本×7日 で投稿される想定なので、時刻違いで連投してもうるさくない

submit_tweet_pool ツールで提出。**tweets フィールドは必ずオブジェクトの配列として直接返すこと（JSON文字列化禁止）。**`,
    tool: TWEET_POOL_TOOL,
    maxTokens: 3500,
  });
  console.log(`  → ${result.result.tweets.length} tweets generated`);
  return result;
}

// ---- orchestration ----

const weekStart = nextMondayDateJST();
const noteIdx = rotationIndexForDate(weekStart, NOTE_ROTATION.length);
const noteTopicKey = NOTE_TOPIC_OVERRIDE || NOTE_ROTATION[noteIdx];

console.log(`\n=== Weekly Bundle Generation ===`);
console.log(`Week start (Monday JST): ${weekStart}`);
console.log(`Note topic: ${noteTopicKey} (${TOPICS[noteTopicKey].title})`);

const weekDir = join("generated", "weeks", weekStart);
mkdirSync(weekDir, { recursive: true });

// Run pipeline
const phaseGamma = await runPhaseGamma(noteTopicKey);
const xArticle = await generateXArticle(noteTopicKey, phaseGamma.final, phaseGamma.strategy);
const thursdayThread = await generateThursdayThread(weekStart);
const tweetPool = await generateTweetPool();

// Write outputs

writeFileSync(
  join(weekDir, "note.md"),
  phaseGamma.final.main,
);

writeFileSync(
  join(weekDir, "note.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      week_start: weekStart,
      topic: noteTopicKey,
      topic_title: TOPICS[noteTopicKey].title,
      strategy: phaseGamma.strategy,
      title_candidates: phaseGamma.title_candidates,
      title_choice: phaseGamma.title_choice,
      outline: phaseGamma.outline,
      draft: phaseGamma.draft,
      final: phaseGamma.final,
      usages: phaseGamma.usages,
    },
    null,
    2,
  ),
);

writeFileSync(join(weekDir, "x-article.md"), `# ${xArticle.result.title}\n\n${xArticle.result.body}`);
writeFileSync(
  join(weekDir, "x-article.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      week_start: weekStart,
      topic: noteTopicKey,
      title: xArticle.result.title,
      body: xArticle.result.body,
      usage: xArticle.usage,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(weekDir, "thread-monday.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      week_start: weekStart,
      topic: noteTopicKey,
      topic_title: TOPICS[noteTopicKey].title,
      tweets: phaseGamma.final.x_thread,
      posted_to_x: false,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(weekDir, "thread-thursday.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      week_start: weekStart,
      topic: thursdayThread.topic_meta.key,
      topic_title: thursdayThread.topic_meta.title,
      tweets: thursdayThread.result.tweets,
      posted_to_x: false,
      usage: thursdayThread.usage,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(weekDir, "singles.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      week_start: weekStart,
      tweets: tweetPool.result.tweets.map((t) => ({ ...t, posted_to_x: false })),
      usage: tweetPool.usage,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(weekDir, "meta.json"),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      week_start: weekStart,
      note_topic: noteTopicKey,
      note_title: phaseGamma.title_choice.chosen_title,
      x_article_title: xArticle.result.title,
      thursday_thread_topic: thursdayThread.topic_meta.title,
      pipeline: "phase-gamma",
      models_used: [MODEL_HAIKU, MODEL_SONNET, MODEL_OPUS],
    },
    null,
    2,
  ),
);

console.log(`\n=== Done ===`);
console.log(`Week dir: ${weekDir}`);
console.log(`Files written:`);
console.log(`  - note.md / note.json`);
console.log(`  - x-article.md / x-article.json`);
console.log(`  - thread-monday.json`);
console.log(`  - thread-thursday.json`);
console.log(`  - singles.json (14 tweets)`);
console.log(`  - meta.json`);
