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

- `ANTHROPIC_API_KEY`（必須）
- `DISCORD_WEBHOOK_URL`（任意・推奨）— セットされていれば失敗時に Discord に通知。未設定なら通知ステップは no-op
- `X_BEARER_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` — 将来の自動投稿用に登録済み（現状未使用）

## 未実装（Future）

- X / Instagram への自動投稿
- note への自動投稿は note 公開API がないため対象外（手動投稿前提）
