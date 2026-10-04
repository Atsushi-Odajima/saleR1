// S01a CSV column mapping (full screen). Preview → confirm → one transaction.
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../app/session';
import { useProjectData } from '../../app/data';
import { href, navigate } from '../../app/router';
import { runSave } from '../../app/saveStatus';
import { ProjectFrame } from '../Layout';
import { Icon, Notice, useBusy, useDocumentTitle } from '../components';
import { decodeText, parseCsv, mapCsvRows, guessMapping, DECODE_ERROR_LABEL, type Encoding, type CsvParsed, type CsvMapping } from '../../domain/importParse';
import { sha256Hex } from '../../domain/hash';
import { newId } from '../../domain/ids';
import { cpLength, formatAliasDefault, formatSourceNo } from '../../domain/text';
import { LIMITS } from '../../domain/limits';
import { RepoError, type NewSourceInput } from '../../db/repo';
import { Loading, NotFound } from './Misc';

interface AliasPlan {
  value: string;
  joinExisting: string | null; // participant id when user confirms the join
  candidate: string | null; // existing participant id whose alias equals the value
  newAlias: string;
}

export function ImportCsv({ kind, pid }: { kind: 'p' | 'd'; pid: string }) {
  const s = useSession();
  const repo = s.repoFor(kind);
  const d = useProjectData(repo, pid, s.epoch);
  useDocumentTitle('CSVの取込');
  const [batchId] = useState(newId);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [enc, setEnc] = useState<Encoding>('utf-8');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [aliasPlans, setAliasPlans] = useState<AliasPlan[]>([]);
  const [dupChoice, setDupChoice] = useState<Record<number, 'skip' | 'import'>>({});
  const [hashes, setHashes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const { busy, slow, run } = useBusy();

  const parsed: { data: CsvParsed } | { error: string; rowErrors?: string[] } | null = useMemo(() => {
    if (!bytes) return null;
    const dec = decodeText(bytes, enc, { checkLength: false });
    if (!dec.ok) return { error: DECODE_ERROR_LABEL[dec.error] };
    if (dec.hasReplacementChar) return { error: '置換文字（�）が含まれています。文字コードを切り替えて読み直してください' };
    const p = parseCsv(dec.text, { hasHeader });
    if (!p.ok) return { error: p.error, rowErrors: p.rowErrors };
    return { data: p.data };
  }, [bytes, enc, hasHeader]);

  const data = parsed && 'data' in parsed ? parsed.data : null;
  const effMapping = mapping ?? (data ? guessMapping(data.header) : null);
  const mapped = data && effMapping ? mapCsvRows(data, effMapping, hasHeader) : null;

  // compute alias plan and hashes when rows change
  const rowsKey = mapped ? JSON.stringify(mapped.rows.map((r) => [r.participantValue, r.text.length])) : '';
  useEffect(() => {
    if (!mapped || !d) return;
    const values = [...new Set(mapped.rows.map((r) => r.participantValue.trim()).filter(Boolean))];
    const used = new Set(d.participants.map((p) => p.alias));
    let n = d.project.nextParticipantNo;
    setAliasPlans(
      values.map((v) => {
        const cand = d.participants.find((p) => p.alias === v) ?? null;
        let alias = v;
        if (cpLength(v) > 24 || used.has(v) || !/^[A-Za-z]{0,3}\d{1,4}$/.test(v)) {
          while (used.has(formatAliasDefault(n))) n++;
          alias = formatAliasDefault(n);
        }
        used.add(alias);
        return { value: v, joinExisting: null, candidate: cand?.id ?? null, newAlias: alias };
      }),
    );
    void Promise.all(mapped.rows.map((r) => sha256Hex(r.text))).then(setHashes);
    setDupChoice({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey, d?.project.id]);

  if (d === undefined) return <Loading />;
  if (d === null) return <NotFound />;
  const canImport = kind === 'p' && s.realWritable;

  const existingByHash = new Map(d.sources.map((x) => [x.sha256, x]));
  const dups: Array<{ row: number; what: string }> = [];
  const seen = new Map<string, number>();
  hashes.forEach((h, i) => {
    const ex = existingByHash.get(h);
    const rowNo = mapped?.rows[i]?.rowNo ?? i;
    if (ex) dups.push({ row: i, what: `${rowNo}行目は既存の${formatSourceNo(ex.sourceNo)}と同じ本文です` });
    else if (seen.has(h)) dups.push({ row: i, what: `${rowNo}行目は${seen.get(h)}行目と同じ本文です` });
    else seen.set(h, rowNo);
  });

  const aliasErrors: string[] = [];
  const finalAliases = new Set(d.participants.map((p) => p.alias));
  for (const a of aliasPlans) {
    if (a.joinExisting) continue;
    const al = a.newAlias.trim();
    if (!al || cpLength(al) > 24) aliasErrors.push(`「${a.value}」の別名は1〜24文字にしてください`);
    else if (finalAliases.has(al)) aliasErrors.push(`別名「${al}」が重複しています`);
    finalAliases.add(al);
  }
  const blocking = [
    ...(mapped?.errors ?? []),
    ...aliasErrors,
    ...dups.filter((x) => !dupChoice[x.row]).map((x) => x.what + '（取り込むか選んでください）'),
    ...(mapped && hashes.length !== mapped.rows.length ? ['本文を確認中です'] : []),
  ];
  const rowsToImport = mapped ? mapped.rows.filter((_, i) => dupChoice[i] !== 'skip') : [];

  const commit = () =>
    run(async () => {
      if (!mapped || blocking.length) return;
      setErr(null);
      const planByValue = new Map(aliasPlans.map((a) => [a.value, a]));
      const newIds = new Map<string, string>();
      const items: NewSourceInput[] = [];
      mapped.rows.forEach((r, i) => {
        if (dupChoice[i] === 'skip') return;
        const plan = planByValue.get(r.participantValue.trim())!;
        const base = { title: r.title ?? `資料（CSV ${r.rowNo}行目）`, originalFilename: fileName || null, text: r.text, sha256: hashes[i]! };
        if (plan.joinExisting) items.push({ ...base, participantId: plan.joinExisting });
        else if (newIds.has(plan.value)) items.push({ ...base, participantId: newIds.get(plan.value)! });
        else {
          const id = newId();
          newIds.set(plan.value, id);
          items.push({ ...base, newParticipant: { id, alias: plan.newAlias.trim(), internalNote: plan.value === plan.newAlias.trim() ? '' : `取込時の参加者値: ${plan.value}`.slice(0, 1000) } });
        }
      });
      try {
        const rows = await runSave(() => repo.importSources(pid, batchId, items));
        setDone(rows.length);
      } catch (e) {
        if (e instanceof RepoError && e.code === 'already_done') return setDone(items.length);
        setErr(e instanceof RepoError ? e.message : '取り込めませんでした。データは変更していません。');
      }
    });

  return (
    <ProjectFrame kind={kind} project={d.project} step="sources" sourceCount={d.sources.length}>
      <p>
        <a href={href.sources(kind, pid)}>← 声を集めるへ戻る</a>
      </p>
      <section className="page-top">
        <div>
          <p className="kicker">Import CSV</p>
          <h1 className="h1">CSVの列を割り当てる</h1>
          <p className="lead">1行が1資料になります。プレビューで件数・列・別名を確認してから、まとめて確定します。不正な行があるときは1件も取り込みません。</p>
        </div>
      </section>
      {!canImport && (
        <Notice kind="warning">
          <p>{kind === 'd' ? 'サンプルでは自分の資料を取り込めません。' : s.readOnlyReason}</p>
        </Notice>
      )}
      {done !== null ? (
        <Notice kind="success" title="取り込みました">
          <p>{done}件の資料をこの端末に保存しました。</p>
          <p>
            <a href={href.sources(kind, pid)} onClick={() => navigate(href.sources(kind, pid))}>
              資料の一覧へ
            </a>
          </p>
        </Notice>
      ) : (
        <>
          <div className="two-col">
            <div className="field">
              <label htmlFor="csv-file">CSVファイル（10MiB・{LIMITS.csvRows}行まで）</label>
              <input
                id="csv-file"
                className="input"
                type="file"
                accept=".csv,text/csv"
                disabled={!canImport}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setMapping(null);
                  setDone(null);
                  setErr(null);
                  if (!f) return;
                  if (f.size > LIMITS.importFileBytes) {
                    setBytes(null);
                    setErr(DECODE_ERROR_LABEL.too_large);
                    return;
                  }
                  setFileName(f.name);
                  setBytes(new Uint8Array(await f.arrayBuffer()));
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="csv-enc">文字コード</label>
              <select id="csv-enc" className="select" value={enc} onChange={(e) => setEnc(e.target.value as Encoding)}>
                <option value="utf-8">UTF-8（標準・BOM可）</option>
                <option value="shift_jis">Shift_JIS</option>
              </select>
            </div>
          </div>
          <label className="choice">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            1行目は見出し（列名）
          </label>
          {err && (
            <Notice kind="error">
              <p>{err}</p>
            </Notice>
          )}
          {parsed && 'error' in parsed && (
            <Notice kind="error" title="CSVを読み取れませんでした（まだ何も取り込んでいません）">
              <p>{parsed.error}</p>
              {parsed.rowErrors && (
                <ul style={{ paddingLeft: '1.2em' }}>
                  {parsed.rowErrors.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </Notice>
          )}
          {data && effMapping && mapped && (
            <>
              <section className="section" aria-labelledby="map-h">
                <h2 id="map-h" className="h2">
                  列の割り当て
                </h2>
                <div className="mapping-grid">
                  {(['participant', 'text', 'title'] as const).map((k) => (
                    <div className="field" key={k}>
                      <label htmlFor={`map-${k}`}>{k === 'participant' ? '参加者（必須）' : k === 'text' ? '本文（必須）' : 'タイトル（任意）'}</label>
                      <select
                        id={`map-${k}`}
                        className="select"
                        value={effMapping[k] === null ? '' : String(effMapping[k])}
                        onChange={(e) => setMapping({ ...effMapping, [k]: e.target.value === '' ? null : Number(e.target.value) })}
                      >
                        {k === 'title' && <option value="">使わない</option>}
                        {data.header.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `${i + 1}列目`}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <p className="caption tnum">
                  {mapped.rows.length}行・取り込む{rowsToImport.length}資料・参加者{aliasPlans.length}人
                </p>
              </section>

              {aliasPlans.length > 0 && (
                <section className="section" aria-labelledby="alias-h">
                  <h2 id="alias-h" className="h2">
                    参加者の別名
                  </h2>
                  <p className="caption">CSVの参加者の値は内部メモにだけ残し、提案書には別名を使います。既存の別名と同じ値は、確認したときだけ同じ人として結合します。</p>
                  <ul className="alias-map">
                    {aliasPlans.map((a, i) => (
                      <li key={a.value}>
                        <div>
                          <span className="caption">CSVの値：</span>
                          {a.value}
                          {a.candidate && (
                            <label className="choice">
                              <input
                                type="checkbox"
                                checked={!!a.joinExisting}
                                onChange={(e) => setAliasPlans((l) => l.map((x, j) => (j === i ? { ...x, joinExisting: e.target.checked ? a.candidate : null } : x)))}
                              />
                              既存の {d.participantById.get(a.candidate)?.alias} と同じ人として結合する
                            </label>
                          )}
                        </div>
                        {a.joinExisting ? (
                          <span className="tag">{d.participantById.get(a.joinExisting)?.alias}</span>
                        ) : (
                          <div>
                            <label className="visually-hidden" htmlFor={`alias-${i}`}>
                              「{a.value}」の別名
                            </label>
                            <input id={`alias-${i}`} className="input" value={a.newAlias} onChange={(e) => setAliasPlans((l) => l.map((x, j) => (j === i ? { ...x, newAlias: e.target.value } : x)))} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {dups.length > 0 && (
                <section className="section" aria-labelledby="dup-h">
                  <h2 id="dup-h" className="h2">
                    同じ本文の確認
                  </h2>
                  {dups.map((x) => (
                    <fieldset key={x.row}>
                      <legend>
                        <Icon name="warning" size={16} /> {x.what}
                      </legend>
                      <label className="choice">
                        <input type="radio" name={`dup-${x.row}`} checked={dupChoice[x.row] === 'skip'} onChange={() => setDupChoice((c) => ({ ...c, [x.row]: 'skip' }))} />
                        今回は取り込まない
                      </label>
                      <label className="choice">
                        <input type="radio" name={`dup-${x.row}`} checked={dupChoice[x.row] === 'import'} onChange={() => setDupChoice((c) => ({ ...c, [x.row]: 'import' }))} />
                        別資料として取り込む
                      </label>
                    </fieldset>
                  ))}
                </section>
              )}

              <section className="section" aria-labelledby="prev-h">
                <h2 id="prev-h" className="h2">
                  プレビュー
                </h2>
                <ul className="preview-list">
                  {mapped.rows.slice(0, 50).map((r) => (
                    <li key={r.rowNo}>
                      <span className="marginal">{r.rowNo}行</span>
                      <span>
                        <span className="tag">{aliasPlans.find((a) => a.value === r.participantValue.trim())?.joinExisting ? d.participantById.get(aliasPlans.find((a) => a.value === r.participantValue.trim())!.joinExisting!)?.alias : aliasPlans.find((a) => a.value === r.participantValue.trim())?.newAlias ?? '—'}</span>
                        <span className="caption"> {r.title ?? ''}</span>
                      </span>
                      <span className="excerpt-text">{r.text}</span>
                    </li>
                  ))}
                </ul>
                {mapped.rows.length > 50 && <p className="caption">ほか{mapped.rows.length - 50}行</p>}
              </section>

              {blocking.length > 0 && (
                <Notice kind="warning" title="確認が必要です（まだ何も取り込んでいません）">
                  <ul style={{ paddingLeft: '1.2em' }}>
                    {blocking.slice(0, 30).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  {blocking.length > 30 && <p>ほか{blocking.length - 30}件</p>}
                </Notice>
              )}
              <div className="row" style={{ marginTop: 24 }}>
                <a className="btn btn-secondary" href={href.sources(kind, pid)}>
                  やめる
                </a>
                <button type="button" className="btn btn-primary" disabled={!canImport || busy || blocking.length > 0 || rowsToImport.length === 0} onClick={() => void commit()} aria-busy={busy}>
                  {slow ? '取り込み中…' : `${rowsToImport.length}件をまとめて取り込む`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </ProjectFrame>
  );
}
