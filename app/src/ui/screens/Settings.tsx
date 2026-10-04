// S06 データと設定
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSession } from '../../app/session';
import { href } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { Icon, Notice, TextField, useBusy, useDocumentTitle } from '../components';
import { encryptBackup, decryptBackup, BackupError, BACKUP_ERROR_LABEL, checkPassword } from '../../domain/backup';
import { parseLicenseFile } from '../../domain/license';
import type { BackupPayload } from '../../domain/schema';
import { RepoError } from '../../db/repo';
import { saveTextFile, isElectron, openExternal } from '../../platform/platform';
import { APP_VERSION, BUILD_KIND, RELEASE_INFO } from '../../config';

const fmtBytes = (n: number | null) => (n === null ? '不明' : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function Settings() {
  useDocumentTitle('データと設定');
  const s = useSession();
  const projects = useLiveQuery(() => s.real.db.projects.toArray(), [s.real, s.epoch]) ?? [];
  const lastBackupAt = useLiveQuery(() => s.real.getSetting<string>('lastBackupAt'), [s.real, s.epoch]);

  return (
    <main className="container page" id="main" tabIndex={-1}>
      <section className="page-top">
        <div>
          <p className="kicker">Data &amp; settings</p>
          <h1 className="h1">データと設定</h1>
          <p className="lead">バックアップ、復元、ライセンス、サポート情報。</p>
        </div>
      </section>
      <p>
        <a href={href.home()}>← 調査一覧へ</a>
      </p>

      <BackupSection projects={projects.map((p) => ({ id: p.id, title: p.title }))} lastBackupAt={lastBackupAt ?? null} />
      <RestoreSection />
      <StorageSection />
      <LicenseSection />

      <section className="settings-section" aria-labelledby="sup-h">
        <h2 id="sup-h" className="h2">
          サポート情報
        </h2>
        <dl className="kv">
          <dt>版</dt>
          <dd>
            Koeito v{APP_VERSION}（{BUILD_KIND === 'release' ? '配布版' : '試験ビルド'}・{isElectron() ? 'Windows版' : 'Web/PWA版'}）
          </dd>
          <dt>販売者・連絡先</dt>
          <dd>{RELEASE_INFO.sellerContact ? `${RELEASE_INFO.sellerName ?? ''} ${RELEASE_INFO.sellerContact}` : '未設定（試験ビルド）'}</dd>
        </dl>
        <p className="caption">問い合わせの際は、調査の内容・原文・ファイルを送らないでください。版と、表示されたエラーの文言だけで十分です。</p>
        <div className="row">
          <a href={href.help()}>はじめにお読みください（ヘルプ）</a>
          {RELEASE_INFO.helpUrl && (
            <button type="button" className="btn btn-quiet" onClick={() => void openExternal(RELEASE_INFO.helpUrl!)}>
              公式ヘルプを開く（ブラウザ）
            </button>
          )}
          <a href="./licenses/Fraunces-OFL.txt">Fraunces OFL</a>
          <a href="./licenses/NotoSansJP-OFL.txt">Noto Sans JP OFL</a>
          <a href="./licenses/NotoSerifJP-OFL.txt">Noto Serif JP OFL</a>
        </div>
      </section>

      <DeleteProjectSection projects={projects.map((p) => ({ id: p.id, title: p.title }))} />
    </main>
  );
}

function BackupSection({ projects, lastBackupAt }: { projects: Array<{ id: string; title: string }>; lastBackupAt: string | null }) {
  const s = useSession();
  const [scope, setScope] = useState('all');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [tried, setTried] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const { busy, slow, run } = useBusy();
  const pwErr = !checkPassword(pw) ? 'パスワードは12〜128文字にしてください' : undefined;
  const pw2Err = pw !== pw2 ? '確認用のパスワードが一致しません' : undefined;
  const create = () =>
    run(async () => {
      setTried(true);
      setMsg(null);
      if (pwErr || pw2Err) return;
      if (projects.length === 0) return setMsg({ kind: 'warning', text: 'バックアップする調査がありません' });
      try {
        const payload = await s.real.backupPayload(scope === 'all' ? undefined : [scope], APP_VERSION);
        const file = await encryptBackup(payload, pw);
        const d = new Date();
        const name = `koeito-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.koeito`;
        const outcome = await saveTextFile('backup', name, file);
        if (outcome === 'cancelled') return setMsg({ kind: 'warning', text: '保存をキャンセルしました。バックアップは作成されていません。' });
        await s.real.setSetting('lastBackupAt', new Date().toISOString()).catch(() => {});
        setPw('');
        setPw2('');
        setTried(false);
        setMsg({ kind: 'success', text: outcome === 'saved' ? 'ファイルを作成し、選んだ場所に保存しました。' : 'ファイルを作成しました（ブラウザのダウンロード）。保存先と保存できたかはブラウザで確認してください。' });
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof BackupError ? BACKUP_ERROR_LABEL[e.code] : 'バックアップを作成できませんでした。' });
      }
    });
  return (
    <section className="settings-section" aria-labelledby="bk-h">
      <h2 id="bk-h" className="h2">
        バックアップを保存
      </h2>
      <p>端末内のデータ（IndexedDB）は暗号化されていません。バックアップファイルはパスワードで暗号化されます（AES-GCM）。パスワードは保存されず、忘れると復元できません。</p>
      <dl className="kv">
        <dt>最後にバックアップを作成</dt>
        <dd>{lastBackupAt ? new Date(lastBackupAt).toLocaleString('ja-JP') : 'まだありません'}</dd>
      </dl>
      <div className="field" style={{ maxWidth: 480 }}>
        <label htmlFor="bk-scope">対象</label>
        <select id="bk-scope" className="select" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">すべての調査（{projects.length}件）</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      <div className="two-col" style={{ maxWidth: 720 }}>
        <TextField label="パスワード（12〜128文字）" type="password" autoComplete="new-password" value={pw} onChange={setPw} error={tried ? pwErr : undefined} />
        <TextField label="パスワード（確認）" type="password" autoComplete="new-password" value={pw2} onChange={setPw2} error={tried ? pw2Err : undefined} />
      </div>
      <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy} aria-busy={busy}>
        <Icon name="backup" />
        {slow ? '暗号化しています…' : 'バックアップを保存'}
      </button>
      <div aria-live="polite">
        {msg && (
          <div style={{ marginTop: 16 }}>
            <Notice kind={msg.kind}>
              <p>{msg.text}</p>
            </Notice>
          </div>
        )}
      </div>
      <p className="caption">PCとスマホの間は自動で同期しません。バックアップファイルを手で移し、相手側で「読み込む」と新しい調査として追加されます（上書き・統合はしません）。</p>
    </section>
  );
}

function RestoreSection() {
  const s = useSession();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [pw, setPw] = useState('');
  const [payload, setPayload] = useState<{ p: BackupPayload; digest: string; seen: boolean } | null>(null);
  const [approveDup, setApproveDup] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const { busy, slow, run } = useBusy();
  const can = s.realWritable;

  const choose = async (file: File | null) => {
    setPayload(null);
    setMsg(null);
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) return setMsg({ kind: 'error', text: BACKUP_ERROR_LABEL.too_large });
    setFileName(file.name);
    setBytes(new Uint8Array(await file.arrayBuffer()));
  };
  const chooseElectron = async () => {
    const r = await window.koeito!.chooseBackupFile();
    if (!r) return;
    setPayload(null);
    setMsg(null);
    setFileName(r.name);
    setBytes(r.bytes);
  };
  const decrypt = () =>
    run(async () => {
      if (!bytes) return;
      setMsg(null);
      try {
        const r = await decryptBackup(bytes, pw);
        const seenList = (await s.real.getSetting<string[]>('importedBackupDigests')) ?? [];
        setPayload({ p: r.payload, digest: r.digest, seen: seenList.includes(r.digest) });
        setApproveDup(false);
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof BackupError ? BACKUP_ERROR_LABEL[e.code] : 'バックアップを読み込めませんでした。' });
      }
    });
  const restore = () =>
    run(async () => {
      if (!payload) return;
      try {
        const r = await runSave(() => s.real.restoreBundle(payload.p));
        const seenList = (await s.real.getSetting<string[]>('importedBackupDigests')) ?? [];
        await s.real.setSetting('importedBackupDigests', [...seenList.filter((x) => x !== payload.digest), payload.digest].slice(-50)).catch(() => {});
        setPayload(null);
        setBytes(null);
        setPw('');
        setMsg({ kind: 'success', text: `${r.projects}件の調査を新しい調査として読み込みました。既存の調査は変更していません。` });
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof RepoError ? e.message : '読み込めませんでした。データは変更していません。' });
      }
    });

  const p = payload?.p;
  return (
    <section className="settings-section" aria-labelledby="rs-h">
      <h2 id="rs-h" className="h2">
        バックアップから読み込む
      </h2>
      {!can && (
        <Notice kind="warning">
          <p>{s.readOnlyReason}</p>
        </Notice>
      )}
      <p className="caption">ファイル → パスワード → 内容の確認 → 新しい調査として読み込み、の順に進みます。既存の調査を置き換えることはありません。</p>
      {isElectron() ? (
        <div className="row" style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={() => void chooseElectron()} disabled={!can}>
            ファイルを選ぶ
          </button>
          <span className="caption">{fileName}</span>
        </div>
      ) : (
        <div className="field" style={{ maxWidth: 480 }}>
          <label htmlFor="rs-file">バックアップファイル（.koeito・30MiBまで）</label>
          <input id="rs-file" className="input" type="file" accept=".koeito,application/json,application/octet-stream" disabled={!can} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />
        </div>
      )}
      {bytes && !payload && (
        <div style={{ maxWidth: 480 }}>
          <TextField label="パスワード" type="password" autoComplete="current-password" value={pw} onChange={setPw} />
          <button type="button" className="btn btn-primary" onClick={() => void decrypt()} disabled={busy || !pw} aria-busy={busy}>
            {slow ? '復号しています…' : '内容を確認する'}
          </button>
        </div>
      )}
      {p && (
        <Notice kind="info" title="読み込む内容">
          <p className="tnum">
            調査{p.projects.length}件・資料{p.sources.length}件・引用{p.excerpts.length}件・気づき{p.findings.length}件（作成 {new Date(p.exportedAt).toLocaleString('ja-JP')}・v{p.appVersion}）
          </p>
          <ul style={{ paddingLeft: '1.2em' }}>
            {p.projects.map((x) => (
              <li key={x.id}>{x.title}</li>
            ))}
          </ul>
          {payload!.seen && (
            <label className="choice">
              <input type="checkbox" checked={approveDup} onChange={(e) => setApproveDup(e.target.checked)} />
              このファイルは以前にも読み込んでいます。重複した調査として追加してよい
            </label>
          )}
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void restore()} disabled={busy || !can || (payload!.seen && !approveDup)}>
              新しい調査として読み込む
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPayload(null)}>
              やめる
            </button>
          </div>
        </Notice>
      )}
      <div aria-live="polite">
        {msg && (
          <Notice kind={msg.kind}>
            <p>{msg.text}</p>
          </Notice>
        )}
      </div>
    </section>
  );
}

function StorageSection() {
  const s = useSession();
  const st = s.storage;
  return (
    <section className="settings-section" aria-labelledby="stg-h">
      <h2 id="stg-h" className="h2">
        この端末の保存領域
      </h2>
      <dl className="kv">
        <dt>使用量／上限の目安</dt>
        <dd>
          {fmtBytes(st.usage)} ／ {fmtBytes(st.quota)}
        </dd>
        <dt>永続保存</dt>
        <dd>{st.persisted === null ? 'この環境では確認できません' : st.persisted ? '承認済み（ブラウザが自動で消しにくい状態）' : '未承認（容量が不足するとブラウザが消す場合があります）'}</dd>
      </dl>
      {!isElectron() && st.persisted === false && (
        <button type="button" className="btn btn-secondary" onClick={() => void s.requestPersist()}>
          永続保存を要求する
        </button>
      )}
      <p className="caption">端末内保存は「作業中のデータ」、バックアップは「端末の外に置く控え」です。端末の故障・ブラウザのデータ消去に備えて、バックアップを定期的に作成してください。</p>
    </section>
  );
}

function LicenseSection() {
  const s = useSession();
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const lic = s.license;
  return (
    <section className="settings-section" aria-labelledby="lic-h">
      <h2 id="lic-h" className="h2">
        ライセンス
      </h2>
      <dl className="kv">
        <dt>状態</dt>
        <dd>
          {lic.state === 'valid' ? (
            <span className="status-badge ready">
              <Icon name="check" size={16} />
              有効（personal-v1・発行 {new Date(lic.payload.issuedAt).toLocaleDateString('ja-JP')}・ID末尾 {lic.payload.licenseId.slice(-4)}）
            </span>
          ) : lic.state === 'invalid' ? (
            <span className="status-badge draft">
              <Icon name="warning" size={16} />
              無効：{lic.message}
            </span>
          ) : (
            '未読込（サンプルだけ使えます）'
          )}
        </dd>
      </dl>
      <div className="field" style={{ maxWidth: 480 }}>
        <label htmlFor="lic-file">ライセンスファイルを選ぶ</label>
        <input
          id="lic-file"
          className="input"
          type="file"
          accept=".json,.koeito-license,application/json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            setMsg(null);
            if (!f) return;
            if (f.size > 16 * 1024) return setMsg({ kind: 'error', text: 'ライセンスファイルの形式が正しくありません' });
            const parsed = parseLicenseFile(await f.text());
            if (!parsed) return setMsg({ kind: 'error', text: 'ライセンスファイルの形式が正しくありません' });
            try {
              const r = await s.installLicense(parsed);
              setMsg(r.state === 'valid' ? { kind: 'success', text: 'ライセンスを読み込みました。自分の調査を作成・保存できます。' } : { kind: 'error', text: r.state === 'invalid' ? r.message : '読み込めませんでした' });
            } catch {
              setMsg({ kind: 'error', text: '保存できませんでした。端末の容量を確認してください。' });
            }
          }}
        />
      </div>
      <div aria-live="polite">
        {msg && (
          <Notice kind={msg.kind}>
            <p>{msg.text}</p>
          </Notice>
        )}
      </div>
      <p className="caption">ライセンスは端末内だけで確認します（オンライン認証・端末情報の取得はしません）。ライセンスがなくなっても、保存済みデータの閲覧・HTML出力・バックアップはできます。</p>
      {lic.state !== 'valid' && RELEASE_INFO.salesUrl && (
        <button type="button" className="btn btn-quiet" onClick={() => void openExternal(RELEASE_INFO.salesUrl!)}>
          購入ページを開く（ブラウザ）
        </button>
      )}
    </section>
  );
}

function DeleteProjectSection({ projects }: { projects: Array<{ id: string; title: string }> }) {
  const s = useSession();
  const [pid, setPid] = useState('');
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useBusy();
  const target = projects.find((p) => p.id === pid);
  return (
    <section className="settings-section danger" aria-labelledby="del-h">
      <h2 id="del-h" className="h2">
        調査を削除
      </h2>
      <p>調査と、その資料・引用・テーマ・気づき・出力記録をこの端末から完全に削除します（保持期間なし）。外に保存したファイル・バックアップは削除されません。</p>
      <div className="field" style={{ maxWidth: 480 }}>
        <label htmlFor="del-p">削除する調査</label>
        <select id="del-p" className="select" value={pid} onChange={(e) => { setPid(e.target.value); setTyped(''); }} disabled={!s.realWritable}>
          <option value="">選んでください</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>
      {target && (
        <div style={{ maxWidth: 480 }}>
          <TextField label={`確認のため題名「${target.title}」を入力`} value={typed} onChange={setTyped} />
          <button
            type="button"
            className="btn btn-danger solid"
            disabled={busy || typed !== target.title}
            onClick={() =>
              void run(async () => {
                try {
                  await runSave(() => s.real.deleteProject(target.id));
                  setPid('');
                  setTyped('');
                  setMsg({ kind: 'success', text: '削除しました。' });
                } catch (e) {
                  setMsg({ kind: 'error', text: e instanceof RepoError ? e.message : '削除できませんでした' });
                }
              })
            }
          >
            <Icon name="trash" />
            完全に削除する
          </button>
        </div>
      )}
      <div aria-live="polite">
        {msg && (
          <Notice kind={msg.kind}>
            <p>{msg.text}</p>
          </Notice>
        )}
      </div>
    </section>
  );
}
