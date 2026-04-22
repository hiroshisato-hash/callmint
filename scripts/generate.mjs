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

const SUBMIT_TOOL = {
  name: "submit_content",
  description:
    "生成した4種類のコンテンツ（note記事・Xスレッド・Reels台本・Instagramキャプション）を構造化データとして提出する。必ずこのツールを呼び出して結果を返すこと。",
  input_schema: {
    type: "object",
    properties: {
      main: {
        type: "string",
        description: "note記事本文。Markdown形式。1500〜2000字。見出しあり。",
      },
      x_thread: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description: "Xスレッド。各要素は140字以内のツイート文字列。3〜5本。",
      },
      reels_script: {
        type: "string",
        description: "Instagram Reels台本。30〜60秒。シーン構成つき。",
      },
      instagram_caption: {
        type: "string",
        description: "Instagramキャプション。200〜400字。末尾にハッシュタグを含む。",
      },
    },
    required: ["main", "x_thread", "reels_script", "instagram_caption"],
  },
};

const prompt = `あなたは美容室経営者向けメディア「Callmint」の編集者です。
以下のテーマで、note記事・Xスレッド・Instagram Reels台本・Instagramキャプションを生成し、submit_content ツールを呼び出して提出してください。

テーマ: ${topic.title}
切り口: ${topic.angle}`;

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
