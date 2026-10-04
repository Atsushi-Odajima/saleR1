// Service worker registration (web only). Updates wait until the user chooses to reload.
import { useSyncExternalStore } from 'react';
import { isElectron } from '../platform/platform';

let waiting: ServiceWorker | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => waiting !== null,
  );
}

export function registerServiceWorker() {
  if (isElectron() || !('serviceWorker' in navigator) || import.meta.env.DEV) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      const track = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            waiting = w;
            emit();
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        waiting = reg.waiting;
        emit();
      }
      reg.addEventListener('updatefound', () => track(reg.installing));
    })
    .catch(() => {
      /* offline shell unavailable; the app still works online */
    });
}

/** Called only from the user's explicit "再読込して更新" action. */
export function activateUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage({ type: 'KOEITO_ACTIVATE_UPDATE' });
}
