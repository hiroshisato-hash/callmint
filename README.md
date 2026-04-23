# Callmint Content Shark v2

美容室経営者向けメディア「Callmint」の自動コンテンツ生成パイプライン（**Phase γ・編集部マルチエージェント運用**）。

## 役割
GitHub Actions が定時に Anthropic Claude API（Sonnet 4.6 / Opus 4.7 / Haiku 4.5）の **5 エージェント編集部パイプライン** を起動し、週1本の本格 note 記事 + X Article + 2 本のXスレッド + 14 本の単発ツイートを生成。投稿可能なものは X に自動連投、note と X Article は人間がコピペで配信する。

## 週次運用フロー
| タイミング (JST) | 動作 | 自動/手動 |
|---|---|---|
| **日曜 22:00** | 週次バンドル生成（Phase γ + X Article + Thursday Thread + 14 singles） | 自動 cron |
| **月曜 朝** | `generated/weeks/<月曜の日付>/note.md` と `x-article.md` を確認、コピペで note と X に投稿 | 手動 |
| **月曜 10:00** | `thread-monday.json` を @callmint_beauty に自動投稿（note誘導） | 自動 cron |
| **木曜 10:00** | `thread-thursday.json`（独立トピック）を自動投稿 | 自動 cron |
| **毎日 08:00 / 21:00** | `singles.json` から最古未投稿を1本投稿 | 自動 cron |

## ワークフロー一覧
| ファイル | 役割 | cron |
|---|---|---|
| `weekly-bundle.yml` | 週次大量生成（Phase γ） | 日 22:00 JST |
| `post-x-thread.yml` | スレッド自動投稿 | 月/木 10:00 JST |
| `post-x-single.yml` | 単発ツイート自動投稿 | 毎日 08:00 / 21:00 JST |
| `manual-publish.yml` | キュレーション/セミナー記事の手動生成（火/木/土運用、任意） | なし |
| `weekly-publish.yml` | 旧 single-topic 生成（escape hatch） | 停止 |
| `post-to-x.yml` | 旧 thread 投稿（escape hatch） | 停止 |

## Phase γ パイプライン（5 エージェント）
1. **Strategy Director**（Haiku）: 切り口・読者pain・キーインサイト・フック型を決定
2. **Outliner + Title Brainstorm**（Sonnet）: 5タイトル候補と詳細アウトライン
3. **Title Selector**（Opus）: 最良タイトル1本を選定
4. **Writer**（Sonnet）: フルコンテンツ4チャネル生成
5. **Editor / Critic**（Sonnet）: ブランドガイド準拠チェック→改善版提出

`BRAND_GUIDE` は `scripts/brand-guide.mjs` で一元管理。Anthropic Prompt Caching を使い、5 エージェント間で BRAND_GUIDE 部分の入力コストを節約。

## トピックローテ
### note (3 週で一巡)
1. `kyakutanka_up`（客単価UP）
2. `repeat_rate`（リピート率）
3. `sns_shukyaku`（SNS集客）

※ Callmint 事例ができ次第追加予定。

### Thursday Thread（10 週で一巡）
スタッフマネジメント / 業界トレンド / 価格設定 / 客層分析 / メニュー設計 / 口コミ運用 / 閑散期対策 / 店舗ブランディング / チーム運営 / 予約管理

ローテ計算は 2026-01-05（月曜）を起点とした週番号 modulo。

## 出力ファイル構造
```
generated/weeks/YYYY-MM-DD/   ← その週の月曜の日付
├── meta.json                 週情報サマリ
├── note.md                   note 記事本文（人間がコピペ）
├── note.json                 Phase γ 全トレース
├── x-article.md              X Article 本文（人間がコピペ）
├── x-article.json            X Article + メタ
├── thread-monday.json        月曜投稿スレッド（note誘導）
├── thread-thursday.json      木曜投稿スレッド（独立トピック）
└── singles.json              14単発ツイートのプール
```

## Secrets
- `ANTHROPIC_API_KEY`（必須）— 生成
- `X_API_KEY` / `X_API_KEY_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`（必須）— OAuth 1.0a 投稿
- `DISCORD_WEBHOOK_URL`（任意）— 失敗通知。未設定なら通知ステップは no-op
- `INSTAGRAM_*` / `X_BEARER_TOKEN`（未使用）— 将来用

## コスト感
- 週次生成: 約30〜50円（Phase γ + X Article + Thursday Thread + 14 singles）
- 投稿: 0円（X 無料枠 月1500投稿）
- → **月200〜300円**

## Manual Publish（火/木/土の任意の追加コンテンツ）
キュレーション記事・セミナー紹介を `workflow_dispatch` で生成。
- `type`: `curation` (URL or 本文) / `seminar` (情報テキスト)
- 生成物は `generated/YYYY-MM-DD_<LABEL>.json/.md` の旧構造で出力
- 投稿させたければ post-to-x.yml の手動トリガで投稿可
