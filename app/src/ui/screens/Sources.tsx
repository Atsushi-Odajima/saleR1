// S01 声を集める
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData, type ProjectData } from '../../app/data';
import { href } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { ProjectFrame } from '../Layout';
import { Dialog, Icon, Notice, TextArea, TextField, lengthError, useBusy, useDocumentTitle } from '../components';
import { cpLength, formatAliasDefault, formatSourceNo } from '../../domain/text';
import { decodeText, finishText, DECODE_ERROR_LABEL, type Encoding } from '../../domain/importParse';
import { sha256Hex } from '../../domain/hash';
import { newId } from '../../domain/ids';
import { LIMITS } from '../../domain/limits';
import { RepoError, type NewSourceInput, type Repo } from '../../db/repo';
import type { Participant, Source } from '../../domain/schema';
import { NotFound, Loading } from './Misc';

export function Sources({ kind, pid }: { kind: 'p' | 'd'; pid: string }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  useDocumentTitle(d ? `声を集める — ${d.project.title}` : '');
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState<Source | null>(null);
  const [editPart, setEditPart] = useState<Participant | null>(null);
  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  const writable = kind === 'd' || s.realWritable;
  const canImport = kind === 'p' && s.realWritable;
  const counts = new Map<string, number>();
  for (const e of d.excerpts) counts.set(e.sourceId, (counts.get(e.sourceId) ?? 0) + 1);

  return (
    <ProjectFrame kind={kind} project={d.project} step="sources" sourceCount={d.sources.length}>
      <section className="page-top">
        <div>
          <p className="kicker">Collect voices</p>
          <h1 className="h1">声を集める</h1>
          <p className="lead">インタビューの文章を取り込み、参加者の別名と対応づけます。原文は取り込んだあと変更しません。</p>
        </div>
      </section>
      <p className="kicker">調査の問い</p>
      <p className="question-block">{d.project.question}</p>

      <div className="import-band">
        <p>
          TXT（UTF-8／Shift_JIS）・CSV・貼り付けで追加できます。<span className="muted">1資料20,000文字まで、1調査{LIMITS.sourcesPerProject}資料まで。</span>
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => setImporting(true)} disabled={!canImport} aria-describedby={!canImport ? 'imp-reason' : undefined}>
            <Icon name="import" />
            文章を追加
          </button>
        </div>
      </div>
      {!canImport && (
        <p className="disabled-reason" id="imp-reason">
          {kind === 'd' ? 'サンプルでは自分の資料を取り込めません。ライセンスを読み込むと、新しい調査で取り込めます。' : s.readOnlyReason}
        </p>
      )}

      <section className="section" aria-labelledby="src-h">
        <h2 id="src-h" className="h2">
          資料 <span className="caption tnum">{d.sources.length}件</span>
        </h2>
        {d.sources.length === 0 ? (
          <div className="empty">
            <p>まだ発言がありません。TXT・CSVを取り込むか、文章を貼り付けます。</p>
            <button type="button" className="btn btn-primary" onClick={() => setImporting(true)} disabled={!canImport}>
              文章を追加
            </button>
          </div>
        ) : (
          <>
            <div className="table-head" aria-hidden="true">
              <span>資料番号</span>
              <span>別名</span>
              <span>タイトル（内部）</span>
              <span>文字数・引用</span>
              <span />
            </div>
            <ul className="table-list">
              {d.sources.map((src) => (
                <li key={src.id}>
                  <span className="marginal">{formatSourceNo(src.sourceNo)}</span>
                  <span className="tag">{d.participantById.get(src.participantId)?.alias}</span>
                  <a href={href.reader(kind, pid, src.id)}>{src.title}</a>
                  <span className="caption tnum">
                    {cpLength(src.text).toLocaleString()}文字・引用{counts.get(src.id) ?? 0}
                  </span>
                  <span className="actions">
                    <a className="btn btn-secondary" href={href.reader(kind, pid, src.id)}>
                      読む
                    </a>
                    {writable && (
                      <>
                        <button type="button" className="btn btn-quiet btn-icon" aria-label={`${formatSourceNo(src.sourceNo)}の情報を編集`} onClick={() => setEditing(src)}>
                          <Icon name="more" />
                        </button>
                        <button type="button" className="btn btn-quiet btn-icon" aria-label={`${formatSourceNo(src.sourceNo)}を削除`} onClick={() => setDeleting(src)}>
                          <Icon name="trash" />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {d.participants.length > 0 && (
        <section className="section" aria-labelledby="part-h">
          <h2 id="part-h" className="h2">
            参加者の別名
          </h2>
          <p className="caption">提案書には別名だけが載ります。内部メモ・取込時の値は出力しません。</p>
          <ul className="participants" style={{ listStyle: 'none' }}>
            {d.participants.map((p) => (
              <li key={p.id} className="row">
                <span className="tag">{p.alias}</span>
                <span className="caption">資料{d.sources.filter((x) => x.participantId === p.id).length}件</span>
                {writable && (
                  <button type="button" className="btn btn-quiet" onClick={() => setEditPart(p)}>
                    別名・メモを編集
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {importing && <ImportDialog repo={repo} data={d} onClose={() => setImporting(false)} kind={kind} />}
      {editing && <SourceEditDialog repo={repo} data={d} source={editing} onClose={() => setEditing(null)} />}
      {deleting && <SourceDeleteDialog repo={repo} source={deleting} onClose={() => setDeleting(null)} />}
      {editPart && <ParticipantDialog repo={repo} data={d} participant={editPart} onClose={() => setEditPart(null)} />}
    </ProjectFrame>
  );
}

interface Candidate {
  key: string;
  label: string; // file name or "貼り付け"
  originalFilename: string | null;
  bytes: Uint8Array | null;
  text: string | null;
  error: string | null;
  replacementWarning: boolean;
  sha256: string | null;
  participant: string; // existing participant id, or 'new'
  newAlias: string;
  title: string;
  duplicateOf: string | null; // label of duplicate
  dupChoice: 'skip' | 'import' | null;
}

async function decodeCandidate(c: Candidate, enc: Encoding): Promise<Candidate> {
  if (!c.bytes) return c;
  const r = decodeText(c.bytes, enc);
  if (!r.ok) return { ...c, text: null, error: DECODE_ERROR_LABEL[r.error], sha256: null, replacementWarning: false };
  return { ...c, text: r.text, error: null, replacementWarning: r.hasReplacementChar, sha256: await sha256Hex(r.text) };
}

function markDuplicates(list: Candidate[], existing: Source[], data: ProjectData): Candidate[] {
  const seen = new Map<string, string>();
  for (const s of existing) seen.set(s.sha256, `${formatSourceNo(s.sourceNo)}（${data.participantById.get(s.participantId)?.alias ?? ''}）`);
  return list.map((c) => {
    if (!c.sha256) return { ...c, duplicateOf: null };
    const dup = seen.get(c.sha256) ?? null;
    if (!dup) seen.set(c.sha256, c.label);
    return { ...c, duplicateOf: dup, dupChoice: dup ? c.dupChoice : null };
  });
}

function ImportDialog({ repo, data, onClose, kind }: { repo: Repo; data: ProjectData; onClose: () => void; kind: 'p' | 'd' }) {
  const [batchId] = useState(newId); // double-click protection: one batch per dialog
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [enc, setEnc] = useState<Encoding>('utf-8');
  const [items, setItems] = useState<Candidate[]>([]);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const { busy, slow, run } = useBusy();

  const nextAlias = useMemo(() => {
    const used = new Set(data.participants.map((p) => p.alias));
    const gen: string[] = [];
    let n = data.project.nextParticipantNo;
    return () => {
      while (used.has(formatAliasDefault(n)) || gen.includes(formatAliasDefault(n))) n++;
      const a = formatAliasDefault(n);
      gen.push(a);
      return a;
    };
  }, [data]);

  const fresh = (label: string, filename: string | null, bytes: Uint8Array | null, idx: number): Candidate => ({
    key: newId(),
    label,
    originalFilename: filename,
    bytes,
    text: null,
    error: null,
    replacementWarning: false,
    sha256: null,
    participant: 'new',
    newAlias: nextAlias(),
    title: `資料 ${formatSourceNo(data.project.nextSourceNo + idx)}`,
    duplicateOf: null,
    dupChoice: null,
  });

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const arr = Array.from(files);
    if (arr.length > LIMITS.sourcesPerImport) {
      setError(`1回の取込は${LIMITS.sourcesPerImport}資料までです`);
      return;
    }
    const list: Candidate[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i]!;
      if (f.size > LIMITS.importFileBytes) {
        list.push({ ...fresh(f.name, f.name, null, i), error: DECODE_ERROR_LABEL.too_large });
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      list.push(await decodeCandidate(fresh(f.name, f.name, bytes, i), enc));
    }
    setItems(markDuplicates(list, data.sources, data));
  };

  const changeEncoding = async (e: Encoding) => {
    setEnc(e);
    const list = await Promise.all(items.map((c) => decodeCandidate(c, e)));
    setItems(markDuplicates(list, data.sources, data));
  };

  const preparePaste = async () => {
    const r = finishText(paste);
    if (!r.ok) {
      setError(DECODE_ERROR_LABEL[r.error]);
      return;
    }
    setError(null);
    const c: Candidate = { ...fresh('貼り付けた文章', null, null, 0), text: r.text, sha256: await sha256Hex(r.text), replacementWarning: r.hasReplacementChar };
    setItems(markDuplicates([c], data.sources, data));
  };

  const update = (key: string, patch: Partial<Candidate>) => setItems((l) => l.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const toImport = items.filter((c) => c.text && !c.error && !(c.duplicateOf && c.dupChoice !== 'import'));
  const problems: string[] = [];
  items.forEach((c) => {
    if (c.error) problems.push(`${c.label}: ${c.error}`);
    if (c.duplicateOf && !c.dupChoice) problems.push(`${c.label}: ${c.duplicateOf} と同じ本文です。取り込むかを選んでください`);
    const te = lengthError(c.title, 1, 120, 'タイトル');
    if (te) problems.push(`${c.label}: ${te}`);
    if (c.participant === 'new') {
      const ae = lengthError(c.newAlias, 1, 24, '別名');
      if (ae) problems.push(`${c.label}: ${ae}`);
      else if (data.participants.some((p) => p.alias === c.newAlias.trim())) problems.push(`${c.label}: 別名「${c.newAlias}」は既にあります。既存の参加者を選ぶか別の別名にしてください`);
    }
  });
  const newAliases = new Map<string, string>();
  const commit = () =>
    run(async () => {
      if (problems.length || toImport.length === 0) return;
      setError(null);
      const input: NewSourceInput[] = toImport.map((c) => {
        if (c.participant !== 'new') return { participantId: c.participant, title: c.title.trim(), originalFilename: c.originalFilename, text: c.text!, sha256: c.sha256! };
        const alias = c.newAlias.trim();
        let pidNew = newAliases.get(alias);
        const first = !pidNew;
        if (!pidNew) {
          pidNew = newId();
          newAliases.set(alias, pidNew);
        }
        return first
          ? { newParticipant: { id: pidNew, alias, internalNote: '' }, title: c.title.trim(), originalFilename: c.originalFilename, text: c.text!, sha256: c.sha256! }
          : { participantId: pidNew, title: c.title.trim(), originalFilename: c.originalFilename, text: c.text!, sha256: c.sha256! };
      });
      try {
        const rows = await runSave(() => repo.importSources(data.project.id, batchId, input));
        setDone(rows.length);
      } catch (e) {
        if (e instanceof RepoError && e.code === 'already_done') {
          setDone(toImport.length);
          return;
        }
        setError(e instanceof RepoError ? e.message : '取り込めませんでした。データは変更していません。');
      }
    });

  if (done !== null) {
    return (
      <Dialog
        title="取り込みました"
        onClose={onClose}
        actions={
          <button type="button" className="btn btn-primary" onClick={onClose} data-autofocus>
            閉じる
          </button>
        }
      >
        <Notice kind="success">
          <p>{done}件の資料をこの端末に保存しました。</p>
        </Notice>
      </Dialog>
    );
  }

  return (
    <Dialog
      wide
      title="文章を追加"
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void commit()} disabled={busy || problems.length > 0 || toImport.length === 0} aria-busy={busy}>
            {slow ? '取り込み中…' : `${toImport.length}件を取り込む`}
          </button>
        </>
      }
    >
      <p className="caption">記録・取込の権利を持つ資料だけを取り込んでください。ファイル名・タイトルは内部用で、提案書には出ません。</p>
      <div className="row" role="group" aria-label="追加の方法">
        <button type="button" className={`btn ${mode === 'file' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
          TXTファイル
        </button>
        <button type="button" className={`btn ${mode === 'paste' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={mode === 'paste'} onClick={() => setMode('paste')}>
          貼り付け
        </button>
        <a className="btn btn-secondary" href={href.importCsv(kind, data.project.id)} onClick={onClose}>
          CSV（列を割り当てる）
        </a>
      </div>
      <div style={{ marginTop: 24 }}>
        {mode === 'file' ? (
          <>
            <div className="two-col">
              <div className="field">
                <label htmlFor="txt-files">TXTファイル（複数可）</label>
                <input id="txt-files" className="input" type="file" accept=".txt,text/plain" multiple onChange={(e) => void onFiles(e.target.files)} />
              </div>
              <div className="field">
                <label htmlFor="enc">文字コード</label>
                <select id="enc" className="select" value={enc} onChange={(e) => void changeEncoding(e.target.value as Encoding)}>
                  <option value="utf-8">UTF-8（標準）</option>
                  <option value="shift_jis">Shift_JIS</option>
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            <TextArea label="文章" long value={paste} onChange={setPaste} max={LIMITS.sourceTextCodePoints} hint="1人分の発言を貼り付けます。改行は保たれます。" />
            <button type="button" className="btn btn-secondary" onClick={() => void preparePaste()} disabled={!paste}>
              プレビューする
            </button>
          </>
        )}
      </div>
      {error && (
        <Notice kind="error">
          <p>{error}</p>
        </Notice>
      )}
      {items.length > 0 && (
        <section style={{ marginTop: 24 }} aria-label="取込プレビュー">
          <h3 className="h3">プレビュー（{items.length}件・取り込む{toImport.length}件）</h3>
          <ul className="excerpt-list">
            {items.map((c) => (
              <li key={c.key}>
                <p className="caption">{c.label}</p>
                {c.error ? (
                  <p className="field-error">
                    <Icon name="warning" size={16} />
                    {c.error}
                  </p>
                ) : (
                  <>
                    {c.replacementWarning && (
                      <Notice kind="warning">
                        <p>置換文字（�）が含まれています。文字コードを切り替えて読み直すか、元のファイルを確認してください。</p>
                      </Notice>
                    )}
                    <p className="quote-box" style={{ maxHeight: '9em', overflow: 'auto' }}>
                      {c.text!.slice(0, 400)}
                      {c.text!.length > 400 ? '…' : ''}
                    </p>
                    <p className="caption tnum">{cpLength(c.text!).toLocaleString()}文字</p>
                    <div className="two-col">
                      <div className="field">
                        <label htmlFor={`p-${c.key}`}>参加者</label>
                        <select id={`p-${c.key}`} className="select" value={c.participant} onChange={(e) => update(c.key, { participant: e.target.value })}>
                          <option value="new">新しい参加者</option>
                          {data.participants.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.alias}（既存）
                            </option>
                          ))}
                        </select>
                      </div>
                      {c.participant === 'new' ? (
                        <TextField label="新しい別名" max={24} value={c.newAlias} onChange={(v) => update(c.key, { newAlias: v })} hint="実名は使わず、P04のような別名にします" />
                      ) : (
                        <div />
                      )}
                    </div>
                    <TextField label="タイトル（内部用）" max={120} value={c.title} onChange={(v) => update(c.key, { title: v })} />
                    {c.duplicateOf && (
                      <fieldset>
                        <legend>
                          <Icon name="warning" size={16} /> {c.duplicateOf} と同じ本文です
                        </legend>
                        <label className="choice">
                          <input type="radio" name={`dup-${c.key}`} checked={c.dupChoice === 'skip'} onChange={() => update(c.key, { dupChoice: 'skip' })} />
                          今回は取り込まない
                        </label>
                        <label className="choice">
                          <input type="radio" name={`dup-${c.key}`} checked={c.dupChoice === 'import'} onChange={() => update(c.key, { dupChoice: 'import' })} />
                          別資料として取り込む<small>別の参加者の同じ文章などを、確認のうえ取り込みます</small>
                        </label>
                      </fieldset>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {problems.length > 0 && (
            <Notice kind="warning" title="確認が必要です（まだ何も取り込んでいません）">
              <ul style={{ paddingLeft: '1.2em' }}>
                {problems.slice(0, 20).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
        </section>
      )}
    </Dialog>
  );
}

function SourceEditDialog({ repo, data, source, onClose }: { repo: Repo; data: ProjectData; source: Source; onClose: () => void }) {
  const [title, setTitle] = useState(source.title);
  const [participant, setParticipant] = useState(source.participantId);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const te = lengthError(title, 1, 120, 'タイトル');
  return (
    <Dialog
      title={`${formatSourceNo(source.sourceNo)} の情報`}
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !!te}
            onClick={() =>
              void run(async () => {
                try {
                  await runSave(() => repo.updateSource(source.id, { title: source.title, participantId: source.participantId }, { title: title.trim(), participantId: participant }));
                  onClose();
                } catch (e) {
                  setErr(e instanceof RepoError ? e.message : '保存できませんでした');
                }
              })
            }
          >
            保存する
          </button>
        </>
      }
    >
      {err && (
        <Notice kind="error">
          <p>{err}</p>
        </Notice>
      )}
      <p className="caption">原文は変更できません。修正版は新しい資料として追加し、引用を作り直してください。</p>
      <TextField label="タイトル（内部用）" max={120} value={title} onChange={setTitle} error={te} />
      <div className="field">
        <label htmlFor="src-part">参加者</label>
        <select id="src-part" className="select" value={participant} onChange={(e) => setParticipant(e.target.value)}>
          {data.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.alias}
            </option>
          ))}
        </select>
        <p className="hint">参加者を変えると、この資料の引用の公開確認はやり直しになります。</p>
      </div>
      {source.originalFilename && <p className="caption">元のファイル名（内部）：{source.originalFilename}</p>}
    </Dialog>
  );
}

function SourceDeleteDialog({ repo, source, onClose }: { repo: Repo; source: Source; onClose: () => void }) {
  const [impact, setImpact] = useState<{ excerpts: number; findings: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useBusy();
  useEffect(() => {
    void repo.sourceImpact(source.id).then(setImpact);
  }, [repo, source.id]);
  return (
    <Dialog
      title={`${formatSourceNo(source.sourceNo)} を削除しますか`}
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-danger solid"
            disabled={busy || !impact}
            onClick={() =>
              void run(async () => {
                try {
                  await runSave(() => repo.deleteSource(source.id));
                  onClose();
                } catch (e) {
                  setErr(e instanceof RepoError ? e.message : '削除できませんでした');
                }
              })
            }
          >
            削除する
          </button>
        </>
      }
    >
      {err && (
        <Notice kind="error">
          <p>{err}</p>
        </Notice>
      )}
      {impact ? (
        <Notice kind="warning">
          <p>
            この資料の引用<strong>{impact.excerpts}件</strong>も削除されます。根拠として使っている気づき<strong>{impact.findings}件</strong>は「草案」に戻ります。
          </p>
          <p>資料番号 {formatSourceNo(source.sourceNo)} は再利用されません。外に保存したファイルは削除されません。</p>
        </Notice>
      ) : (
        <p className="loading">影響を確認中…</p>
      )}
    </Dialog>
  );
}

function ParticipantDialog({ repo, data, participant, onClose }: { repo: Repo; data: ProjectData; participant: Participant; onClose: () => void }) {
  const [alias, setAlias] = useState(participant.alias);
  const [note, setNote] = useState(participant.internalNote);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const ae = lengthError(alias, 1, 24, '別名') ?? (data.participants.some((p) => p.id !== participant.id && p.alias === alias.trim()) ? 'この別名は既に使われています' : undefined);
  const ne = lengthError(note, 0, 1000, '内部メモ');
  const used = data.sources.some((s) => s.participantId === participant.id);
  return (
    <Dialog
      title={`参加者 ${participant.alias}`}
      onClose={onClose}
      busy={busy}
      actions={
        <>
          {!used && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    await runSave(() => repo.deleteParticipant(participant.id));
                    onClose();
                  } catch (e) {
                    setErr(e instanceof RepoError ? e.message : '削除できませんでした');
                  }
                })
              }
            >
              削除
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !!ae || !!ne}
            onClick={() =>
              void run(async () => {
                try {
                  await runSave(() => repo.updateParticipant(participant.id, { alias: participant.alias, internalNote: participant.internalNote }, { alias: alias.trim(), internalNote: note }));
                  onClose();
                } catch (e) {
                  setErr(e instanceof RepoError ? e.message : '保存できませんでした');
                }
              })
            }
          >
            保存する
          </button>
        </>
      }
    >
      {err && (
        <Notice kind="error">
          <p>{err}</p>
        </Notice>
      )}
      <TextField label="別名（提案書に載ります）" max={24} value={alias} onChange={setAlias} error={ae} hint="実名や会社名は使わないでください" />
      <TextArea label="内部メモ（提案書には出ません）" max={1000} value={note} onChange={setNote} error={ne} />
      <p className="caption">別名を変えると、この参加者の引用は公開内容の確認がやり直しになります。</p>
    </Dialog>
  );
}
