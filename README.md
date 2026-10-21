# Koeito — 顧客の声を、根拠のある提案へ

顧客インタビューの文章から引用を選び、テーマ・気づき・改善案を整理して、出典をたどれる提案書を作るアプリです。

> **実装ブランチ：`claude/koeito-r01-app`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- TXT・CSV・貼り付けによる取込と、原文位置に戻れる引用管理
- テーマ別整理、支持・異なる声を付けた気づきと改善案
- 提案書のHTML / PDF出力、ローカル保存とバックアップ

## 現在の範囲・制限

- Windows実機・iPhone Safariでの確認は未完了です。ブラウザ試作と署名済み製品の配布を区別しています。
- 正式なWindows / PWA配布にはrelease-config.jsonと販売者の実設定・署名鍵が必要です。TEST配布物は正式リリースではありません。

## 実装の見どころ

**構成：** React / TypeScript / Vite、Dexie（IndexedDB）、Electron、PWA。

- [app/src](https://github.com/Atsushi-Odajima/saleR1/tree/claude%2Fkoeito-r01-app/app/src)
- [app/electron](https://github.com/Atsushi-Odajima/saleR1/tree/claude%2Fkoeito-r01-app/app/electron)
- [app/tests](https://github.com/Atsushi-Odajima/saleR1/tree/claude%2Fkoeito-r01-app/app/tests)
- [release-docs](https://github.com/Atsushi-Odajima/saleR1/tree/claude%2Fkoeito-r01-app/release-docs)

## ローカルで試す

Node.js 22.12以上。Web開発画面を起動する手順です。デスクトップ起動はnpm run dev:desktop。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/koeito-r01-app https://github.com/Atsushi-Odajima/saleR1.git
cd saleR1/app
npm ci
npm run dev
```

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/saleR1/blob/claude%2Fkoeito-r01-app/README.txt)。

## 検証方法

`app/` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [README.txt](https://github.com/Atsushi-Odajima/saleR1/blob/claude%2Fkoeito-r01-app/README.txt)
- [HANDOFF_TO_CODEX.txt](https://github.com/Atsushi-Odajima/saleR1/blob/claude%2Fkoeito-r01-app/HANDOFF_TO_CODEX.txt)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
