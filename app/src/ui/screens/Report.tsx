// S05 提案書を仕上げる
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData, aliasOfExcerpt, type ProjectData } from '../../app/data';
import { href } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { buildReport, buildExcerptCsv, safeFileName } from '../../app/exportReport';
import { ProjectFrame } from '../Layout';
import { Icon, Notice, TextArea, TextField, lengthError, useBusy, useDocumentTitle } from '../components';
import { useAutosave } from '../useAutosave';
import { ExcerptDialog } from '../ExcerptDialog';
import { assembleReport, excerptPublicInfo, type ExcerptPublicInfo, type ReportBlocker } from '../../domain/report';
import { formatParagraphNo, formatSourceNo, paragraphNoAt } from '../../domain/text';
import type { Excerpt, Project } from '../../domain/schema';
import type { Repo } from '../../db/repo';
import { saveTextFile, exportPdf, isElectron, shareFile } from '../../platform/platform';
import { Loading, NotFound } from './Misc';

type PFields = Pick<Project, 'title' | 'question' | 'periodStart' | 'periodEnd' | 'limitations'>;

export function Report({ kind, pid }: { kind: 'p' | 'd'; pid: string }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  useDocumentTitle(d ? `提案書 — ${d.project.title}` : '');
  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  return <ReportBody kind={kind} data={d} repo={repo} />;
}

function ReportBody({ kind, data: d, repo }: { kind: 'p' | 'd'; data: ProjectData; repo: Repo }) {
  const s = useSession();
  const writable = kind === 'd' || s.realWritable;
  const p = d.project;
  const a = useAutosave<PFields>({
    base: { title: p.title, question: p.question, periodStart: p.periodStart, periodEnd: p.periodEnd, limitations: p.limitations },
    disabled: !writable,
    validate: (x) => ({
      title: lengthError(x.title, 1, 80, '題名'),
      question: lengthError(x.question, 1, 300, '調査の問い'),
      limitations: lengthError(x.limitations, 0, 2000, '調査の限界'),
      periodEnd: x.periodStart && x.periodEnd && x.periodEnd < x.periodStart ? '終了日は開始日より後にしてください' : undefined,
    }),
    save: (x, known) => repo.updateProject(p.id, known, { ...x, title: x.title.trim() }),
  });
  const [bandOpen, setBandOpen] = useState(() => !p.limitations);
  const [blockers, setBlockers] = useState<ReportBlocker[] | null>(null);
  const [infos, setInfos] = useState<ExcerptPublicInfo[]>([]);
  const [mode, setMode] = useState<'formal' | 'draft'>('formal');
  const [result, setResult] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [editEx, setEditEx] = useState<Excerpt | null>(null);
  const exp = useBusy();
  const prev = useBusy();
  const frameRef = useRef<HTMLIFrameElement>(null);

  const included = d.findings.filter((f) => f.included);
  const reviewTargets = useMemo(() => {
    const ids = new Set(d.links.filter((l) => included.some((f) => f.id === l.findingId)).map((l) => l.excerptId));
    return d.excerpts.filter((e) => ids.has(e.id));
  }, [d, included]);

  // recompute checks whenever data changes
  const dataKey = `${p.revision}:${d.excerpts.length}:${d.links.length}:${d.findings.map((f) => f.revision).join(',')}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await assembleReport({ project: p, participants: d.participants, sources: d.sources, excerpts: d.excerpts, themes: d.themes, findings: d.findings, evidenceLinks: d.links }, { draft: false });
      const inf = await Promise.all(reviewTargets.map((e) => excerptPublicInfo(e, d.sourceById, d.participantById)));
      if (!cancelled) {
        setBlockers(r.blockers);
        setInfos(inf);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, d]);

  const formalOk = blockers !== null && blockers.length === 0 && kind === 'p';
  const draft = mode === 'draft' || kind === 'd';

  const makePreview = () =>
    prev.run(async () => {
      try {
        const r = await buildReport(repo, p.id, true);
        setPreview(r.html);
      } catch {
        setPreview(null);
      }
    });
  useEffect(() => {
    void makePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitFrame = () => {
    const f = frameRef.current;
    const doc = f?.contentDocument;
    if (f && doc?.documentElement) f.style.height = `${doc.documentElement.scrollHeight + 8}px`;
  };

  const record = async (format: 'html' | 'pdf') => {
    if (kind === 'p' && s.realWritable) await repo.addExportRecord(p.id, format, draft);
  };

  const exportHtml = () =>
    exp.run(async () => {
      setResult(null);
      try {
        const r = await buildReport(repo, p.id, draft);
        if (!r.html) return setResult({ kind: 'warning', text: '正式出力の条件を満たしていません。下の点検項目を確認してください。' });
        const outcome = await saveTextFile('html', safeFileName('report', 'html', draft), r.html);
        if (outcome === 'cancelled') return setResult({ kind: 'warning', text: '保存をキャンセルしました。ファイルは作成していません。' });
        await record('html');
        setResult({ kind: 'success', text: outcome === 'saved' ? 'HTMLファイルを保存しました。' : 'ファイルを作成しました（ブラウザのダウンロード）。保存先はブラウザの設定によります。' });
      } catch {
        setResult({ kind: 'error', text: '出力できませんでした。データは変更していません。' });
      }
    });

  const exportPdfAction = () =>
    exp.run(async () => {
      setResult(null);
      try {
        const r = await buildReport(repo, p.id, draft);
        if (!r.html) return setResult({ kind: 'warning', text: '正式出力の条件を満たしていません。下の点検項目を確認してください。' });
        const outcome = await exportPdf(r.html, safeFileName('report', 'pdf', draft));
        if (outcome === 'saved') {
          await record('pdf');
          setResult({ kind: 'success', text: 'PDFを保存しました。' });
        } else if (outcome === 'cancelled') setResult({ kind: 'warning', text: 'PDFの保存をキャンセルしました。保存済みにはしていません。' });
        else if (outcome === 'print_dialog_opened') setResult({ kind: 'warning', text: '提案書だけの新しいウィンドウを開き、印刷画面を表示しました。「PDFに保存」を選んでください。ブラウザでは保存できたかを確認できないため、保存済みとして記録しません。' });
        else if (outcome === 'popup_blocked') setResult({ kind: 'warning', text: '新しいウィンドウを開けませんでした（ポップアップの制限）。代わりに「HTMLを保存」し、そのファイルを開いて印刷してください。' });
        else setResult({ kind: 'error', text: 'PDFを作成できませんでした。HTMLを保存して印刷する方法も使えます。' });
      } catch {
        setResult({ kind: 'error', text: '出力できませんでした。データは変更していません。' });
      }
    });

  const exportCsv = () =>
    exp.run(async () => {
      setResult(null);
      try {
        const { csv, unreviewedHint } = await buildExcerptCsv(repo, p.id);
        const outcome = await saveTextFile('csv', safeFileName('quotes', 'csv', false), csv);
        if (outcome === 'cancelled') return setResult({ kind: 'warning', text: '保存をキャンセルしました。' });
        setResult({ kind: unreviewedHint ? 'warning' : 'success', text: `引用CSVを作成しました（公開用の引用のみ）。${unreviewedHint ? `公開内容を未確認の引用が${unreviewedHint}件含まれます。共有前に伏字を確認してください。` : ''}` });
      } catch {
        setResult({ kind: 'error', text: 'CSVを作成できませんでした。' });
      }
    });

  const share = () =>
    exp.run(async () => {
      const r = await buildReport(repo, p.id, draft);
      if (!r.html) return setResult({ kind: 'warning', text: '正式出力の条件を満たしていません。' });
      const ok = await shareFile(safeFileName('report', 'html', draft), r.html, 'text/html');
      setResult(ok ? { kind: 'success', text: '共有シートに渡しました。' } : { kind: 'warning', text: 'この環境では共有できませんでした。「HTMLを保存」を使ってください。' });
    });

  const setReviewed = async (info: ExcerptPublicInfo, on: boolean) => {
    try {
      await runSave(() => repo.updateExcerpt(info.excerpt.id, { publicReviewedHash: info.excerpt.publicReviewedHash, redactions: info.excerpt.redactions }, { publicReviewedHash: on ? info.currentHash : null }));
    } catch {
      /* status shows error */
    }
  };

  const linkFor = (b: ReportBlocker) => {
    if (b.findingId) return href.finding(kind, p.id, b.findingId);
    return null;
  };

  return (
    <ProjectFrame kind={kind} project={p} step="report" sourceCount={d.sources.length}>
      <section className="page-top">
        <div>
          <p className="kicker">Finish the report</p>
          <h1 className="h1">提案書を仕上げる</h1>
          <p className="lead">外へ渡す内容だけを点検します。出力されるのは別名・資料番号・公開用の引用・採用した気づきだけです。</p>
        </div>
      </section>

      <details className="settings-band" open={bandOpen} onToggle={(e) => setBandOpen((e.target as HTMLDetailsElement).open)}>
        <summary>対象と範囲（表紙に載る内容）</summary>
        <div className="inner">
          {a.conflict && (
            <Notice kind="error" title="別の操作で更新されました">
              <p>上書きしていません。</p>
              <textarea className="textarea" readOnly value={JSON.stringify(a.draft, null, 2)} aria-label="入力中の内容（コピー用）" />
              <button type="button" className="btn btn-secondary" onClick={a.reloadLatest}>
                最新の内容を読み込む
              </button>
            </Notice>
          )}
          <TextField label="提案書の題名" required max={80} value={a.draft.title} onChange={(v) => a.setField('title', v)} onBlur={() => void a.flush()} error={a.errors.title} disabled={!writable} />
          <TextArea label="調査の問い" required max={300} value={a.draft.question} onChange={(v) => a.setField('question', v)} onBlur={() => void a.flush()} error={a.errors.question} disabled={!writable} />
          <div className="two-col">
            <TextField type="date" label="実施期間（開始）" value={a.draft.periodStart ?? ''} onChange={(v) => a.setField('periodStart', v || null)} onBlur={() => void a.flush()} disabled={!writable} hint="不明なら空欄（「未設定」と表示）" />
            <TextField type="date" label="実施期間（終了）" value={a.draft.periodEnd ?? ''} onChange={(v) => a.setField('periodEnd', v || null)} onBlur={() => void a.flush()} error={a.errors.periodEnd} disabled={!writable} />
          </div>
          <TextArea label="調査の限界" required max={2000} value={a.draft.limitations} onChange={(v) => a.setField('limitations', v)} onBlur={() => void a.flush()} error={a.errors.limitations} disabled={!writable} hint="例：既存顧客6人への聞き取り。新規顧客や離脱者は含まない。件数は母集団の割合ではない。" />
        </div>
      </details>

      <section aria-labelledby="chk-h">
        <h2 id="chk-h" className="h2">
          正式出力の点検
        </h2>
        {blockers === null ? (
          <p className="loading">確認中…</p>
        ) : (
          <ul className="checklist">
            {[
              { ok: !blockers.some((b) => b.kind === 'no_findings'), text: '提案書に採用した気づきが1件以上ある' },
              { ok: !blockers.some((b) => b.kind === 'finding_not_ready'), text: '採用した気づきが全て「提出可」（支持引用・反証確認の選択・各項目）' },
              { ok: !blockers.some((b) => b.kind === 'review_needed' || b.kind === 'anchor_broken'), text: '公開用の引用を全て確認済み' },
              { ok: !blockers.some((b) => b.kind === 'limitations' || b.kind === 'question'), text: '調査の問いと限界を記入済み' },
            ].map((c) => (
              <li key={c.text} className={c.ok ? 'ok' : 'ng'}>
                <Icon name={c.ok ? 'check' : 'warning'} />
                <div>
                  {c.ok ? '済' : '未'}：{c.text}
                </div>
              </li>
            ))}
          </ul>
        )}
        {blockers && blockers.length > 0 && (
          <Notice kind="warning" title="正式出力の前に確認が必要です">
            <ul style={{ paddingLeft: '1.2em' }}>
              {blockers.slice(0, 12).map((b, i) => {
                const l = linkFor(b);
                return <li key={i}>{l ? <a href={l}>{b.message}</a> : b.message}</li>;
              })}
            </ul>
            {blockers.length > 12 && <p>ほか{blockers.length - 12}件</p>}
          </Notice>
        )}
      </section>

      <section className="section" aria-labelledby="ord-h">
        <h2 id="ord-h" className="h2">
          気づきの順番と採用
        </h2>
        {d.findings.length === 0 ? (
          <p className="caption">
            まだ気づきがありません。<a href={href.findings(kind, p.id)}>気づきを作る</a>
          </p>
        ) : (
          <ul className="order-list">
            {d.findings.map((f, i) => (
              <li key={f.id}>
                <span className="num-brand" style={{ fontSize: 24 }} aria-hidden="true">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <a href={href.finding(kind, p.id, f.id)}>{f.title}</a>
                  <span className="caption">　{f.status === 'ready' ? '提出可' : '草案'}</span>
                </div>
                <span className="row row-actions">
                  <label className="choice" style={{ padding: 0 }}>
                    <input type="checkbox" checked={f.included} disabled={!writable} onChange={(e) => void runSave(() => repo.setFindingIncluded(f.id, e.target.checked)).catch(() => {})} />
                    採用
                  </label>
                  <button type="button" className="btn btn-quiet btn-icon" aria-label={`${f.title}を上へ`} disabled={!writable || i === 0} onClick={() => void runSave(() => repo.moveFinding(f.id, -1)).catch(() => {})}>
                    <Icon name="up" />
                  </button>
                  <button type="button" className="btn btn-quiet btn-icon" aria-label={`${f.title}を下へ`} disabled={!writable || i === d.findings.length - 1} onClick={() => void runSave(() => repo.moveFinding(f.id, 1)).catch(() => {})}>
                    <Icon name="down" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="rev-h">
        <h2 id="rev-h" className="h2">
          公開内容の確認 <span className="caption tnum">{infos.filter((x) => x.reviewed).length} / {infos.length}件 確認済み</span>
        </h2>
        <p className="caption">提案書に載る引用を、この表示どおりに読みます。実名・社名・固有の情報が残っていないか、人が確認してください。伏字や別名を変えると確認はやり直しになります。</p>
        {infos.length === 0 ? (
          <p className="caption">採用した気づきに結びついた引用はまだありません。</p>
        ) : (
          <ul className="review-list">
            {infos.map((info) => (
              <li key={info.excerpt.id}>
                <p className="kicker">
                  {info.alias}　/　{info.source ? `${formatSourceNo(info.source.sourceNo)}・${formatParagraphNo(paragraphNoAt(info.source.text, info.excerpt.startUtf16))}` : '資料なし'}
                </p>
                {info.anchorOk ? (
                  <p className="quote-box public">{info.publicText}</p>
                ) : (
                  <Notice kind="error">
                    <p>原文の位置と一致しないため出力できません。引用を作り直してください。</p>
                  </Notice>
                )}
                <div className="row">
                  <label className="choice">
                    <input type="checkbox" checked={info.reviewed} disabled={!writable || !info.anchorOk} onChange={(e) => void setReviewed(info, e.target.checked)} />
                    公開内容を確認しました
                  </label>
                  {info.source && (
                    <button type="button" className="btn btn-quiet" onClick={() => setEditEx(info.excerpt)}>
                      伏字を編集
                    </button>
                  )}
                  <a className="btn btn-quiet" href={href.reader(kind, p.id, info.excerpt.sourceId, info.excerpt.id)}>
                    原文
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section settings-section" aria-labelledby="exp-h">
        <h2 id="exp-h" className="h2">
          書き出し
        </h2>
        <fieldset>
          <legend>種類</legend>
          <label className="choice">
            <input type="radio" name="mode" checked={mode === 'formal' && kind === 'p'} disabled={kind === 'd'} onChange={() => setMode('formal')} />
            正式な提案書<small>{kind === 'd' ? 'サンプルでは正式出力はできません' : formalOk ? '点検に合格しています' : '点検に合格すると選べます'}</small>
          </label>
          <label className="choice">
            <input type="radio" name="mode" checked={draft} onChange={() => setMode('draft')} />
            草案<small>不足があっても出力できます。表紙と不足箇所に「草案・根拠未確認」と入り、外せません。</small>
          </label>
        </fieldset>
        <div className="export-bar">
          <button type="button" className="btn btn-primary" onClick={() => void exportHtml()} disabled={exp.busy || (!draft && !formalOk)} aria-busy={exp.busy}>
            <Icon name="report" />
            HTMLを保存
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void exportPdfAction()} disabled={exp.busy || (!draft && !formalOk)}>
            {isElectron() ? 'PDFを保存' : 'PDFにする（印刷）'}
          </button>
          {!isElectron() && 'share' in navigator && (
            <button type="button" className="btn btn-secondary" onClick={() => void share()} disabled={exp.busy || (!draft && !formalOk)}>
              共有
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => void exportCsv()} disabled={exp.busy || d.excerpts.length === 0}>
            引用CSVを保存
          </button>
          {exp.slow && <span className="caption">作成中…</span>}
        </div>
        {!draft && !formalOk && <p className="disabled-reason">正式出力は点検の全項目に合格したときだけ使えます。草案を選ぶと今すぐ出力できます。</p>}
        <div aria-live="polite">
          {result && (
            <div style={{ marginTop: 16 }}>
              <Notice kind={result.kind}>
                <p>{result.text}</p>
              </Notice>
            </div>
          )}
        </div>
        <p className="caption">外へ保存したファイルは、アプリのデータを削除しても自動では消えません。「完全な匿名化」は行いません。伏字の確認は人が行います。</p>
      </section>

      <section className="section" aria-labelledby="pv-h">
        <div className="row-between">
          <h2 id="pv-h" className="h2">
            プレビュー（草案表示）
          </h2>
          <button type="button" className="btn btn-secondary" onClick={() => void makePreview()} disabled={prev.busy}>
            {prev.slow ? '作成中…' : 'プレビューを更新'}
          </button>
        </div>
        <div className="preview-frame-wrap">
          {preview ? (
            <iframe ref={frameRef} className="preview-frame" title="提案書のプレビュー" sandbox="allow-same-origin" srcDoc={preview} onLoad={fitFrame} />
          ) : (
            <p className="loading">プレビューを作成中…</p>
          )}
        </div>
      </section>
      {editEx && d.sourceById.get(editEx.sourceId) && <ExcerptDialog repo={repo} data={d} source={d.sourceById.get(editEx.sourceId)!} excerpt={d.excerptById.get(editEx.id) ?? editEx} writable={writable} onClose={() => setEditEx(null)} />}
    </ProjectFrame>
  );
}

export { aliasOfExcerpt };
