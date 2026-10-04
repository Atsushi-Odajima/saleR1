// S00 はじめる
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '../../app/session';
import { href, navigate } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { newId } from '../../domain/ids';
import { DEMO_PROJECT_ID } from '../../domain/demo';
import { RepoError } from '../../db/repo';
import { Dialog, Icon, Notice, TextArea, TextField, lengthError, useBusy, useDocumentTitle } from '../components';
import { RELEASE_INFO } from '../../config';
import { openExternal } from '../../platform/platform';

export function Home() {
  useDocumentTitle('');
  const s = useSession();
  const projects = useLiveQuery(() => s.real.db.projects.orderBy('updatedAt').reverse().toArray(), [s.real, s.epoch]);
  const helpSeen = useLiveQuery(async () => (await s.real.getSetting<{ helpSeen?: boolean }>('display'))?.helpSeen ?? false, [s.real]);
  const [creating, setCreating] = useState(false);
  const canCreate = s.realWritable;

  return (
    <main id="main" tabIndex={-1}>
      <div className="container">
        <section className="home-hero">
          <div>
            <h1 className="tagline">顧客の声を、根拠のある提案へ。</h1>
            <div className="intro">
              <p>顧客の話を聞く、制作・企画の方へ。</p>
              <p>発言と改善案を、根拠でつなぐ。</p>
              <p>そのまま渡せる提案書に仕上げる。</p>
            </div>
          </div>
          <div className="home-cta">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!canCreate} aria-describedby={!canCreate ? 'create-reason' : undefined}>
              新しい調査を作る
            </button>
            {!canCreate && (
              <p className="disabled-reason" id="create-reason">
                {s.license.state !== 'valid' ? '自分の資料を扱うにはライセンスの読み込みが必要です。サンプルはこのまま試せます。' : s.readOnlyReason}
              </p>
            )}
            <a className="btn btn-secondary" href={href.findings('d', DEMO_PROJECT_ID)}>
              3件の架空サンプルを試す
            </a>
            <a className="btn btn-secondary" href={href.settings()}>
              <Icon name="backup" />
              バックアップの読込・ライセンス・設定
            </a>
            {s.license.state !== 'valid' && RELEASE_INFO.salesUrl && (
              <button type="button" className="btn btn-quiet" onClick={() => void openExternal(RELEASE_INFO.salesUrl!)}>
                ライセンスの購入ページを開く（ブラウザ）
              </button>
            )}
          </div>
        </section>

        {helpSeen === false && (
          <Notice kind="info" title="はじめに">
            <p>記録・取込の権利を持つ資料だけを使ってください。データはこの端末内に保存され、外部へ送信しません。端末内のデータは暗号化されていないため、端末のロック（OSのパスワード等）を使い、定期的に暗号化バックアップを作成してください。</p>
            <div className="row">
              <a href={href.help()}>詳しく読む</a>
              {s.realWritable && (
                <button type="button" className="btn btn-quiet" onClick={() => void s.real.setSetting('display', { helpSeen: true })}>
                  確認しました
                </button>
              )}
            </div>
          </Notice>
        )}

        <section className="section" aria-labelledby="list-h">
          <div className="row-between">
            <h2 id="list-h" className="h2">
              調査
            </h2>
          </div>
          {projects === undefined ? (
            <p className="loading">読み込み中…</p>
          ) : projects.length === 0 ? (
            <div className="empty">
              <p>まだ調査がありません。新しい調査を作るか、架空のサンプルで操作を試せます。サンプルは保存済みの調査には混ざりません。</p>
              {canCreate ? (
                <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                  新しい調査を作る
                </button>
              ) : (
                <a className="btn btn-primary" href={href.findings('d', DEMO_PROJECT_ID)}>
                  サンプルを試す
                </a>
              )}
            </div>
          ) : (
            <ul className="project-list">
              {projects.map((p, i) => (
                <li key={p.id}>
                  <span className="num-brand" aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <a className="title" href={href.sources('p', p.id)}>
                      {p.title}
                    </a>
                    <p className="caption" style={{ margin: 0 }}>
                      {p.question}
                    </p>
                  </div>
                  <span className="caption tnum">最後の保存 {new Date(p.updatedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} />}
    </main>
  );
}

export function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const s = useSession();
  const [id] = useState(newId); // one id per dialog: repeated clicks cannot create twice
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { busy, slow, run } = useBusy();
  const titleErr = lengthError(title, 1, 80, '調査の題名');
  const qErr = lengthError(question, 1, 300, '調査の問い');
  const submit = () =>
    run(async () => {
      setTried(true);
      if (titleErr || qErr) return;
      try {
        await runSave(() => s.real.createProject({ id, title, question, periodStart: null, periodEnd: null, limitations: '' }));
        onClose();
        navigate(href.sources('p', id));
      } catch (e) {
        if (e instanceof RepoError && e.code === 'already_done') {
          onClose();
          navigate(href.sources('p', id));
          return;
        }
        setErr(e instanceof RepoError ? e.message : '作成できませんでした。入力内容は残っています。');
      }
    });
  return (
    <Dialog
      title="新しい調査を作る"
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy} aria-busy={busy}>
            {slow ? '作成中…' : '作成する'}
          </button>
        </>
      }
    >
      {err && (
        <Notice kind="error">
          <p>{err}</p>
          <p>
            <a href={href.settings()}>容量とバックアップを確認する</a>
          </p>
        </Notice>
      )}
      <TextField label="調査の題名" required max={80} value={title} onChange={setTitle} error={tried ? titleErr : undefined} autoFocus hint="例：ECサイトの購入体験" />
      <TextArea label="調査の問い" required max={300} value={question} onChange={setQuestion} error={tried ? qErr : undefined} hint="この調査で確かめたいこと。提案書の表紙に載ります。" />
      <p className="caption">実施期間・調査の限界は、あとで「提案書」で入力できます。</p>
    </Dialog>
  );
}
