// Platform differences are limited to saving files, choosing the backup file, and printing.
import './bridge.d';
import { RELEASE_INFO } from '../config';

export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.koeito && window.koeito.platform === 'electron';

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

const MIME = { backup: 'application/octet-stream', html: 'text/html;charset=utf-8', csv: 'text/csv;charset=utf-8' } as const;

/** Electron: OS save dialog (main process writes the file). Web: browser download. */
export async function saveTextFile(kind: 'backup' | 'html' | 'csv', defaultName: string, content: string): Promise<SaveOutcome> {
  if (isElectron()) {
    const r = await window.koeito!.saveTextFile({ kind, defaultName, content });
    return r.saved ? 'saved' : 'cancelled';
  }
  const blob = new Blob([content], { type: MIME[kind] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  // A browser cannot confirm where (or whether) the file was written.
  return 'downloaded';
}

export async function shareFile(defaultName: string, content: string, mime: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  const file = new File([content], defaultName, { type: mime });
  if (!nav.canShare || !nav.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch {
    return false;
  }
}

export type PdfOutcome = 'saved' | 'cancelled' | 'print_dialog_opened' | 'popup_blocked' | 'error';

/**
 * Electron: isolated print window + printToPDF + save dialog.
 * Web: new document window with only the report, then the browser print dialog.
 * The print dialog result cannot be observed on the web, so it is never recorded as a saved PDF.
 */
export async function exportPdf(html: string, defaultName: string): Promise<PdfOutcome> {
  if (isElectron()) {
    const r = await window.koeito!.savePdf({ defaultName, html });
    if (r.error) return 'error';
    return r.saved ? 'saved' : 'cancelled';
  }
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    return 'popup_blocked';
  }
  const doPrint = async () => {
    try {
      await (w.document as Document & { fonts?: FontFaceSet }).fonts?.ready;
      w.focus();
      w.print();
    } catch {
      /* user can still print from the opened window */
    }
  };
  if (w.document.readyState === 'complete' && w.location.href === url) void doPrint();
  else w.addEventListener('load', () => void doPrint(), { once: true });
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return 'print_dialog_opened';
}

/** Only allow-listed official HTTPS URLs open in the OS browser; no research content is attached. */
export function allowedExternalUrls(): string[] {
  return [RELEASE_INFO.salesUrl, RELEASE_INFO.helpUrl].filter((u): u is string => !!u && u.startsWith('https://'));
}

export async function openExternal(url: string): Promise<void> {
  if (!allowedExternalUrls().includes(url)) return;
  if (isElectron()) await window.koeito!.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
