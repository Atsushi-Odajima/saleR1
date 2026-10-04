import { href } from '../../app/router';

export function Loading() {
  return (
    <main className="container page" aria-busy="true">
      <p className="loading">読み込み中…</p>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="container page">
      <h1 className="h1">見つかりません</h1>
      <p className="lead">この調査・資料は存在しないか、削除されました。</p>
      <p>
        <a href={href.home()}>調査一覧へ戻る</a>
      </p>
    </main>
  );
}
