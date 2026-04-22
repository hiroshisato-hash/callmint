# Callmint Content Shark v2

美容室経営者向けメディア「Callmint」の自動コンテンツ生成パイプライン（Phase 1）。

## Phase 1（現在）

GitHub Actions が定時に Anthropic Claude API を叩き、note 記事 / X スレッド / Reels 台本 / Instagram キャプションを JSON で `generated/` に保存・コミットする。**SNS への自動投稿は未実装**（人間が JSON を確認して手動投稿）。

### スケジュール（JST 09:30 = UTC 00:30）

| 曜日 | テーマキー | テーマ |
| --- | --- | --- |
| 月 | `kyakutanka_up` | 客単価UP |
| 水 | `repeat_rate` | リピート率 |
| 金 | `sns_shukyaku` | SNS集客 |
| 日 | `callmint_jirei` | Callmint事例 |

火・木・土はキュレーション／セミナー記事で、ローカルで Claude Code から手動生成する想定（自動化対象外）。

### 必要 Secrets

- `ANTHROPIC_API_KEY`

その他（`X_BEARER_TOKEN` 等）は Phase 2 の投稿連携で利用予定。

### 手動実行

GitHub → Actions → "Content Shark v2 - Weekly Publish" → Run workflow。トピックを選んで即実行可能。

## Phase 2（未着手）

- note / X / Instagram への自動投稿
- 火・木・土の手動入力（URL・セミナー情報）を受け付けるフロー
