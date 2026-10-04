import { searchKey } from './text';

export interface SearchDoc {
  kind: 'source' | 'excerpt' | 'theme' | 'finding';
  id: string;
  /** owning entity for navigation (sourceId for source/excerpt, findingId...) */
  targetId: string;
  label: string;
  text: string;
  /** offset of the text within the source (sources only) */
}

export interface SearchHit {
  doc: SearchDoc;
  snippet: string;
  index: number;
}

/** Plain substring search. User input is never treated as a pattern. */
export function search(docs: SearchDoc[], query: string, limit: number): { hits: SearchHit[]; total: number } {
  const q = searchKey(query).trim();
  if (!q) return { hits: [], total: 0 };
  const hits: SearchHit[] = [];
  let total = 0;
  for (const d of docs) {
    const key = searchKey(d.text);
    const i = key.indexOf(q);
    if (i === -1) continue;
    total++;
    if (hits.length < limit) {
      // NFKC can change lengths; use the original text only when offsets still line up
      const base = key.length === d.text.length ? d.text : key;
      const s = Math.max(0, i - 30);
      hits.push({ doc: d, index: i, snippet: (s > 0 ? '…' : '') + base.slice(s, i + q.length + 50) });
    }
  }
  return { hits, total };
}
