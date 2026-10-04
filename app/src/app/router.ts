import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'help' }
  | { name: 'notfound' }
  | { name: 'sources' | 'importCsv' | 'themes' | 'findings' | 'report' | 'search'; kind: 'p' | 'd'; pid: string }
  | { name: 'reader'; kind: 'p' | 'd'; pid: string; sid: string; ex: string | null }
  | { name: 'findingEdit'; kind: 'p' | 'd'; pid: string; fid: string };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const q = new URLSearchParams(queryPart ?? '');
  const seg = (pathPart ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  if (seg.length === 0) return { name: 'home' };
  if (seg[0] === 'settings' && seg.length === 1) return { name: 'settings' };
  if (seg[0] === 'help' && seg.length === 1) return { name: 'help' };
  if ((seg[0] === 'p' || seg[0] === 'd') && seg[1]) {
    const kind = seg[0];
    const pid = seg[1];
    const s2 = seg[2];
    if (seg.length === 3 && s2 === 'sources') return { name: 'sources', kind, pid };
    if (seg.length === 3 && s2 === 'import-csv') return { name: 'importCsv', kind, pid };
    if (seg.length === 3 && s2 === 'themes') return { name: 'themes', kind, pid };
    if (seg.length === 3 && s2 === 'findings') return { name: 'findings', kind, pid };
    if (seg.length === 3 && s2 === 'report') return { name: 'report', kind, pid };
    if (seg.length === 3 && s2 === 'search') return { name: 'search', kind, pid };
    if (seg.length === 4 && s2 === 'source') return { name: 'reader', kind, pid, sid: seg[3]!, ex: q.get('ex') };
    if (seg.length === 4 && s2 === 'findings') return { name: 'findingEdit', kind, pid, fid: seg[3]! };
  }
  return { name: 'notfound' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const f = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return route;
}

export function navigate(hash: string) {
  if (location.hash === hash) return;
  location.hash = hash;
}

export const href = {
  home: () => '#/',
  settings: () => '#/settings',
  help: () => '#/help',
  sources: (k: 'p' | 'd', pid: string) => `#/${k}/${pid}/sources`,
  importCsv: (k: 'p' | 'd', pid: string) => `#/${k}/${pid}/import-csv`,
  reader: (k: 'p' | 'd', pid: string, sid: string, ex?: string) => `#/${k}/${pid}/source/${sid}${ex ? `?ex=${ex}` : ''}`,
  themes: (k: 'p' | 'd', pid: string) => `#/${k}/${pid}/themes`,
  findings: (k: 'p' | 'd', pid: string) => `#/${k}/${pid}/findings`,
  finding: (k: 'p' | 'd', pid: string, fid: string) => `#/${k}/${pid}/findings/${fid}`,
  report: (k: 'p' | 'd', pid: string) => `#/${k}/${pid}/report`,
  search: (k: 'p' | 'd', pid: string) => `#/${k}/${pid}/search`,
};
