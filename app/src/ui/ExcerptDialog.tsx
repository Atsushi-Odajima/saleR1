// Create / edit an excerpt: fixed quote, themes, public redactions, internal note.
import { useEffect, useMemo, useRef, useState } from 'react';
import { runSave } from '../app/saveStatus';
import type { ProjectData } from '../app/data';
import type { Repo } from '../db/repo';
import { RepoError } from '../db/repo';
import type { Excerpt, Range, Source } from '../domain/schema';
import { findPhraseRanges, normalizeRedactions, publicQuote, REDACTION_MARK, validateExcerptRange } from '../domain/excerpt';
import { formatParagraphNo, formatSourceNo, paragraphNoAt, cpLength } from '../domain/text';
import { newId } from '../domain/ids';
import { Dialog, Icon, Notice, TextArea, lengthError, useBusy } from './components';
import { selectionOffsets } from './selection';

export function ExcerptDialog({
  repo,
  data,
  source,
  range,
  excerpt,
  writable,
  onClose,
  onOpenExisting,
}: {
  repo: Repo;
  data: ProjectData;
  source: Source;
  range?: { start: number; end: number };
  excerpt?: Excerpt;
  writable: boolean;
  onClose: () => void;
  onOpenExisting?: (id: string) => void;
}) {
  const [id] = useState(() => excerpt?.id ?? newId());
  const start = excerpt?.startUtf16 ?? range!.start;
  const end = excerpt?.endUtf16 ?? range!.end;
  const v = useMemo(() => validateExcerptRange(source.text, start, end), [source.text, start, end]);
  const quote = v.ok ? v.quote : '';
  const [themeIds, setThemeIds] = useState<string[]>(excerpt?.themeIds ?? []);
  const [note, setNote] = useState(excerpt?.note ?? '');
  const [redactions, setRedactions] = useState<Range[]>(excerpt?.redactions ?? []);
  const [phrase, setPhrase] = useState('');
  const [newTheme, setNewTheme] = useState('');
  const [msg, setMsg] = useState<{ kind: 'error' | 'warning' | 'success'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const { busy, slow, run } = useBusy();
  const quoteRef = useRef<HTMLDivElement>(null);
  const alias = data.participantById.get(source.participantId)?.alias ?? '';
  const duplicate = !excerpt ? data.excerpts.find((e) => e.sourceId === source.id && e.startUtf16 === start && e.endUtf16 === end) : undefined;
  const noteErr = lengthError(note, 0, 1000, '内部メモ');
  const live = excerpt ? data.excerptById.get(excerpt.id) : undefined;

  useEffect(() => {
    if (excerpt && !live) setMsg({ kind: 'warning', text: 'この引用は別の操作で削除されました。保存はできません。' });
  }, [excerpt, live]);

  const addRanges = (rs: Range[]) => {
    const n = normalizeRedactions(quote, [...redactions, ...rs]);
    if (!n.ok) {
      setMsg({ kind: 'error', text: '伏字の範囲が文字の途中で切れています。選び直してください。' });
      return;
    }
    setMsg(null);
    setRedactions(n.ranges);
  };

  const redactSelection = () => {
    if (!quoteRef.current) return;
    const off = selectionOffsets(quoteRef.current);
    if (!off || off.end <= off.start) {
      setMsg({ kind: 'warning', text: '上の原文で、伏字にしたい部分を選択してから押してください。' });
      return;
    }
    addRanges([{ startUtf16: off.start, endUtf16: off.end }]);
    window.getSelection()?.removeAllRanges();
  };

  const save = () =>
    run(async () => {
      if (!v.ok || noteErr) return;
      try {
        if (excerpt) {
          await runSave(() => repo.updateExcerpt(excerpt.id, { themeIds: excerpt.themeIds, note: excerpt.note, redactions: excerpt.redactions }, { themeIds, note, redactions }));
        } else {
          await runSave(() => repo.createExcerpt({ id, sourceId: source.id, startUtf16: start, endUtf16: end, themeIds, note, redactions }));
        }
        onClose();
      } catch (e) {
        if (e instanceof RepoError && e.code === 'already_done') return onClose();
        if (e instanceof RepoError && e.code === 'duplicate_excerpt' && e.extra?.existingId && onOpenExisting) return onOpenExisting(e.extra.existingId);
        setMsg({ kind: 'error', text: e instanceof RepoError ? e.message : '保存できませんでした。入力内容は残っています。' });
      }
    });

  const addTheme = () =>
    run(async () => {
      const label = newTheme.trim();
      const err = lengthError(label, 1, 40, 'テーマ名');
      if (err) return setMsg({ kind: 'error', text: err });
      try {
        const { theme, duplicateOf } = await runSave(() => repo.createTheme(data.project.id, { id: newId(), label }));
        setThemeIds((t) => [...t, theme.id]);
        setNewTheme('');
        setMsg(duplicateOf ? { kind: 'warning', text: `よく似たテーマ「${duplicateOf.label}」があります。必要なら「声を束ねる」で統合できます。` } : null);
      } catch (e) {
        setMsg({ kind: 'error', text: e instanceof RepoError ? e.message : 'テーマを作成できませんでした' });
      }
    });

  // quote segments with redaction marks (no CSS hiding: the public text is computed separately)
  const segs: Array<{ s: number; e: number; red: boolean }> = [];
  let pos = 0;
  for (const r of redactions) {
    if (r.startUtf16 > pos) segs.push({ s: pos, e: r.startUtf16, red: false });
    segs.push({ s: r.startUtf16, e: r.endUtf16, red: true });
    pos = r.endUtf16;
  }
  if (pos < quote.length) segs.push({ s: pos, e: quote.length, red: false });

  if (!v.ok) {
    return (
      <Dialog title="引用を作れません" onClose={onClose}>
        <Notice kind="error">
          <p>原文と選択範囲が一致しません。もう一度選択してください。</p>
        </Notice>
      </Dialog>
    );
  }

  return (
    <Dialog
      wide
      title={excerpt ? '引用を編集' : '選択した発言を引用にする'}
      onClose={onClose}
      busy={busy}
      actions={
        <>
          {excerpt && writable && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                const imp = await repo.excerptImpact(excerpt.id);
                setConfirmDelete(imp.findings);
              }}
            >
              <Icon name="trash" />
              削除
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {writable ? 'やめる' : '閉じる'}
          </button>
          {writable && (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !!duplicate || !!noteErr || (!!excerpt && !live)} aria-busy={busy}>
              {slow ? '保存中…' : '引用を保存'}
            </button>
          )}
        </>
      }
    >
      {msg && (
        <Notice kind={msg.kind}>
          <p>{msg.text}</p>
        </Notice>
      )}
      {duplicate && (
        <Notice kind="warning" title="同じ範囲の引用が既にあります">
          <p>新しく作らず、既存の引用を開いて編集してください。</p>
          {onOpenExisting && (
            <button type="button" className="btn btn-secondary" onClick={() => onOpenExisting(duplicate.id)}>
              既存の引用を開く
            </button>
          )}
        </Notice>
      )}
      {confirmDelete !== null && excerpt && (
        <Notice kind="warning" title="この引用を削除しますか">
          <p>根拠として使っている気づき{confirmDelete}件から外れ、その気づきは「草案」に戻ります。</p>
          <div className="row">
            <button
              type="button"
              className="btn btn-danger solid"
              onClick={() =>
                void run(async () => {
                  try {
                    await runSave(() => repo.deleteExcerpt(excerpt.id));
                    onClose();
                  } catch (e) {
                    setMsg({ kind: 'error', text: e instanceof RepoError ? e.message : '削除できませんでした' });
                  }
                })
              }
            >
              削除する
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>
              やめる
            </button>
          </div>
        </Notice>
      )}

      <p className="kicker">
        原文（編集できません）　{alias} / {formatSourceNo(source.sourceNo)}・{formatParagraphNo(paragraphNoAt(source.text, start))}　<span className="tnum">{cpLength(quote)}文字</span>
      </p>
      <div className="quote-box" ref={quoteRef} data-reader data-ps={0} data-pe={quote.length} aria-label="引用する原文">
        {segs.map((sg) => (
          <span key={sg.s} data-o={sg.s} className={sg.red ? 'redact-src' : undefined}>
            {quote.slice(sg.s, sg.e)}
          </span>
        ))}
      </div>

      <fieldset style={{ marginTop: 24 }}>
        <legend>テーマ（複数選択可）</legend>
        {data.themes.length === 0 && <p className="caption">まだテーマがありません。下で作成できます。</p>}
        <div className="tags">
          {data.themes.map((t) => (
            <label key={t.id} className="choice" style={{ marginRight: 16 }}>
              <input type="checkbox" checked={themeIds.includes(t.id)} disabled={!writable} onChange={(e) => setThemeIds((l) => (e.target.checked ? [...l, t.id] : l.filter((x) => x !== t.id)))} />
              {t.label}
            </label>
          ))}
        </div>
        {writable && (
          <div className="row">
            <label className="visually-hidden" htmlFor="new-theme">
              新しいテーマ名
            </label>
            <input id="new-theme" className="input" style={{ maxWidth: 320 }} placeholder="新しいテーマ名" value={newTheme} onChange={(e) => setNewTheme(e.target.value)} />
            <button type="button" className="btn btn-secondary" onClick={() => void addTheme()} disabled={!newTheme.trim() || busy}>
              テーマを追加
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>公開用の伏字</legend>
        <p className="hint caption">提案書・CSVでは、伏字の部分が「{REDACTION_MARK}」に置き換わります（文字そのものを置換します）。言い換えは気づきの解釈欄で行ってください。</p>
        {writable && (
          <div className="row" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={redactSelection}>
              原文で選んだ部分を伏字にする
            </button>
            <label className="visually-hidden" htmlFor="phrase">
              伏字にする語句
            </label>
            <input id="phrase" className="input" style={{ maxWidth: 240 }} placeholder="語句（例：会社名）" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!phrase}
              onClick={() => {
                const rs = findPhraseRanges(quote, phrase);
                if (!rs.length) setMsg({ kind: 'warning', text: 'その語句は引用の中にありません' });
                else {
                  addRanges(rs);
                  setPhrase('');
                }
              }}
            >
              語句をすべて伏字にする
            </button>
          </div>
        )}
        {redactions.length > 0 && (
          <ul style={{ listStyle: 'none' }}>
            {redactions.map((r, i) => (
              <li key={`${r.startUtf16}-${r.endUtf16}`} className="row">
                <span className="redact-src">{quote.slice(r.startUtf16, r.endUtf16)}</span>
                {writable && (
                  <button type="button" className="btn btn-quiet" onClick={() => setRedactions((l) => l.filter((_, j) => j !== i))}>
                    伏字を解除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="kicker" style={{ marginTop: 12 }}>
          公開用の表示
        </p>
        <p className="quote-box public">{publicQuote(quote, redactions)}</p>
      </fieldset>

      <TextArea label="内部メモ（提案書には出ません）" max={1000} value={note} onChange={setNote} error={noteErr} disabled={!writable} />
    </Dialog>
  );
}
