// Global save status: 編集中 → 保存中 → この端末に保存済み / 未保存（失敗）.
// "saved" is only shown after the IndexedDB transaction has committed.
import { useSyncExternalStore } from 'react';
import { RepoError } from '../db/repo';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string; storage: boolean };

let state: SaveState = { kind: 'idle' };
let pending = 0;
let dirty = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function set(s: SaveState) {
  state = s;
  emit();
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

export function markEditing(delta: 1 | -1) {
  dirty = Math.max(0, dirty + delta);
  if (dirty > 0 && pending === 0 && state.kind !== 'error') set({ kind: 'editing' });
}

export function hasUnsaved(): boolean {
  return dirty > 0 || pending > 0;
}

export function errorMessage(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  return '保存できませんでした。入力内容は画面に残っています。バックアップを保存してから再試行してください';
}

/** Run a write and reflect it in the save status. Re-throws so callers can keep input. */
export async function runSave<T>(fn: () => Promise<T>): Promise<T> {
  pending++;
  set({ kind: 'saving' });
  try {
    const r = await fn();
    pending--;
    if (pending === 0) set(dirty > 0 ? { kind: 'editing' } : { kind: 'saved', at: Date.now() });
    return r;
  } catch (e) {
    pending--;
    set({ kind: 'error', message: errorMessage(e), storage: e instanceof RepoError && e.code === 'storage' });
    throw e;
  }
}

export function clearSaveError() {
  if (state.kind === 'error') set(dirty > 0 ? { kind: 'editing' } : { kind: 'idle' });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (ev) => {
    if (hasUnsaved()) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });
}
