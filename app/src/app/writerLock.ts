// One writer per origin via the Web Locks API. A second tab stays read-only until the
// first one is closed and the user presses "編集権を取得". We never steal the lock.
const LOCK_NAME = 'koeito-writer';
let held = false;

export function locksSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks && typeof navigator.locks.request === 'function';
}

export function acquireWriterLock(): Promise<boolean> {
  if (held) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    navigator.locks
      .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        held = true;
        resolve(true);
        // keep the lock for the lifetime of this page
        await new Promise<void>(() => {});
      })
      .catch(() => resolve(false));
  });
}
