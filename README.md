# Callmint Content Shark v2

美容室経営者向けメディア「Callmint」の自動コンテンツ生成パイプライン。

GitHub Actions が Anthropic Claude API（`claude-sonnet-4-6`、tool use で構造化出力）を叩き、note 記事 / X スレッド / Reels 台本 / Instagram キャプションを JSON で `generated/` に保存・コミットします。**SNS への自動投稿は未実装**（人間が JSON を確認して手動投稿する運用）。

## ワークフロー一覧

### 1. Weekly Publish（自動・cron）
`.github/workflows/weekly-publish.yml`

| 曜日 | テーマキー | テーマ | 実行 |
| --- | --- | --- | --- |
| 月 09:30 JST | `kyakutanka_up` | 客単価UP | 自動 |
| 水 09:30 JST | `repeat_rate` | リピート率 | 自動 |
| 金 09:30 JST | `sns_shukyaku` | SNS集客 | 自動 |
| 日 09:30 JST | `callmint_jirei` | Callmint事例 | 自動 |

手動実行も可：Actions → "Content Shark v2 - Weekly Publish" → Run workflow → topic を選択。

### 3. Post to X（手動・将来的に cron 化）
`.github/workflows/post-to-x.yml`

`generated/*.json` の中で未投稿のものを取り出し、`content.x_thread[]` を X（旧Twitter）に**返信チェーン**で連投する。投稿成功後、元 JSON に `posted_to_x: true` / `x_thread_tweet_ids: [...]` / `x_posted_at` を追記してコミット。

| Input | 内容 |
| --- | --- |
| `file` | `generated/2026-04-22_ORIGINAL_kyakutanka_up.json` のような具体パス。空欄なら最新の未投稿ファイルを自動選択 |
| `dry_run` | `true` にすると実際には投稿せずログだけ出す（認証確認用） |

デフォルトでは cron はコメントアウト済み。動作確認できたら `post-to-x.yml` の `schedule:` ブロックを有効化すると毎日 JST 10:00 に自動投稿。

### 2. Manual Publish（手動・火/木/土運用）
`.github/workflows/manual-publish.yml`

火/木/土のキュレーション記事・セミナー紹介記事を生成。Actions → "Content Shark v2 - Manual Publish" → Run workflow。

| Input | 内容 |
| --- | --- |
| `type` | `curation`（キュレーション）or `seminar`（セミナー紹介） |
| `source` | curation: 記事URL（自動fetchを試行）or 本文抜粋テキスト / seminar: セミナー情報テキスト |
| `notes` | （任意）切り口メモ・追加指示 |

curation で URL を渡した場合、ランナーが HTML を取得しタグを除いてテキスト抽出（最大8000字）して Claude に渡します。fetch に失敗する場合は本文を貼り付けてください（日経・ダイヤモンド等は bot ブロックで失敗する可能性あり）。

## 出力ファイル

`generated/YYYY-MM-DD_<LABEL>.json`

- `ORIGINAL_<topic>` — Weekly Publish
- `CURATION_<slug>` — Manual / curation
- `SEMINAR_<slug>` — Manual / seminar

各ファイルは `content.main` / `content.x_thread[]` / `content.reels_script` / `content.instagram_caption` を含みます。

## Secrets

- `ANTHROPIC_API_KEY`（必須）— 生成用
- `DISCORD_WEBHOOK_URL`（任意・推奨）— セットされていれば失敗時に Discord に通知。未設定なら通知ステップは no-op
- X 自動投稿用（Post to X ワークフローを使うなら必須）— OAuth 1.0a User Context の4点セット:
  - `X_API_KEY`（Consumer Key）
  - `X_API_KEY_SECRET`（Consumer Secret）
  - `X_ACCESS_TOKEN`
  - `X_ACCESS_TOKEN_SECRET`
- `X_BEARER_TOKEN`（既存・未使用）— Bearer Token だけでは投稿できないので Post to X では使わない
- `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`（既存・未使用）— Instagram 自動投稿用

## 未実装（Future）

- X / Instagram への自動投稿
- note への自動投稿は note 公開API がないため対象外（手動投稿前提）
