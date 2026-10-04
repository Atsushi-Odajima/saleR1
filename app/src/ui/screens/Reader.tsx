// S02 声を読む — single-column reading surface (max 740px) with margin paragraph numbers.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData, type ProjectData } from '../../app/data';
import { href, navigate } from '../../app/router';
import { ProjectFrame } from '../Layout';
import { Dialog, Icon, Notice, useDocumentTitle, LiveRegion } from '../components';
import { ExcerptDialog } from '../ExcerptDialog';
import { selectionOffsets } from '../selection';
import { splitParagraphs, formatParagraphNo, formatSourceNo, graphemeBoundaries, BoundarySet, paragraphNoAt, cpLength } from '../../domain/text';
import { highlightSegments, trimRangeNewlines, validateExcerptRange, publicQuote } from '../../domain/excerpt';
import type { Excerpt, Source } from '../../domain/schema';
import { Loading, NotFound } from './Misc';

const RANGE_ERROR: Record<string, string> = {
  not_grapheme_boundary: '選択範囲の端が文字の途中です。選び直してください。',
  too_long: '引用は800文字までです。範囲を短くしてください。',
  only_newlines: '文字を含む範囲を選んでください。',
  empty: '',
  out_of_bounds: '選択範囲を読み取れませんでした。選び直してください。',
};

export function Reader({ kind, pid, sid, ex }: { kind: 'p' | 'd'; pid: string; sid: string; ex: string | null }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  const source = d?.sourceById.get(sid);
  useDocumentTitle(source ? `${formatSourceNo(source.sourceNo)} を読む` : '');
  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  if (!source) {
    return (
      <ProjectFrame kind={kind} project={d.project} step="sources" sourceCount={d.sources.length}>
        <Notice kind="warning" title="資料が見つかりません">
          <p>削除された可能性があります。</p>
          <p>
            <a href={href.sources(kind, pid)}>声を集めるへ戻る</a>
          </p>
        </Notice>
      </ProjectFrame>
    );
  }
  return <ReaderBody kind={kind} data={d} source={source} focusEx={ex} />;
}

function ReaderBody({ kind, data, source, focusEx }: { kind: 'p' | 'd'; data: ProjectData; source: Source; focusEx: string | null }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const writable = kind === 'd' || s.realWritable;
  const rootRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [selErr, setSelErr] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ start: number; end: number } | null>(null);
  const [editing, setEditing] = useState<Excerpt | null>(null);
  const [picker, setPicker] = useState(false);
  const [live, setLive] = useState('');
  const paragraphs = useMemo(() => splitParagraphs(source.text), [source.text]);
  const boundaries = useMemo(() => new BoundarySet(source.text), [source.text]);
  const excerpts = useMemo(() => data.excerpts.filter((e) => e.sourceId === source.id), [data.excerpts, source.id]);
  const alias = data.participantById.get(source.participantId)?.alias ?? '';

  useEffect(() => {
    const onSel = () => {
      const root = rootRef.current;
      if (!root) return;
      const off = selectionOffsets(root);
      if (!off) {
        setSel(null);
        setSelErr(null);
        return;
      }
      const [a, b] = trimRangeNewlines(source.text, off.start, off.end);
      const v = validateExcerptRange(source.text, a, b, boundaries);
      if (v.ok) {
        setSel({ start: a, end: b });
        setSelErr(null);
      } else {
        setSel(null);
        setSelErr(RANGE_ERROR[v.error] || null);
      }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [source.text, boundaries]);

  useEffect(() => {
    if (!focusEx) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-ex~="${CSS.escape(focusEx)}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      rootRef.current?.querySelectorAll(`[data-ex~="${CSS.escape(focusEx)}"]`).forEach((x) => x.classList.add('focus'));
      setLive('引用の範囲を強調しています');
    }
  }, [focusEx, excerpts.length]);

  const openCreate = (r: { start: number; end: number }) => {
    const dup = excerpts.find((e) => e.startUtf16 === r.start && e.endUtf16 === r.end);
    if (dup) {
      setEditing(dup);
      setLive('同じ範囲の引用が既にあるため、その引用を開きました');
      return;
    }
    setCreating(r);
  };

  return (
    <ProjectFrame kind={kind} project={data.project} step="sources" sourceCount={data.sources.length}>
      <LiveRegion message={live} />
      <div className="reader-head">
        <p>
          <a href={href.sources(kind, data.project.id)}>← 資料の一覧へ戻る</a>
        </p>
        <p className="kicker">
          {formatSourceNo(source.sourceNo)}　/　{alias}　/　<span className="tnum">{cpLength(source.text).toLocaleString()}文字</span>
        </p>
        <h1 className="h2">{source.title}</h1>
        <p className="caption">読みながら、残したい一節を選択して「選択を引用」を押します。選択しづらい場合は「段落から選ぶ」を使えます。原文は変更されません。</p>
      </div>
      <div className="reader" data-reader ref={rootRef} lang="ja">
        <div className="reader-text">
          {paragraphs.map((p) => (
            <p className="para" key={p.no} data-para>
              <span className="pno" aria-hidden="true">
                {formatParagraphNo(p.no)}
              </span>
              <span className="ptext" data-ps={p.start} data-pe={p.end}>
                {highlightSegments(p.start, p.end, excerpts).map((sg) =>
                  sg.end > sg.start ? (
                    <span key={sg.start} data-o={sg.start} data-ex={sg.ids.length ? sg.ids.join(' ') : undefined} className={sg.ids.length ? `hl${sg.ids.length > 1 ? ' hl-2' : ''}` : undefined}>
                      {source.text.slice(sg.start, sg.end)}
                    </span>
                  ) : null,
                )}
              </span>
            </p>
          ))}
        </div>
      </div>

      <div className="select-bar">
        <div className="inner">
          <span className="sel-info" aria-live="polite">
            {selErr ? (
              <span className="field-error">
                <Icon name="warning" size={16} />
                {selErr}
              </span>
            ) : sel ? (
              `${formatParagraphNo(paragraphNoAt(source.text, sel.start))}から${cpLength(source.text.slice(sel.start, sel.end))}文字を選択中`
            ) : (
              '原文を選択してください'
            )}
          </span>
          <span className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setPicker(true)} disabled={!writable}>
              段落から選ぶ
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!sel || !writable}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => sel && openCreate(sel)}
              aria-describedby={!writable ? 'ro-reason' : undefined}
            >
              <Icon name="quote" />
              選択を引用
            </button>
          </span>
        </div>
        {!writable && (
          <p className="disabled-reason" id="ro-reason">
            {s.readOnlyReason}
          </p>
        )}
      </div>

      <section className="section" aria-labelledby="ex-h">
        <h2 id="ex-h" className="h2">
          この資料の引用 <span className="caption tnum">{excerpts.length}件</span>
        </h2>
        {excerpts.length === 0 ? (
          <p className="caption">まだ引用はありません。</p>
        ) : (
          <ul className="excerpt-list">
            {excerpts.map((e) => (
              <li key={e.id}>
                <p className="kicker">
                  {formatParagraphNo(paragraphNoAt(source.text, e.startUtf16))}　{e.themeIds.map((t) => data.themeById.get(t)?.label).filter(Boolean).join('・') || '未分類'}
                </p>
                <p className="quote-box">{publicQuote(e.quote, e.redactions)}</p>
                <div className="row">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(e)}>
                    {writable ? '引用を編集' : '引用を見る'}
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => navigate(href.reader(kind, data.project.id, source.id, e.id))}>
                    原文で範囲を表示
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating && <ExcerptDialog repo={repo} data={data} source={source} range={creating} writable={writable} onClose={() => { setCreating(null); window.getSelection()?.removeAllRanges(); }} onOpenExisting={(id) => { setCreating(null); setEditing(data.excerptById.get(id) ?? null); }} />}
      {editing && <ExcerptDialog repo={repo} data={data} source={source} excerpt={editing} writable={writable} onClose={() => setEditing(null)} />}
      {picker && (
        <ParagraphPicker
          source={source}
          onClose={() => setPicker(false)}
          onPick={(r) => {
            setPicker(false);
            openCreate(r);
          }}
        />
      )}
    </ProjectFrame>
  );
}

/** Alternative to text selection (touch devices, assistive tech): tap start and end characters. */
function ParagraphPicker({ source, onClose, onPick }: { source: Source; onClose: () => void; onPick: (r: { start: number; end: number }) => void }) {
  const paragraphs = useMemo(() => splitParagraphs(source.text).filter((p) => p.end > p.start), [source.text]);
  const [pno, setPno] = useState(paragraphs[0]?.no ?? 1);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const p = paragraphs.find((x) => x.no === pno);
  const text = p ? source.text.slice(p.start, p.end) : '';
  const bounds = useMemo(() => graphemeBoundaries(text), [text]);
  const lo = a !== null && b !== null ? Math.min(a, b) : a;
  const hi = a !== null && b !== null ? Math.max(a, b) : a;
  const choose = (i: number) => {
    if (a === null || b !== null) {
      setA(i);
      setB(null);
    } else setB(i);
  };
  const range = p && lo !== null && hi !== null ? { start: p.start + bounds[lo]!, end: p.start + bounds[hi + 1]! } : null;
  return (
    <Dialog
      wide
      title="段落から選ぶ"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" disabled={!range} onClick={() => range && onPick(range)}>
            この範囲を引用
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="pick-para">段落</label>
        <select
          id="pick-para"
          className="select"
          value={pno}
          onChange={(e) => {
            setPno(Number(e.target.value));
            setA(null);
            setB(null);
          }}
        >
          {paragraphs.map((x) => (
            <option key={x.no} value={x.no}>
              {formatParagraphNo(x.no)}　{Array.from(source.text.slice(x.start, x.end)).slice(0, 24).join('')}
            </option>
          ))}
        </select>
      </div>
      <p className="caption" aria-live="polite">
        {a === null ? '最初の文字を押してください。' : b === null ? '最後の文字を押してください（1文字だけなら同じ文字）。' : `${hi! - lo! + 1}文字を選択中。もう一度押すと選び直せます。`}
      </p>
      <div className="grapheme-picker" role="group" aria-label="文字を選ぶ">
        {bounds.slice(0, -1).map((st, i) => {
          const ch = text.slice(st, bounds[i + 1]);
          const inRange = lo !== null && hi !== null && i >= lo && i <= hi;
          return (
            <button key={st} type="button" aria-pressed={inRange} className={i === lo || i === hi ? 'edge' : undefined} onClick={() => choose(i)} aria-label={`${i + 1}文字目「${ch}」`}>
              {ch}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
