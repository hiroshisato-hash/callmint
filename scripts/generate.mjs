import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TOPIC = process.env.TOPIC || "kyakutanka_up";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const TOPICS = {
  kyakutanka_up: {
    title: "客単価UP",
    angle: "美容室経営者が客単価を引き上げるための具体策",
  },
  repeat_rate: {
    title: "リピート率",
    angle: "美容室のリピート率を改善する施策",
  },
  sns_shukyaku: {
    title: "SNS集客",
    angle: "美容室のSNS集客を成功させる方法",
  },
  callmint_jirei: {
    title: "Callmint事例",
    angle: "Callmint導入で電話受付業務を改善した美容室の事例",
  },
};

const topic = TOPICS[TOPIC];
if (!topic) {
  console.error(`Unknown topic: ${TOPIC}`);
  process.exit(1);
}

const prompt = `あなたは美容室経営者向けメディア「Callmint」の編集者です。
以下のテーマで、note記事・Xスレッド・Instagram Reels台本・Instagramキャプションを生成してください。

テーマ: ${topic.title}
切り口: ${topic.angle}

出力は次のJSONオブジェクトのみ。前置き・後書き・コードブロック記法は付けないこと。

{
  "main": "note記事本文（Markdown、1500〜2000字、見出しあり）",
  "x_thread": ["ツイート1（140字以内）", "ツイート2", "ツイート3"],
  "reels_script": "Instagram Reels台本（30〜60秒、シーン構成つき）",
  "instagram_caption": "Instagramキャプション（200〜400字、ハッシュタグ含む）"
}`;

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
    messages: [{ role: "user", content: prompt }],
  }),
});

if (!res.ok) {
  console.error(`Anthropic API error: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
const text = data?.content?.[0]?.text;
if (!text) {
  console.error("No text in API response:", JSON.stringify(data));
  process.exit(1);
}

let content;
try {
  content = JSON.parse(text);
} catch (e) {
  console.error("Failed to parse model output as JSON. Raw text:");
  console.error(text);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const filename = `${date}_ORIGINAL_${TOPIC}.json`;
mkdirSync("generated", { recursive: true });

const out = {
  generated_at: new Date().toISOString(),
  topic: TOPIC,
  topic_title: topic.title,
  model: MODEL,
  usage: data.usage ?? null,
  content,
};

writeFileSync(join("generated", filename), JSON.stringify(out, null, 2));
console.log(`Wrote generated/${filename}`);
