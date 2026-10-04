R01 Koeito — はじめに
2026-10-05 / 企画・開発指示・ブランド素材。完成アプリや販売許可ではありません。

1. ZIPをWindows 11の任意の作業フォルダーに展開します。
2. Claude CodeでR01_Koeitoフォルダーを開きます。
3. 次の文をそのまま送ってください。

01_claude_code_prompt.txtを全文読み、このフォルダーのassetsを参照して、Koeitoをapp/へ実装してください。仕様の確認だけで止まらず、データ保存から提案書出力まで完成させ、テスト・配布候補・Codex引き継ぎまで進めてください。実行できなかった検証は未検証と記録してください。

ファイルの役割
00_product_summary.txt：商品をすぐ理解するための説明。
01_claude_code_prompt.txt：機能・データ・UI・試験を含む単体完全版。
02_market_and_name_research.txt：競合、価格、事実と仮説、名称検索、参照の限界。
03_brand_and_ui_spec.txt：色、書体、余白、各画面と状態。
04_design_direction_report.txt：3案比較と落選理由、過去との差。
05_delivery_review.txt：今回の納品物の点検記録。アプリ試験結果ではない。
assets/：ブランドポスター、ロゴ、PWAアイコン、実装可能なSVG/HTML/tokens、フォント。
examples/：実装・UI確認用の架空インタビュー。
licenses/：同梱フォントの原ライセンス。
SHA256SUMS.txt：納品ファイルの整合確認用。

優先順位：01の機能・データ条件→03の数値仕様とtokens→source/*.svg→UI設計見本→ブランドポスター。
01末尾には03と同じUI仕様を収録。後日変更する場合は両ファイルを一緒に更新してください。
ui_reference.htmlは画面設計の静的見本で、保存機能はありません。スマホ用PNGも同じHTMLのレスポンシブ描画です。
brand_board.pngはImageGenで作ったブランド演出。細部のピクセル位置を実装仕様として逆算しないでください。

商標未確認。全旧商品通番が確定しないため、R01を今回の再設計シリーズ1件目の番号としています。
Windows/PWA本体とライセンス発行は次工程です。今回のZIPをそのまま完成アプリとして販売しないでください。
