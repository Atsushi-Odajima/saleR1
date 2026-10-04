// Project-wide plain text search (sources, excerpts, themes, findings).
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData } from '../../app/data';
import { href } from '../../app/router';
import { ProjectFrame } from '../Layout';
import { useDocumentTitle } from '../components';
import { search, type SearchDoc } from '../../domain/search';
import { formatSourceNo } from '../../domain/text';
import { LIMITS } from '../../domain/limits';
import { Loading, NotFound } from './Misc';

const KIND_LABEL = { source: '資料の原文', excerpt: '引用', theme: 'テーマ', finding: '気づき' } as const;

export function Search({ kind, pid }: { kind: 'p' | 'd'; pid: string }) {
  const s = useSession();
  const d = useProjectData(s.repoFor(kind), pid, s.epoch);
  useDocumentTitle('検索');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [limit, setLimit] = useState<number>(LIMITS.searchResults);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setLimit(LIMITS.searchResults), [debounced]);
  const docs = useMemo<SearchDoc[]>(() => {
    if (!d) return [];
    return [
      ...d.sources.map((x) => ({ kind: 'source' as const, id: x.id, targetId: x.id, label: `${formatSourceNo(x.sourceNo)} ${x.title}`, text: x.text })),
      ...d.excerpts.map((x) => ({ kind: 'excerpt' as const, id: x.id, targetId: x.sourceId, label: '引用', text: x.quote })),
      ...d.themes.map((x) => ({ kind: 'theme' as const, id: x.id, targetId: x.id, label: x.label, text: x.label })),
      ...d.findings.map((x) => ({ kind: 'finding' as const, id: x.id, targetId: x.id, label: x.title, text: [x.title, x.interpretation, x.proposal].join('\n') })),
    ];
  }, [d]);
  const res = useMemo(() => search(docs, debounced, limit), [docs, debounced, limit]);
  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  const link = (doc: SearchDoc) =>
    doc.kind === 'source' ? href.reader(kind, pid, doc.id) : doc.kind === 'excerpt' ? href.reader(kind, pid, doc.targetId, doc.id) : doc.kind === 'theme' ? href.themes(kind, pid) : href.finding(kind, pid, doc.id);
  return (
    <ProjectFrame kind={kind} project={d.project} step="sources" sourceCount={d.sources.length}>
      <h1 className="h1">検索</h1>
      <div className="field" style={{ maxWidth: 640, marginTop: 24 }}>
        <label htmlFor="q">原文・引用・テーマ・気づきを検索</label>
        <input id="q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" data-autofocus />
        <p className="hint">大文字・小文字、全角・半角は区別しません。入力した文字列そのものを探します。</p>
      </div>
      <p className="caption tnum" role="status" aria-live="polite">
        {debounced.trim() ? `${res.total}件` : ''}
      </p>
      <ul className="search-results">
        {res.hits.map((h) => (
          <li key={`${h.doc.kind}-${h.doc.id}`}>
            <span className="kind">{KIND_LABEL[h.doc.kind]}</span>
            <div>
              <a href={link(h.doc)}>{h.doc.label}</a>
            </div>
            <p className="caption" style={{ margin: 0 }}>
              {h.snippet}
            </p>
          </li>
        ))}
      </ul>
      {res.total > res.hits.length && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => setLimit((n) => n + LIMITS.searchResults)}>
          続きを表示（残り{res.total - res.hits.length}件）
        </button>
      )}
    </ProjectFrame>
  );
}
