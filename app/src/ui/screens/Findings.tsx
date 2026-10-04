// S04 気づきと次の一手 — list and editor
import { useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData, aliasOfExcerpt, type ProjectData } from '../../app/data';
import { href, navigate } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { ProjectFrame } from '../Layout';
import { Dialog, Icon, Notice, TextArea, TextField, lengthError, useDocumentTitle } from '../components';
import { useAutosave } from '../useAutosave';
import { CreateFindingDialog } from './Themes';
import { evidenceCounts, readinessIssues, READINESS_LABEL, COUNTER_CHECK_LABEL } from '../../domain/finding';
import { formatParagraphNo, formatSourceNo, paragraphNoAt, searchKey } from '../../domain/text';
import { publicQuote } from '../../domain/excerpt';
import type { EvidenceLink, EvidenceRole, Finding } from '../../domain/schema';
import { RepoError, type Repo } from '../../db/repo';
import { Loading, NotFound } from './Misc';

const pad2 = (n: number) => String(n).padStart(2, '0');

function linksOf(d: ProjectData, f: Finding, role?: EvidenceRole): EvidenceLink[] {
  return d.links.filter((l) => l.findingId === f.id && (!role || l.role === role));
}

function countsOf(d: ProjectData, f: Finding) {
  return evidenceCounts(f.id, d.links, d.excerptById, d.sourceById);
}

function citeOf(d: ProjectData, excerptId: string): string {
  const e = d.excerptById.get(excerptId);
  if (!e) return '';
  const s = d.sourceById.get(e.sourceId);
  return s ? `${aliasOfExcerpt(d, e)}　/　${formatSourceNo(s.sourceNo)}・${formatParagraphNo(paragraphNoAt(s.text, e.startUtf16))}` : '';
}

export function Findings({ kind, pid }: { kind: 'p' | 'd'; pid: string }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  useDocumentTitle(d ? `気づき — ${d.project.title}` : '');
  const [creating, setCreating] = useState(false);
  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  const writable = kind === 'd' || s.realWritable;
  const participantsTotal = new Set(d.sources.map((x) => x.participantId)).size;

  return (
    <ProjectFrame kind={kind} project={d.project} step="findings" sourceCount={d.sources.length}>
      <section className="page-top">
        <div>
          <p className="kicker">From voice to next step</p>
          <h1 className="h1">その声から、何を変える？</h1>
          <p className="lead">気づきに根拠を添えて、次の一手をまとめます。</p>
        </div>
        <a className="btn btn-primary" href={href.report(kind, pid)}>
          提案書を仕上げる
          <Icon name="arrow" />
        </a>
      </section>
      {d.findings.length === 0 ? (
        <div className="empty">
          <p>まだ気づきがありません。「声を束ねる」で引用を選んで作るか、ここから作成できます。</p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} disabled={!writable}>
            気づきを作る
          </button>
        </div>
      ) : (
        <>
          {d.findings.map((f, i) => (
            <FindingCard key={f.id} kind={kind} data={d} f={f} index={i} repo={repo} writable={writable} participantsTotal={participantsTotal} />
          ))}
          {writable && (
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(true)}>
              気づきを追加
            </button>
          )}
        </>
      )}
      {creating && <CreateFindingDialog repo={repo} projectId={pid} excerptIds={[]} onClose={() => setCreating(false)} onCreated={(fid) => navigate(href.finding(kind, pid, fid))} />}
    </ProjectFrame>
  );
}

function FindingCard({ kind, data: d, f, index, repo, writable, participantsTotal }: { kind: 'p' | 'd'; data: ProjectData; f: Finding; index: number; repo: Repo; writable: boolean; participantsTotal: number }) {
  const c = countsOf(d, f);
  const issues = readinessIssues(f, c);
  const sup = linksOf(d, f, 'supports');
  const con = linksOf(d, f, 'contradicts');
  const themes = [...new Set(sup.flatMap((l) => d.excerptById.get(l.excerptId)?.themeIds ?? []))].map((t) => d.themeById.get(t)?.label).filter(Boolean);
  const hypothesis = c.supportsExcerpts === 0;
  const full = f.interpretation || sup.length || f.proposal;
  const editHref = href.finding(kind, d.project.id, f.id);
  const quote = (l: EvidenceLink) => {
    const e = d.excerptById.get(l.excerptId)!;
    return (
      <blockquote key={l.id}>
        <p>「{publicQuote(e.quote, e.redactions)}」</p>
        <cite>
          {citeOf(d, l.excerptId)}　/　<a href={href.reader(kind, d.project.id, e.sourceId, e.id)}>原文を見る</a>
        </cite>
      </blockquote>
    );
  };
  return (
    <article className={`finding${full ? '' : ' compact'}`} aria-labelledby={`f-${f.id}`}>
      <span className="num-brand" aria-hidden="true">
        {pad2(index + 1)}
      </span>
      <div>
        <div className="finding-meta">
          <span className="tags">
            {themes.slice(0, 3).map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
            {hypothesis && <span className="tag muted-tag">仮説（根拠なし）</span>}
          </span>
          <span className="row">
            {f.status === 'ready' ? (
              <span className="status-badge ready">
                <Icon name="check" size={16} />
                提出可
              </span>
            ) : (
              <span className="status-badge draft">
                <Icon name="warning" size={16} />
                草案
              </span>
            )}
            <label className="choice" style={{ padding: 0 }}>
              <input type="checkbox" checked={f.included} disabled={!writable} onChange={(e) => void runSave(() => repo.setFindingIncluded(f.id, e.target.checked)).catch(() => {})} />
              提案書に採用
            </label>
            {writable && (
              <>
                <button type="button" className="btn btn-quiet btn-icon" aria-label={`気づき${pad2(index + 1)}を上へ`} disabled={index === 0} onClick={() => void runSave(() => repo.moveFinding(f.id, -1)).catch(() => {})}>
                  <Icon name="up" />
                </button>
                <button type="button" className="btn btn-quiet btn-icon" aria-label={`気づき${pad2(index + 1)}を下へ`} disabled={index === d.findings.length - 1} onClick={() => void runSave(() => repo.moveFinding(f.id, 1)).catch(() => {})}>
                  <Icon name="down" />
                </button>
              </>
            )}
          </span>
        </div>
        <h2 id={`f-${f.id}`}>{f.title}</h2>
        {f.interpretation && <p className="interpretation">{f.interpretation}</p>}
        {(sup.length > 0 || con.length > 0) && (
          <div className="quote-cols">
            <div className="quote-col">
              <div className="qlabel">
                <span>支持する声</span>
                <span className="tnum">
                  {c.supportsParticipants}人・{c.supportsExcerpts}引用
                </span>
              </div>
              {sup.length ? sup.slice(0, 2).map(quote) : <p className="caption">まだありません</p>}
              {sup.length > 2 && <p className="caption">ほか{sup.length - 2}件</p>}
            </div>
            <div className="quote-col contra">
              <div className="qlabel">
                <span>異なる声</span>
                <span className="tnum">
                  {c.contradictsParticipants}人・{c.contradictsExcerpts}引用
                </span>
              </div>
              {con.length ? con.slice(0, 2).map(quote) : <p className="caption">{COUNTER_CHECK_LABEL[f.counterCheck]}</p>}
              {con.length > 2 && <p className="caption">ほか{con.length - 2}件</p>}
            </div>
          </div>
        )}
        {f.proposal && (
          <div className="proposal-box">
            <div>
              <div className="en">Next move.</div>
              <b>次の一手</b>
            </div>
            <div>
              <p>{f.proposal}</p>
              {f.nextCheck && <small>次に確かめること：{f.nextCheck}</small>}
            </div>
          </div>
        )}
        {f.counterCheck !== 'not_checked' && f.counterNote.trim() === '' && (
          <Notice kind="warning">
            <p>
              この気づきには反証確認のメモがありません。<a href={editHref}>確認する</a>
            </p>
          </Notice>
        )}
        <div className="finding-foot">
          <span>
            {issues.length > 0 ? `草案　/　${issues.map((x) => READINESS_LABEL[x]).slice(0, 2).join('・')}` : `調査の範囲：${participantsTotal}人の発言。全利用者を代表する結果ではありません。`}
          </span>
          <a href={editHref}>{writable ? '気づきを編集する' : '気づきを開く'}</a>
        </div>
      </div>
    </article>
  );
}

// ---------------- editor ----------------

export function FindingEditor({ kind, pid, fid }: { kind: 'p' | 'd'; pid: string; fid: string }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  const f = d?.findings.find((x) => x.id === fid);
  useDocumentTitle(f ? `気づきを編集 — ${f.title}` : '');
  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  if (!f) {
    return (
      <ProjectFrame kind={kind} project={d.project} step="findings" sourceCount={d.sources.length}>
        <Notice kind="warning" title="気づきが見つかりません">
          <p>削除された可能性があります。</p>
          <p>
            <a href={href.findings(kind, pid)}>気づきの一覧へ</a>
          </p>
        </Notice>
      </ProjectFrame>
    );
  }
  return <Editor key={f.id} kind={kind} data={d} f={f} repo={repo} writable={kind === 'd' || s.realWritable} />;
}

type FFields = Pick<Finding, 'title' | 'interpretation' | 'proposal' | 'expectedChange' | 'nextCheck' | 'counterCheck' | 'counterNote'>;

function Editor({ kind, data: d, f, repo, writable }: { kind: 'p' | 'd'; data: ProjectData; f: Finding; repo: Repo; writable: boolean }) {
  const base: FFields = { title: f.title, interpretation: f.interpretation, proposal: f.proposal, expectedChange: f.expectedChange, nextCheck: f.nextCheck, counterCheck: f.counterCheck, counterNote: f.counterNote };
  const a = useAutosave<FFields>({
    base,
    disabled: !writable,
    validate: (x) => ({
      title: lengthError(x.title, 1, 80, '見出し'),
      interpretation: lengthError(x.interpretation, 0, 1500, '観察と解釈'),
      proposal: lengthError(x.proposal, 0, 1000, '改善案'),
      expectedChange: lengthError(x.expectedChange, 0, 500, '期待する変化'),
      nextCheck: lengthError(x.nextCheck, 0, 800, '次に確認すること'),
      counterNote: lengthError(x.counterNote, 0, 800, '反証確認のメモ'),
    }),
    save: (x, known) => repo.updateFinding(f.id, known, x),
  });
  const [adding, setAdding] = useState<EvidenceRole | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const c = countsOf(d, f);
  const issues = readinessIssues({ ...f, ...a.draft }, c);
  const idx = d.findings.findIndex((x) => x.id === f.id);
  const field = <K extends keyof FFields>(k: K) => ({ value: a.draft[k] as string, onChange: (v: string) => a.setField(k, v as FFields[K]), onBlur: () => void a.flush(), error: a.errors[k], disabled: !writable });

  const setStatus = async (st: 'draft' | 'ready') => {
    await a.flush();
    try {
      await runSave(() => repo.setFindingStatus(f.id, st));
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof RepoError ? e.message : '変更できませんでした');
    }
  };

  const roleSection = (role: EvidenceRole, title: string, hint: string) => {
    const links = linksOf(d, f, role);
    return (
      <section className="section" aria-labelledby={`role-${role}`} style={{ marginTop: 32 }}>
        <div className="row-between">
          <h2 id={`role-${role}`} className="h3">
            {title} <span className="caption tnum">{links.length}引用</span>
          </h2>
          {writable && (
            <button type="button" className="btn btn-secondary" onClick={() => setAdding(role)}>
              引用を追加
            </button>
          )}
        </div>
        <p className="caption">{hint}</p>
        {links.length > 0 && (
          <ul className="evidence-list">
            {links.map((l, i) => {
              const e = d.excerptById.get(l.excerptId);
              if (!e) return null;
              return (
                <li key={l.id}>
                  <div>
                    <p className="q">「{publicQuote(e.quote, e.redactions)}」</p>
                    <p className="caption">
                      {citeOf(d, e.id)}　/　<a href={href.reader(kind, d.project.id, e.sourceId, e.id)}>原文を見る</a>
                    </p>
                  </div>
                  {writable && (
                    <span className="row">
                      <label className="visually-hidden" htmlFor={`role-sel-${l.id}`}>
                        役割
                      </label>
                      <select id={`role-sel-${l.id}`} className="select" style={{ width: 'auto' }} value={l.role} onChange={(ev) => void runSave(() => repo.setLink(f.id, e.id, ev.target.value as EvidenceRole)).catch(() => {})}>
                        <option value="supports">支持</option>
                        <option value="contradicts">異なる声</option>
                        <option value="context">文脈</option>
                      </select>
                      <button type="button" className="btn btn-quiet btn-icon" aria-label="上へ" disabled={i === 0} onClick={() => void runSave(() => repo.moveLink(l.id, -1)).catch(() => {})}>
                        <Icon name="up" />
                      </button>
                      <button type="button" className="btn btn-quiet btn-icon" aria-label="下へ" disabled={i === links.length - 1} onClick={() => void runSave(() => repo.moveLink(l.id, 1)).catch(() => {})}>
                        <Icon name="down" />
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={() => void runSave(() => repo.removeLink(l.id)).catch(() => {})}>
                        外す
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  return (
    <ProjectFrame kind={kind} project={d.project} step="findings" sourceCount={d.sources.length}>
      <p>
        <a href={href.findings(kind, d.project.id)}>← 気づきの一覧へ</a>
      </p>
      {a.conflict && (
        <Notice kind="error" title="この気づきは別の操作で更新されました">
          <p>上書きしていません。入力中の内容をコピーしてから、最新の内容を読み込んでください。</p>
          <textarea className="textarea" readOnly value={JSON.stringify(a.draft, null, 2)} aria-label="入力中の内容（コピー用）" />
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={a.reloadLatest}>
              最新の内容を読み込む
            </button>
          </div>
        </Notice>
      )}
      {a.saveError && !a.conflict && (
        <Notice kind="error">
          <p>{a.saveError}</p>
        </Notice>
      )}
      {msg && (
        <Notice kind="warning">
          <p>{msg}</p>
        </Notice>
      )}
      <div className="editor-grid">
        <div className="side num-brand" style={{ fontSize: 64, letterSpacing: '-.04em', color: 'var(--ink)' }} aria-hidden="true">
          {pad2(idx + 1)}
        </div>
        <div>
          <p className="kicker">調査の問い：{d.project.question}</p>
          <TextField label="見出し（気づき）" required max={80} {...field('title')} />
          <TextArea label="観察と解釈" max={1500} {...field('interpretation')} hint="発言から何が読み取れるか。言い換えや補足はここに書きます。" />

          {roleSection('supports', '支持する声', `支持した人数は「支持」の引用の参加者数です（${c.supportsParticipants}人・${c.supportsExcerpts}引用）。異なる声・文脈は数えません。`)}
          {roleSection('contradicts', '異なる声', '気づきと合わない発言。反証は失敗ではなく、提案の範囲を示します。')}
          {roleSection('context', '文脈となる声', '背景の理解に役立つ発言。件数には含めません。')}

          <fieldset style={{ marginTop: 32 }}>
            <legend>反証の確認</legend>
            {(['not_checked', 'none_found', 'found'] as const).map((v) => (
              <label className="choice" key={v}>
                <input type="radio" name="counter" checked={a.draft.counterCheck === v} disabled={!writable} onChange={() => a.setField('counterCheck', v)} />
                {COUNTER_CHECK_LABEL[v]}
                {v === 'not_checked' && <small>提案書に「反証確認は未実施」と明記されます</small>}
              </label>
            ))}
          </fieldset>
          <TextArea label="反証確認のメモ" max={800} {...field('counterNote')} hint="どの資料を見て、何を確かめたか。異なる声が見つからなかったことは、結論が確実という意味ではありません。" />
          <TextArea label="改善案（次の一手）" max={1000} {...field('proposal')} />
          <TextArea label="期待する変化" max={500} {...field('expectedChange')} />
          <TextArea label="次に確認すること" max={800} {...field('nextCheck')} hint="検証の方法・対象。" />

          <section className="settings-section" aria-labelledby="st-h" style={{ marginTop: 32 }}>
            <h2 id="st-h" className="h3">
              提出の準備
            </h2>
            {issues.length > 0 ? (
              <ul className="checklist">
                {issues.map((i) => (
                  <li key={i} className="ng">
                    <Icon name="warning" />
                    <div>{READINESS_LABEL[i]}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="status-badge ready">
                <Icon name="check" size={16} />
                提出に必要な項目はそろっています
              </p>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              {f.status === 'ready' ? (
                <button type="button" className="btn btn-secondary" disabled={!writable} onClick={() => void setStatus('draft')}>
                  草案に戻す
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={!writable || issues.length > 0} onClick={() => void setStatus('ready')} aria-describedby={issues.length ? 'ready-why' : undefined}>
                  <Icon name="check" />
                  提出可にする
                </button>
              )}
              <label className="choice">
                <input type="checkbox" checked={f.included} disabled={!writable} onChange={(e) => void runSave(() => repo.setFindingIncluded(f.id, e.target.checked)).catch(() => {})} />
                提案書に採用
              </label>
            </div>
            {issues.length > 0 && f.status !== 'ready' && (
              <p className="disabled-reason" id="ready-why">
                上の不足を埋めると「提出可」にできます。引用数から重要度や確信度は計算しません。
              </p>
            )}
            <p className="caption">現在の状態：{f.status === 'ready' ? '提出可' : '草案'}</p>
          </section>

          {writable && (
            <section className="settings-section danger">
              {!confirmDel ? (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDel(true)}>
                  <Icon name="trash" />
                  この気づきを削除
                </button>
              ) : (
                <Notice kind="warning" title="この気づきを削除しますか">
                  <p>引用は残ります。根拠のつながりだけが削除されます。</p>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-danger solid"
                      onClick={async () => {
                        await runSave(() => repo.deleteFinding(f.id)).catch(() => {});
                        navigate(href.findings(kind, d.project.id));
                      }}
                    >
                      削除する
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setConfirmDel(false)}>
                      やめる
                    </button>
                  </div>
                </Notice>
              )}
            </section>
          )}
        </div>
      </div>
      {adding && <AddEvidenceDialog data={d} f={f} role={adding} repo={repo} onClose={() => setAdding(null)} />}
    </ProjectFrame>
  );
}

function AddEvidenceDialog({ data: d, f, role, repo, onClose }: { data: ProjectData; f: Finding; role: EvidenceRole; repo: Repo; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [theme, setTheme] = useState('all');
  const [added, setAdded] = useState<string[]>([]);
  const linked = new Map(d.links.filter((l) => l.findingId === f.id).map((l) => [l.excerptId, l.role]));
  const list = useMemo(() => {
    const k = searchKey(q.trim());
    return d.excerpts.filter((e) => (theme === 'all' || (theme === 'none' ? e.themeIds.length === 0 : e.themeIds.includes(theme))) && (!k || searchKey(e.quote).includes(k)));
  }, [d.excerpts, q, theme]);
  const roleLabel = role === 'supports' ? '支持する声' : role === 'contradicts' ? '異なる声' : '文脈となる声';
  return (
    <Dialog
      wide
      title={`${roleLabel}として引用を追加`}
      onClose={onClose}
      actions={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          完了
        </button>
      }
    >
      <div className="two-col">
        <div className="field">
          <label htmlFor="ev-q">引用を絞り込む</label>
          <input id="ev-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ev-t">テーマ</label>
          <select id="ev-t" className="select" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="all">すべて</option>
            <option value="none">未分類</option>
            {d.themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="caption">該当する引用がありません。資料を読んで引用を作ってください。</p>
      ) : (
        <ul className="evidence-list">
          {list.slice(0, 200).map((e) => {
            const cur = linked.get(e.id);
            return (
              <li key={e.id}>
                <div>
                  <p className="q">「{e.quote}」</p>
                  <p className="caption">{citeOf(d, e.id)}</p>
                </div>
                <span>
                  {cur === role || added.includes(e.id) ? (
                    <span className="status-badge ready">
                      <Icon name="check" size={16} />
                      追加済み
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={async () => {
                        try {
                          await runSave(() => repo.setLink(f.id, e.id, role));
                          setAdded((l) => [...l, e.id]);
                        } catch {
                          /* status shows error */
                        }
                      }}
                    >
                      {cur ? `役割を「${roleLabel}」に変更` : '追加'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
