// S03 声を束ねる
import { useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData, aliasOfExcerpt, type ProjectData } from '../../app/data';
import { href, navigate } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { ProjectFrame } from '../Layout';
import { Dialog, Icon, Notice, TextArea, TextField, lengthError, useBusy, useDocumentTitle } from '../components';
import { ExcerptDialog } from '../ExcerptDialog';
import { formatParagraphNo, formatSourceNo, paragraphNoAt, themeKey } from '../../domain/text';
import { newId } from '../../domain/ids';
import { RepoError, type Repo } from '../../db/repo';
import type { Excerpt, Theme } from '../../domain/schema';
import { Loading, NotFound } from './Misc';

export function Themes({ kind, pid }: { kind: 'p' | 'd'; pid: string }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  useDocumentTitle(d ? `声を束ねる — ${d.project.title}` : '');
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [editTheme, setEditTheme] = useState<Theme | null>(null);
  const [mergeTheme, setMergeTheme] = useState<Theme | null>(null);
  const [delTheme, setDelTheme] = useState<Theme | null>(null);
  const [editEx, setEditEx] = useState<Excerpt | null>(null);
  const [creatingFinding, setCreatingFinding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [msg, setMsg] = useState<{ kind: 'warning' | 'error'; text: string } | null>(null);
  const { busy, run } = useBusy();

  const groups = useMemo(() => {
    if (!d) return [];
    const out: Array<{ key: string; label: string; theme: Theme | null; items: Excerpt[] }> = [];
    const unc = d.excerpts.filter((e) => e.themeIds.length === 0);
    if (filter === 'all' || filter === 'none') out.push({ key: 'none', label: '未分類', theme: null, items: unc });
    for (const t of d.themes) {
      if (filter !== 'all' && filter !== t.id) continue;
      out.push({ key: t.id, label: t.label, theme: t, items: d.excerpts.filter((e) => e.themeIds.includes(t.id)) });
    }
    return out;
  }, [d, filter]);

  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  const writable = kind === 'd' || s.realWritable;
  // drop selections whose excerpt was deleted elsewhere
  const sel = selected.filter((id) => d.excerptById.has(id));
  const toggle = (id: string, on: boolean) => setSelected((l) => (on ? [...new Set([...l.filter((x) => d.excerptById.has(x)), id])] : l.filter((x) => x !== id)));

  const addTheme = () =>
    run(async () => {
      const err = lengthError(newLabel, 1, 40, 'テーマ名');
      if (err) return setMsg({ kind: 'error', text: err });
      try {
        const { duplicateOf } = await runSave(() => repo.createTheme(pid, { id: newId(), label: newLabel }));
        setNewLabel('');
        setMsg(duplicateOf ? { kind: 'warning', text: `よく似たテーマ「${duplicateOf.label}」があります。重複している場合は統合してください。` } : null);
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof RepoError ? e.message : 'テーマを作成できませんでした' });
      }
    });

  const countFor = (t: Theme) => d.excerpts.filter((e) => e.themeIds.includes(t.id)).length;

  return (
    <ProjectFrame kind={kind} project={d.project} step="themes" sourceCount={d.sources.length}>
      <section className="page-top">
        <div>
          <p className="kicker">Group voices</p>
          <h1 className="h1">声を束ねる</h1>
          <p className="lead">引用をテーマごとに読み、気づきの材料を選びます。テーマを消しても引用は残ります。</p>
        </div>
      </section>
      {msg && (
        <Notice kind={msg.kind}>
          <p>{msg.text}</p>
        </Notice>
      )}

      <section className="theme-band" aria-labelledby="th-h">
        <div className="row-between">
          <h2 id="th-h" className="h3">
            テーマ <span className="caption tnum">{d.themes.length}件</span>
          </h2>
          {writable && (
            <div className="row">
              <label className="visually-hidden" htmlFor="nt">
                新しいテーマ名
              </label>
              <input id="nt" className="input" style={{ maxWidth: 280 }} placeholder="新しいテーマ名" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addTheme()} />
              <button type="button" className="btn btn-secondary" onClick={() => void addTheme()} disabled={busy || !newLabel.trim()}>
                テーマを追加
              </button>
            </div>
          )}
        </div>
        {d.themes.length > 0 && (
          <ul className="theme-list">
            {d.themes.map((t, i) => (
              <li key={t.id}>
                <span>
                  <span className="label">{t.label}</span> <span className="caption tnum">引用{countFor(t)}件</span>
                  {d.themes.some((o) => o.id !== t.id && o.labelKey === themeKey(t.label)) && (
                    <span className="caption" style={{ color: 'var(--warning)' }}>
                      {' '}
                      <Icon name="warning" size={16} /> 同じ名前のテーマがあります
                    </span>
                  )}
                </span>
                {writable && (
                  <span className="row">
                    <button type="button" className="btn btn-quiet btn-icon" aria-label={`${t.label}を上へ`} disabled={i === 0} onClick={() => void runSave(() => repo.moveTheme(t.id, -1))}>
                      <Icon name="up" />
                    </button>
                    <button type="button" className="btn btn-quiet btn-icon" aria-label={`${t.label}を下へ`} disabled={i === d.themes.length - 1} onClick={() => void runSave(() => repo.moveTheme(t.id, 1))}>
                      <Icon name="down" />
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setEditTheme(t)}>
                      名前を変更
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setMergeTheme(t)} disabled={d.themes.length < 2}>
                      統合
                    </button>
                    <button type="button" className="btn btn-quiet btn-icon" aria-label={`${t.label}を削除`} onClick={() => setDelTheme(t)}>
                      <Icon name="trash" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="field" style={{ maxWidth: 360, marginTop: 32 }}>
        <label htmlFor="flt">表示するテーマ</label>
        <select id="flt" className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">すべて</option>
          <option value="none">未分類</option>
          {d.themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {d.excerpts.length === 0 ? (
        <div className="empty">
          <p>まだ引用がありません。資料を読み、残したい一節を引用にしてください。</p>
          <a className="btn btn-primary" href={href.sources(kind, pid)}>
            声を集めるへ
          </a>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <div className="group-head">
              <h2 id={`g-${g.key}`} className="h2">
                {g.label}
              </h2>
              <span className="caption tnum">{g.items.length}件</span>
            </div>
            {g.items.length === 0 ? (
              <p className="caption">{g.theme ? 'このテーマの引用はまだありません。' : '未分類の引用はありません。'}</p>
            ) : (
              <QuoteRows kind={kind} data={d} items={g.items} selected={sel} onToggle={toggle} onEdit={setEditEx} groupKey={g.key} />
            )}
          </section>
        ))
      )}

      {sel.length > 0 && (
        <div className="action-bar" role="region" aria-label="選択した引用">
          <div className="container">
            <span className="tnum">{sel.length}件の引用を選択中</span>
            <span className="row">
              <button type="button" className="btn btn-secondary" onClick={() => setSelected([])}>
                選択を解除
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setCreatingFinding(true)} disabled={!writable}>
                選択した引用で気づきを作る
              </button>
            </span>
          </div>
        </div>
      )}

      {editTheme && <ThemeEditDialog repo={repo} theme={editTheme} onClose={() => setEditTheme(null)} />}
      {mergeTheme && <ThemeMergeDialog repo={repo} data={d} theme={mergeTheme} onClose={() => setMergeTheme(null)} />}
      {delTheme && (
        <Dialog
          title={`テーマ「${delTheme.label}」を削除しますか`}
          onClose={() => setDelTheme(null)}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDelTheme(null)}>
                やめる
              </button>
              <button
                type="button"
                className="btn btn-danger solid"
                onClick={async () => {
                  try {
                    await runSave(() => repo.deleteTheme(delTheme.id));
                    setDelTheme(null);
                  } catch {
                    /* status shows the error */
                  }
                }}
              >
                削除する
              </button>
            </>
          }
        >
          <p>引用{countFor(delTheme)}件からこのテーマが外れます。引用そのものは削除されません。</p>
        </Dialog>
      )}
      {editEx && <ExcerptDialog repo={repo} data={d} source={d.sourceById.get(editEx.sourceId)!} excerpt={editEx} writable={writable} onClose={() => setEditEx(null)} />}
      {creatingFinding && (
        <CreateFindingDialog
          repo={repo}
          projectId={pid}
          excerptIds={sel}
          onClose={() => setCreatingFinding(false)}
          onCreated={(fid) => {
            setSelected([]);
            navigate(href.finding(kind, pid, fid));
          }}
        />
      )}
    </ProjectFrame>
  );
}

function QuoteRows({ kind, data, items, selected, onToggle, onEdit, groupKey }: { kind: 'p' | 'd'; data: ProjectData; items: Excerpt[]; selected: string[]; onToggle: (id: string, on: boolean) => void; onEdit: (e: Excerpt) => void; groupKey: string }) {
  return (
    <ul className="quote-rows">
      {items.map((e) => {
        const src = data.sourceById.get(e.sourceId)!;
        const on = selected.includes(e.id);
        const cid = `chk-${groupKey}-${e.id}`;
        return (
          <li key={e.id} className={on ? 'selected' : undefined}>
            <span className="check">
              <input id={cid} type="checkbox" checked={on} onChange={(ev) => onToggle(e.id, ev.target.checked)} aria-label="この引用を選択" />
            </span>
            <div>
              <p className="q">「{e.quote}」</p>
              <p className="caption">
                {aliasOfExcerpt(data, e)}　/　{formatSourceNo(src.sourceNo)}・{formatParagraphNo(paragraphNoAt(src.text, e.startUtf16))}
                {e.redactions.length > 0 && '　/　伏字あり'}
                {e.themeIds.length > 1 && `　/　${e.themeIds.map((t) => data.themeById.get(t)?.label).join('・')}`}
              </p>
            </div>
            <span className="row row-actions">
              <a className="btn btn-quiet" href={href.reader(kind, data.project.id, src.id, e.id)}>
                原文
              </a>
              <button type="button" className="btn btn-quiet" onClick={() => onEdit(e)}>
                テーマ・伏字
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ThemeEditDialog({ repo, theme, onClose }: { repo: Repo; theme: Theme; onClose: () => void }) {
  const [label, setLabel] = useState(theme.label);
  const [desc, setDesc] = useState(theme.description);
  const [err, setErr] = useState<string | null>(null);
  const le = lengthError(label, 1, 40, 'テーマ名');
  const de = lengthError(desc, 0, 300, '説明');
  return (
    <Dialog
      title="テーマを編集"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!le || !!de}
            onClick={async () => {
              try {
                await runSave(() => repo.updateTheme(theme.id, { label: theme.label, description: theme.description }, { label, description: desc }));
                onClose();
              } catch (e) {
                setErr(e instanceof RepoError ? e.message : '保存できませんでした');
              }
            }}
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
      <TextField label="テーマ名" max={40} value={label} onChange={setLabel} error={le} />
      <TextArea label="説明（内部用）" max={300} value={desc} onChange={setDesc} error={de} />
    </Dialog>
  );
}

function ThemeMergeDialog({ repo, data, theme, onClose }: { repo: Repo; data: ProjectData; theme: Theme; onClose: () => void }) {
  const others = data.themes.filter((t) => t.id !== theme.id);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  return (
    <Dialog
      title={`「${theme.label}」を統合`}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!target}
            onClick={async () => {
              try {
                await runSave(() => repo.mergeTheme(theme.id, target));
                onClose();
              } catch {
                /* shown in status */
              }
            }}
          >
            統合する
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="merge-to">統合先のテーマ</label>
        <select id="merge-to" className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <p className="caption">「{theme.label}」の引用は統合先のテーマに移り、「{theme.label}」は削除されます。</p>
    </Dialog>
  );
}

export function CreateFindingDialog({ repo, projectId, excerptIds, onClose, onCreated }: { repo: Repo; projectId: string; excerptIds: string[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [id] = useState(newId);
  const [title, setTitle] = useState('');
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const te = lengthError(title, 1, 80, '見出し');
  return (
    <Dialog
      title="気づきを作る"
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setTried(true);
                if (te) return;
                try {
                  await runSave(() => repo.createFinding(projectId, { id, title, supportsExcerptIds: excerptIds }));
                  onCreated(id);
                } catch (e) {
                  if (e instanceof RepoError && e.code === 'already_done') return onCreated(id);
                  setErr(e instanceof RepoError ? e.message : '作成できませんでした');
                }
              })
            }
          >
            作成して編集する
          </button>
        </>
      }
    >
      {err && (
        <Notice kind="error">
          <p>{err}</p>
        </Notice>
      )}
      <TextField label="見出し（気づき）" required max={80} value={title} onChange={setTitle} error={tried ? te : undefined} autoFocus hint="例：価格の不安は、送料が見えないことから。" />
      {excerptIds.length > 0 && <p className="caption">選択した{excerptIds.length}件の引用を「支持する声」として結びます。あとで役割を変えられます。</p>}
    </Dialog>
  );
}
