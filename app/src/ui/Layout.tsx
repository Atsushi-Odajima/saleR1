import type { ReactNode } from 'react';
import { href } from '../app/router';
import { useSession } from '../app/session';
import { useUpdateAvailable, activateUpdate } from '../app/pwa';
import { useSaveState, clearSaveError } from '../app/saveStatus';
import { IS_TEST_BUILD, APP_VERSION } from '../config';
import { Icon, SaveStatusView } from './components';
import type { Project } from '../domain/schema';

export function Header() {
  return (
    <header className="site-header">
      <div className="container">
        <a className="brand-link" href={href.home()} aria-label="Koeito ホーム（調査一覧）">
          <img src="./brand/logo_horizontal.svg" alt="Koeito" width={128} height={44} />
        </a>
        <span className="header-tag">RESEARCH TO RECOMMENDATION</span>
        <div className="header-right">
          <SaveStatusView />
          <a className="header-menu" href={href.settings()}>
            設定
          </a>
        </div>
      </div>
    </header>
  );
}

export function Banners({ demo }: { demo?: boolean }) {
  const s = useSession();
  const update = useUpdateAvailable();
  const save = useSaveState();
  return (
    <>
      {IS_TEST_BUILD && (
        <div className="banner test" role="note">
          <div className="container">
            <span>試験ビルド（販売用ではありません・試験用の公開鍵）</span>
          </div>
        </div>
      )}
      {update && (
        <div className="banner readonly" role="status">
          <div className="container">
            <span>新しい版があります。入力中の内容を保存し、必要ならバックアップを作ってから更新してください。</span>
            <span className="row">
              <a href={href.settings()}>バックアップ</a>
              <button type="button" className="btn btn-secondary" onClick={activateUpdate}>
                再読込して更新
              </button>
            </span>
          </div>
        </div>
      )}
      {demo && (
        <div className="banner demo" role="note">
          <div className="container">
            <span>
              <strong>サンプル表示中：</strong>架空データです。この画面の変更はメモリ上だけで、閉じると消えます。自分の資料の取込と正式出力はできません。
            </span>
            <a href={href.home()}>調査一覧へ戻る</a>
          </div>
        </div>
      )}
      {!demo && s.readOnlyReason && (
        <div className="banner readonly" role="note">
          <div className="container">
            <span>
              <strong>読み取り専用：</strong>
              {s.readOnlyReason}
            </span>
            {s.lock === 'busy' && s.license.state === 'valid' && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  const ok = await s.tryAcquireLock();
                  if (!ok) alert('まだ別のタブで編集中です。そちらを閉じてから、もう一度押してください。');
                }}
              >
                編集権を取得
              </button>
            )}
            {s.license.state !== 'valid' && <a href={href.settings()}>ライセンスを読み込む</a>}
          </div>
        </div>
      )}
      {save.kind === 'error' && (
        <div className="container">
          <div className="notice notice-error" role="alert">
            <Icon name="warning" />
            <div>
              <p>
                <strong>保存できませんでした。</strong>
                {save.message}
              </p>
              <div className="row">
                <a href={href.settings()}>バックアップを保存する</a>
                <button type="button" className="btn btn-quiet" onClick={clearSaveError}>
                  この表示を閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <span>Koeito v{APP_VERSION}　/　データはこの端末内に保存されます</span>
        <span className="row">
          <a href={href.help()}>はじめにお読みください</a>
          <a href="./licenses/Fraunces-OFL.txt">フォントのライセンス</a>
        </span>
      </div>
    </footer>
  );
}

export type Step = 'sources' | 'themes' | 'findings' | 'report';
const STEPS: Array<{ key: Step; no: string; label: string; short: string }> = [
  { key: 'sources', no: '01', label: '声を集める', short: '集める' },
  { key: 'themes', no: '02', label: '声を束ねる', short: '束ねる' },
  { key: 'findings', no: '03', label: '気づき', short: '気づき' },
  { key: 'report', no: '04', label: '提案書', short: '提案書' },
];

export function ProjectFrame({ kind, project, step, children, sourceCount }: { kind: 'p' | 'd'; project: Project; step: Step; children: ReactNode; sourceCount: number }) {
  const upd = new Date(project.updatedAt);
  return (
    <>
      <div className="container">
        <div className="context-row">
          <nav className="crumbs" aria-label="現在地">
            <a href={href.home()}>調査一覧</a>
            <span aria-hidden="true">/</span>
            <span>{project.title}</span>
          </nav>
          <span className="row">
            <a href={href.search(kind, project.id)} className="header-menu">
              <Icon name="search" />
              <span>検索</span>
            </a>
            <span className="meta">
              {sourceCount}資料　/　{upd.getFullYear()}.{String(upd.getMonth() + 1).padStart(2, '0')}.{String(upd.getDate()).padStart(2, '0')}
            </span>
          </span>
        </div>
      </div>
      <nav className="steps" aria-label="作業工程">
        <div className="container">
          <ol>
            {STEPS.map((s) => (
              <li key={s.key}>
                <a href={`#/${kind}/${project.id}/${s.key}`} aria-current={step === s.key ? 'step' : undefined}>
                  <b>{s.no}</b>
                  <span className="lbl-long">{s.label}</span>
                  <span className="lbl-short" aria-hidden="true">{s.short}</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
      <main className="container page" id="main" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
