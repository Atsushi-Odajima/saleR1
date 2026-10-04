// Debounced autosave (500 ms, flush on blur). Saves are based on the field values the
// user started from; if those changed elsewhere, we stop and show a conflict instead
// of overwriting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { markEditing, runSave } from '../app/saveStatus';
import { RepoError } from '../db/repo';

export interface AutosaveOptions<F extends Record<string, unknown>> {
  base: F;
  /** persist `draft`; `known` holds the values the draft was based on */
  save: (draft: F, known: F) => Promise<unknown>;
  validate?: (draft: F) => Partial<Record<keyof F, string>>;
  disabled?: boolean;
  delay?: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useAutosave<F extends Record<string, unknown>>(opts: AutosaveOptions<F>) {
  const { base, disabled } = opts;
  const [draft, setDraft] = useState<F>(base);
  const [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof F, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const known = useRef<F>(base);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setDirty = (v: boolean) => {
    if (v !== dirty.current) markEditing(v ? 1 : -1);
    dirty.current = v;
  };

  // incoming data from the database
  const baseKey = JSON.stringify(base);
  useEffect(() => {
    if (saving.current) return;
    if (!dirty.current) {
      known.current = base;
      draftRef.current = base;
      setDraft(base);
      setConflict(false);
    } else if (!same(base, known.current)) {
      setConflict(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) markEditing(-1);
    },
    [],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || saving.current || optsRef.current.disabled) return;
    const snapshot = draftRef.current;
    const errs = optsRef.current.validate?.(snapshot) ?? {};
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) return; // keep "編集中" until the input is valid
    saving.current = true;
    try {
      await runSave(async () => {
        await optsRef.current.save(snapshot, known.current);
        // committed: mark clean before the status is computed, so it reads "保存済み"
        known.current = snapshot;
        if (same(draftRef.current, snapshot)) setDirty(false);
      });
      setSaveError(null);
    } catch (e) {
      if (e instanceof RepoError && e.code === 'conflict') setConflict(true);
      setSaveError(e instanceof RepoError ? e.message : '保存できませんでした');
    } finally {
      saving.current = false;
    }
    // more edits happened while saving
    if (dirty.current && !same(draftRef.current, known.current) && !timer.current) {
      timer.current = setTimeout(() => void flush(), optsRef.current.delay ?? 500);
    }
  }, []);

  const setField = useCallback(
    <K extends keyof F>(k: K, v: F[K]) => {
      if (optsRef.current.disabled) return;
      const next = { ...draftRef.current, [k]: v };
      draftRef.current = next;
      setDraft(next);
      setDirty(!same(next, known.current));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), optsRef.current.delay ?? 500);
    },
    [flush],
  );

  /** discard local edits and load the latest stored values */
  const reloadLatest = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setDirty(false);
    known.current = optsRef.current.base;
    draftRef.current = optsRef.current.base;
    setDraft(optsRef.current.base);
    setConflict(false);
    setSaveError(null);
  }, []);

  return { draft, setField, flush, errors, conflict, saveError, reloadLatest, disabled: !!disabled };
}
