# HUGカードデータベース管理ツール (V6.2準拠)

避難所運営ゲーム（HUG: Hinanjo Unei Game）のカードデータ（イベント・避難者グループ・世帯構成員）を一元管理し、訓練条件に応じたデッキ構築・進行度矛盾の解決・閲覧（訓練）モード・JSON/CSV入出力・バージョン管理を行うローカルWebアプリケーションです。

- **バックエンド**: Python 3.12+ / FastAPI / Uvicorn / SQLite (`data/hug.db`)
- **フロントエンド**: ビルド不要の標準 ES モジュール (`static/js/*.js`) + Vanilla CSS (`static/css/app.css`)
- **仕様準拠**:
  - `docs/HUGカードデータベース詳細設計書 V6.2.md`
  - `docs/JSON→CSV 変換ルール.md`
  - `docs/sample_format2.json`

---

## クイックスタート (Windows)

### 1. ワンクリック起動
`start.bat` をダブルクリック（またはコマンドプロンプトから実行）すると、必要に応じて仮想環境 `.venv` の構築・パッケージ導入を行ったうえでローカルサーバー（`http://127.0.0.1:8000`）を起動し、既定のブラウザを開きます。

```powershell
.\start.bat
```

### 2. 手動セットアップ・起動
```powershell
py -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn hugdb.main:app --host 127.0.0.1 --port 8000
```
ブラウザで `http://127.0.0.1:8000` を開きます。

---

## 主な機能

1. **カード一覧・多軸検索**
   - 表示種別（すべて / イベント / 世帯 / 人物 / ペット）と並び順（デッキ順 / ID順 / 更新日時順 / 優先度順）の切り替え
   - キーワード検索（NFKC正規化・スペース区切りAND検索・構成員テキスト横断検索）
   - 訓練条件フィルタ（避難所・日時・休日種別自動判定・時間帯・災害種類・インフラ状況・天候）およびスキーマ全項目の絞り込み
   - 検索結果の保存、JSON / カード画像生成用CSV（UTF-8 BOM + CRLF） / 全項目CSV(ZIP) のダウンロード
2. **カード作成・編集**
   - リアルタイム・カードプレビュー付きのイベント編集フォームおよび世帯（グループ＋構成員）一括編集フォーム
   - 単一チップのクリックで `未指定 → 合致（緑） → 排除（赤）` を切り替える3状態条件チップ
   - 循環参照を自動防止する前提カード選択と、人物・ペット別の入力項目自動切替・人数自動集計
3. **訓練用デッキ構築・進行度矛盾解決**
   - 訓練条件・対象進行度・最大イベント数・最大世帯数に基づくデッキ自動抽出・交互配置・トポロジカルソート
   - 相対発生時期と災害進行度の逆転（矛盾）を検出し、原因カードごとに「このままにする（確認済み）」「移動して解消」または「すべて進行度を優先」で解決
   - ↑↓ボタンおよびドラッグ＆ドロップによる手動並べ替え（前提カード制約違反のリアルタイム検証付き）
   - 1からの通し連番IDへの自動置換・氏名未設定構成員の決定論的自動命名を行ったデッキJSON / CSV出力
4. **閲覧（訓練）モード ＆ 台紙配置シミュレーション (`/board.html`) ＆ スマホHUG訓練シミュレーター (`/hug-game.html`)**
   - 構築したデッキを1枚ずつ全画面表示し、`←` `→` キーで前後に移動（`/training.html`・`/training-simple.html`）
   - **台紙配置シミュレーション (`/board.html` / `/board`)**:
     - デッキからカードを1枚ずつ引き、PDFの訓練用台紙（初期収録：`docs/20260716修正　5小トリアージ図.pdf`、設定で `A0の縦横4倍` / `8倍（規定）` / `16倍` 可変・名刺サイズ `55×91mm` の実寸比）の上に自由に配置・移動（重ね置き可）
     - PC（ホイール・ドラッグ）とスマホ（ピンチ・指ドラッグ・手札引き上げ）の直感操作、拡大時の高精細再描画、縮小時の周辺カード枚数バブル表示（タップで該当カード周辺へ拡大）、イベントカード等の空き場所自動配置、途中・最終配置のPDFダウンロード（GitHub Pages 直接リンク対応）
   - **スマホだけで実践できるHUG配置訓練シミュレーター (`/hug-game.html` / `/hug-game` / `/game`)**:
     - サーバ保存デッキ（`五小rev5`・`五小rev4`・`基本セット` 等）や新規作成デッキと完全連動
     - **小平市立小平第五小学校**の見取り図をベースにした6エリア・全29区画（`🗺️ 校庭・門`：正門・昇降口総合受付・渡り廊下ペット区画・事前貯留型マンホールトイレ10基・プレハブ防災倉庫・プール・校庭・ごみ/喫煙所、`🏛️ 体育館`：A〜F区画・ステージ・2m安全通路、`🏫 校舎1F`：運営本部・保健室・1F福祉教室・授乳相談室・多目的室、`🏫 校舎2F`：子育て教室・普通教室A・女性静養室・図書キッズ室、`🏫 校舎3F`：帰宅困難者室・普通教室B・第一/第二感染症隔離室、`🚑 転出/在宅`：在宅避難登録・救急搬送・福祉避難所移送・広域避難バス退所）
     - スマホ指1本で操作できるワンタップ即配置／2タップ確認配置、ペット同行避難の渡り廊下自動分離、部屋内訳・移動モーダル、1手戻す（Undo）、公式カード画像プレビュー、イベント対応（設備稼働・隔離・救急/福祉移送・区画閉鎖再配置）、および100点満点の振り返り講評レポート出力
5. **データ入出力・バージョン管理**
   - 単一JSONまたは分割JSONファイルのドラッグ＆ドロップ、ドライラン（件数・ID対応表・警告プレビュー）後の置換/追加インポート
   - 手動スナップショット作成および破壊的操作（インポート・全件削除・復元）直前の自動スナップショット（`auto_import` / `auto_clear` / `auto_restore`、最大20件保持）
   - 現在のデータベースと任意のバージョン間の差分（追加・削除・変更フィールド）比較およびワンクリック復元

---

## テストの実行方法

開発・テスト用パッケージを導入したうえで `pytest` を実行します。E2Eテストは Windows 標準の Microsoft Edge (`--browser-channel=msedge`) を使用します。

```powershell
.\.venv\Scripts\pip install -r requirements-dev.txt

# ユニットテスト＋APIテスト＋カバレッジ計測（ドメイン層 90% 以上）
.\.venv\Scripts\python -m pytest -m "not e2e" --cov=hugdb

# Playwright E2Eテストを含む全テストスイートの実行
.\.venv\Scripts\python -m pytest
```

---

## ディレクトリ構成

```text
k-hug2026/
├── hugdb/                  # バックエンドパッケージ
│   ├── main.py             # FastAPI エントリポイント・統一エラーハンドラ
│   ├── config.py           # 設定（HOST=127.0.0.1, PORT, DB_PATH, MAX_UPLOAD_BYTES）
│   ├── schema.py           # スキーマ・選択肢マスタ・キー順序定義
│   ├── validation.py       # 厳格(strict)/寛容(lenient)バリデーション・循環参照検査
│   ├── ids.py              # 単調増加ID採番・再採番・参照書き換え
│   ├── db.py               # SQLite接続・DDL・マイグレーション・トランザクション
│   ├── repository.py       # 永続化リポジトリ
│   ├── matching.py         # 訓練条件の合致/排除判定・日付期間パース
│   ├── holidays.py         # 祝日・振替休日・国民の休日・GW・年末年始判定
│   ├── filtering.py        # キーワード・項目別・訓練条件検索とソート
│   ├── ordering.py         # デッキ順序計算・交互配置・トポロジカルソート・矛盾解決
│   ├── names.py            # 氏名未設定構成員の決定論的自動命名
│   ├── deck.py             # デッキ抽出・連番ID変換・ハッシュ変更検知
│   ├── io_json.py          # JSON入出力・分割ファイル結合・ドライラン
│   ├── io_csv.py           # カード画像生成用CSV・全項目CSV(ZIP)出力
│   ├── versions.py         # バージョン管理・自動バックアップ・差分計算・復元
│   └── api/                # FastAPI ルーター群 (schema, events, households, search, io, decks, versions)
├── static/                 # ゼロビルド Vanilla JS (ES Modules) + CSS フロントエンド
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── app.js, api.js, store.js, schema.js, util.js
│       ├── components/     # toast, chips, card, modal, filterPanel, sortableList
│       └── views/          # listView, eventEditor, householdEditor, deckView, conflictPanel, trainingView, ioView, savedView, versionView
├── tests/                  # 自動テストスイート
│   ├── unit/               # ドメイン層の単体テスト (SC, VA, ID, RE, HO, MA, FI, OR, NA, DE, IJ, CS, VE, NF)
│   ├── api/                # FastAPI TestClient 結合テスト (AP-01〜22, NF-03)
│   └── e2e/                # Playwright + Edge E2Eテスト (JS-01〜04, UI-01〜27)
├── docs/                   # 設計書・変換ルール・公式サンプルデータ
├── start.bat               # Windows 起動用バッチファイル
├── requirements.txt        # 実行時依存パッケージ
├── requirements-dev.txt    # テスト・開発用依存パッケージ
└── pyproject.toml          # pytest / coverage 設定
```
