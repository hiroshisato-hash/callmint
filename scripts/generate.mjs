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
      main: {
        type: "string",
        description:
          "note記事本文（Markdown）。# H1タイトル / リード4行以内 / ## H2セクション3〜5本 / ## まとめ / 末尾にCallmint誘導ブロック。1500〜2200字。",
      },
      x_thread: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 5,
        description:
          "Xスレッド。1本目は強フック+「以下スレ🧵」、最終本はnote記事への誘導。各140字以内。",
      },
      reels_script: {
        type: "string",
        description:
          "Instagram Reels台本（30〜45秒）。6〜8シーン、各シーンに「テロップ案」と「ナレーション案」両方を書く。0〜3秒で離脱させない強フック。",
      },
      instagram_caption: {
        type: "string",
        description:
          "Instagramキャプション。200〜400字。1行目強コピー、中盤箇条書き3つ、末尾にハッシュタグ10〜15個。",
      },
    },
    required: ["main", "x_thread", "reels_script", "instagram_caption"],
  },
};

const BRAND_GUIDE = `あなたは美容室経営者向けメディア「Callmint」の編集者です。
Callmint は美容室の電話受付業務をAIが自動化するサービスを提供する事業者で、本メディアは見込み客（サロンオーナー）との関係構築が目的です。

【読者像】
- 30〜45歳のサロンオーナー or 店長
- 1〜3店舗経営、スタッフ3〜10名規模、月商150〜400万円
- 美容師として現場経験豊富、経営は手探りの部分あり
- 通勤・休憩中にスマホで読む（縦長スクロール、流し読み傾向）
- ビジネス書を大量に読むタイプではない

【トーン・ボイス】
- 先輩同業者がカウンターで話してくれる感の親しみやすさ。甘くも上から目線でもない
- 専門用語は1度だけ補足する
- 断言できる事実は断言、グレーは「〜と言われている」「経験的に」
- 押し売り禁止。Callmint の宣伝は記事末の1ブロックだけ
- 一文は80字以内を意識。連続する短文＞長い1文

【絶対NG表現】
- 「いかがでしたでしょうか」「お読みいただきありがとうございました」など常套句
- 出典のない具体数字（「○倍になる」「○%向上」「売上が3倍」）→ 出典がなければ定性化（「大きく変わる」「目に見えて改善する」など）
- 「ぜひ」「必ず」「絶対」「驚異の」「劇的に」など煽り副詞の連発
- 「〜だと思います」連発の評論家口調

【note記事 (main) の構成テンプレート】
1. # H1タイトル（25〜35字、検索キーワードを自然に含む。数字 or 問いかけ or 反転 が好ましい）
2. リード（3〜4行）：①現状の悩み共感 → ②「実は…」の反転フック → ③本文で得られる価値の予告
3. ## H2 セクション 3〜5本：各セクション 250〜400字、最後にミニ結論ライン
4. ## まとめ：箇条書き or 比較表で要点再提示
5. **末尾に「Callmintという選択肢」ブロック 4〜6行**：電話受付の負担 → AI自動化で何が変わるか → 詳しくは callmintai.com への自然導線

【Xスレッド (x_thread) の構成】
- 1本目：強フック（数字／問いかけ／反転のいずれか）＋「以下スレ🧵」
- 中間本：単体でも価値が成立する内容、絵文字は1〜2個まで
- 最終本：note記事への誘導（「詳しくはnoteにまとめました🔗」など）
- 各140字以内厳守

【Reels台本 (reels_script) の構成】
- 30〜45秒、6〜8シーン
- 0〜3秒で離脱させない強フック必須
- 各シーンに「テロップ案」と「ナレーション案」両方を書く
- 末尾に「保存して見返してね / プロフのリンクから詳しく」CTA

【Instagramキャプション (instagram_caption) の構成】
- 200〜400字
- 1行目に強コピー＋絵文字1〜2個
- 中盤に箇条書き3つ
- 末尾にハッシュタグ10〜15個（#美容室経営 #サロンオーナー #サロン集客 #美容師 など、ニッチ寄りも混ぜる）`;

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
  const prompt = `${BRAND_GUIDE}

【今回のテーマ】
${topic.title}

【今回の切り口】
${topic.angle}
${NOTES ? `\n【編集者からの追加指示】\n${NOTES}` : ""}

上記ガイドに完全準拠し、submit_content ツールを呼び出して結果を提出してください。`.trim();
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

  const prompt = `${BRAND_GUIDE}

【今回の役割】
以下の外部記事を読み、上記ガイドに沿って Callmint メディア向けの記事に再構成してください。
- 原文の丸写しは禁止。要約 + Callmint視点での解釈・示唆を加える
- 引用部分は引用と分かるよう明示
- URLがあれば「Callmintという選択肢」ブロック直前に「出典: 〜」として記す

${sourceBlock}
${NOTES ? `\n【編集者からの追加指示】\n${NOTES}` : ""}

submit_content ツールを呼び出して結果を提出してください。`.trim();

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
  const prompt = `${BRAND_GUIDE}

【今回の役割】
以下のセミナー・イベント情報をもとに、上記ガイドに沿った紹介記事を生成してください。
- 入力情報に含まれていない事実（日時・主催・場所・登壇者・費用など）を想像で追加しない
- セミナーへの参加を促すというより、「このテーマがなぜ今のサロンに重要か」を主軸に書くこと

【セミナー情報】
${SOURCE}
${NOTES ? `\n【編集者からの追加指示】\n${NOTES}` : ""}

submit_content ツールを呼び出して結果を提出してください。`.trim();

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
const mdFilename = `${date}_${filenameLabel}.md`;
writeFileSync(join("generated", mdFilename), content.main);
console.log(`Wrote generated/${filename}`);
console.log(`Wrote generated/${mdFilename}`);
