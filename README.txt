Koeito（コエイト）— 開発者向け README（Windows 11）
顧客の声を、根拠のある提案へ。 / 版 1.0.0 / UTF-8

フォルダー構成
  R01_Koeito/   企画パック（入力。変更しない。フォント・ロゴ等の正本）
  app/          アプリ本体（React + TypeScript + Vite / Electron / PWA）
  docs/         SPEC・TASKS・DECISIONS・TEST_REPORT
  release-docs/ 購入者向け文書の原稿（make-release で release/ へコピー）
  marketing/    販売ページ原稿（DRAFT）・主張と証拠の台帳
  seller/       販売者向け手順（ライセンス発行・署名・運用・サポート方針案）
  HANDOFF_TO_CODEX.txt  引継ぎ

1. 準備（PowerShell。管理者権限・実行ポリシー変更は通常不要）
  - Node.js LTS（24.x 推奨。22.12 以上で動作確認）と Git をインストール。
      winget install OpenJS.NodeJS.LTS
      winget install Git.Git
  - 展開先の例： C:\work\koeito （PATH や HOME をプロジェクト都合で書き換えない）

2. 依存関係（開発者のみ。購入者には不要）
  cd C:\work\koeito\app
  npm ci
  npx playwright install chromium        # E2E試験用ブラウザ（初回のみ）

3. 主なコマンド（すべて app\package.json に実在）
  npm run dev            Web版の開発サーバー http://localhost:5173/ （試験鍵の試験ビルド）
  npm run dev:desktop    ビルドして Electron（Windows版）を起動
  npm run typecheck      TypeScript 型検査（renderer + Electron）
  npm run test           単体試験（Vitest）
  npm run test:e2e       ビルド + E2E（Playwright / Chromium + Electron）
  npm run build          Web版の試験ビルド（dist\）
  npm run build:pwa      PWA配布zip。release-config.json が必須（無い/不正なら失敗）
  npm run dist:win       Windows用 NSISインストーラー + portable.exe。release-config.json が必須
  npm run verify:release 配布物の点検（試験鍵・秘密鍵の混入、SHA256、必須ファイル、release設定）
  ※試験用の配布候補だけを作る場合：
      $env:KOEITO_ALLOW_TEST_BUILD="1"; npm run dist:win; npm run build:pwa; node scripts\make-release.mjs --test
    → ..\release-test\ に *-TEST.exe / *-TEST.zip（販売不可・試験用公開鍵入り）

4. 本番配布（販売者の実際の値が必要。架空値では通りません）
  a) 署名鍵を作る（リポジトリの外）： node scripts\generate-keypair.mjs --out-dir C:\koeito-keys
  b) app\release-config.example.json を app\release-config.json にコピーし、実際の値を入れる：
     pwaUrl（HTTPS）、licensePublicKeyJwk（a の公開鍵）、sellerName、sellerContact、salesUrl/helpUrl（任意・HTTPS）
  c) コード署名証明書を設定（seller\SELLER_GUIDE.txt「署名」）
  d) npm run dist:win ; npm run build:pwa ; node scripts\make-release.mjs ; npm run verify:release
  e) Node.js の無い Windows 11 試験機で、インストール→起動→ライセンス→出力→再起動を確認（AC18）

5. 試験について
  - E2E は vite preview（http://localhost:4173/）を自動起動します。PWAのローカル試験は localhost で行います。
  - iPhone 実機試験は HTTPS のステージングURLで行ってください。PCの localhost をスマホのURLとして使わないでください。
  - Linux で開発した場合、Windows 配布物の実機確認は完了扱いにしません（docs\TEST_REPORT.txt 参照）。
    Linux でのビルドには wine64 + wine32(i386) と xvfb が必要です（NSIS のアンインストーラー生成のため）。

6. データの場所
  Windows版：%APPDATA%\Koeito（app.getPath('userData')。インストーラー版・portable版で共通）
  Web版：ブラウザの IndexedDB（DB名 koeito-v1）
