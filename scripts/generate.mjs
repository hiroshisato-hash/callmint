import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MODE = (process.env.MODE || "original").toLowerCase();
const TOPIC = process.env.TOPIC;
const SOURCE = process.env.SOURCE;
const NOTES = process.env.NOTES || "";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const TOPICS = {
  kyakutanka_up: { title: "客単価UP", angle: "美容室経営者が客単価を引き上げるための具体策" },
  repeat_rate: { title: "リピート率", angle: "美容室のリピート率を改善する施策" },
  sns_shukyaku: { title: "SNS集客", angle: "美容室のSNS集客を成功させる方法" },
  callmint_jirei: { title: "Callmint事例", angle: "Callmint導入で電話受付業務を改善した美容室の事例" },
};

const SUBMIT_TOOL = {
  name: "submit_content",
  description:
    "生成した4種類のコンテンツ（note記事・Xスレッド・Reels台本・Instagramキャプション）を構造化データとして提出する。必ずこのツールを呼び出して結果を返すこと。",
  input_schema: {
    type: "object",
    properties: {
      main: { type: "string", description: "note記事本文。Markdown形式。1500〜2000字。見出しあり。" },
      x_thread: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "Xスレッド。各要素は140字以内のツイート文字列。3〜5本。",
      },
      reels_script: { type: "string", description: "Instagram Reels台本。30〜60秒。シーン構成つき。" },
      instagram_caption: {
        type: "string",
        description: "Instagramキャプション。200〜400字。末尾にハッシュタグを含む。",
      },
    },
    required: ["main", "x_thread", "reels_script", "instagram_caption"],
  },
};

async function tryFetchArticle(urlOrText) {
  const s = (urlOrText || "").trim();
  if (!/^https?:\/\//i.test(s)) {
    return { kind: "text", text: s };
  }
  try {
    const r = await fetch(s, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; CallmintContentBot/1.0; +https://github.com/hiroshisato-hash/callmint)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
    return { kind: "url", url: s, text };
  } catch (e) {
    console.error(`Fetch failed for ${s}: ${e.message}. Treating input as raw text.`);
    return { kind: "text", text: s };
  }
}

function slugify(input) {
  return (
    (input || "item")
      .toString()
      .replace(/https?:\/\//, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item"
  );
}

async function buildOriginal() {
  const key = TOPIC || "kyakutanka_up";
  const topic = TOPICS[key];
  if (!topic) {
    console.error(`Unknown TOPIC: ${key}`);
    process.exit(1);
  }
  const prompt = `あなたは美容室経営者向けメディア「Callmint」の編集者です。
以下のテーマで、note記事・Xスレッド・Instagram Reels台本・Instagramキャプションを生成し、submit_content ツールを呼び出して提出してください。

テーマ: ${topic.title}
切り口: ${topic.angle}
${NOTES ? `補足: ${NOTES}` : ""}`.trim();
  return {
    prompt,
    filenameLabel: `ORIGINAL_${key}`,
    topicTitle: topic.title,
    sourceMeta: null,
  };
}

async function buildCuration() {
  if (!SOURCE) {
    console.error("SOURCE is required for MODE=curation (URL or article excerpt).");
    process.exit(1);
  }
  const article = await tryFetchArticle(SOURCE);
  const sourceBlock =
    article.kind === "url"
      ? `【引用元URL】${article.url}\n【本文抜粋（自動抽出、最大8000字）】\n${article.text}`
      : `【引用元テキスト（ユーザー入力）】\n${article.text}`;

  const prompt = `あなたは美容室経営者向けメディア「Callmint」の編集者です。
以下の外部記事を読み、美容室経営者向けに要点を整理した上で、Callmint（AI電話受付サービス）の視点を織り込んだオリジナル記事・Xスレッド・Reels台本・Instagramキャプションを生成してください。submit_content ツールで提出。

引用元の内容を丸写ししないこと。要約＋Callmint視点での解釈・示唆を加えること。引用する場合は必ず引用であることを明記し、URLがあれば本文冒頭か末尾に出典として記すこと。

${sourceBlock}
${NOTES ? `\n【編集者からの補足指示】\n${NOTES}` : ""}`.trim();

  const slug = slugify(article.kind === "url" ? article.url : article.text.slice(0, 40));
  return {
    prompt,
    filenameLabel: `CURATION_${slug}`,
    topicTitle: article.kind === "url" ? article.url : "（テキスト入力）",
    sourceMeta: article,
  };
}

async function buildSeminar() {
  if (!SOURCE) {
    console.error("SOURCE is required for MODE=seminar (seminar details text).");
    process.exit(1);
  }
  const prompt = `あなたは美容室経営者向けメディア「Callmint」の編集者です。
以下のセミナー・イベント情報を元に、美容室経営者がそのセミナーに興味を持つような紹介記事・Xスレッド・Reels台本・Instagramキャプションを生成してください。submit_content ツールで提出。

想像で事実を追加しないこと。日時・主催・場所など入力情報に含まれないものは記事に書かないこと。

【セミナー情報】
${SOURCE}
${NOTES ? `\n【補足】\n${NOTES}` : ""}`.trim();

  const slug = slugify(SOURCE.slice(0, 40));
  return {
    prompt,
    filenameLabel: `SEMINAR_${slug}`,
    topicTitle: SOURCE.slice(0, 60),
    sourceMeta: { kind: "text", text: SOURCE },
  };
}

const builders = { original: buildOriginal, curation: buildCuration, seminar: buildSeminar };
const build = builders[MODE];
if (!build) {
  console.error(`Unknown MODE: ${MODE}. Expected one of: ${Object.keys(builders).join(", ")}`);
  process.exit(1);
}

const { prompt, filenameLabel, topicTitle, sourceMeta } = await build();

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 4096,
    tools: [SUBMIT_TOOL],
    tool_choice: { type: "tool", name: "submit_content" },
    messages: [{ role: "user", content: prompt }],
  }),
});

if (!res.ok) {
  console.error(`Anthropic API error: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const toolUse = data?.content?.find((c) => c.type === "tool_use");
if (!toolUse?.input) {
  console.error("No tool_use block in API response:");
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

const content = toolUse.input;
const date = new Date().toISOString().slice(0, 10);
const filename = `${date}_${filenameLabel}.json`;
mkdirSync("generated", { recursive: true });

const out = {
  generated_at: new Date().toISOString(),
  mode: MODE,
  topic: TOPIC || null,
  topic_title: topicTitle,
  source: sourceMeta,
  model: MODEL,
  usage: data.usage ?? null,
  content,
};

writeFileSync(join("generated", filename), JSON.stringify(out, null, 2));
console.log(`Wrote generated/${filename}`);
