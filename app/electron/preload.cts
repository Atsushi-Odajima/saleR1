// Sandboxed preload: exposes only purpose-specific functions. No raw ipcRenderer, no fs.
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  platform: 'electron' as const,
  chooseBackupFile: (): Promise<{ name: string; bytes: Uint8Array } | null> => ipcRenderer.invoke('koeito:chooseBackupFile'),
  saveTextFile: (req: { kind: 'backup' | 'html' | 'csv'; defaultName: string; content: string }): Promise<{ saved: boolean }> => {
    if (!req || typeof req.content !== 'string' || !['backup', 'html', 'csv'].includes(req.kind)) return Promise.resolve({ saved: false });
    return ipcRenderer.invoke('koeito:saveTextFile', { kind: req.kind, defaultName: String(req.defaultName ?? ''), content: req.content });
  },
  savePdf: (req: { defaultName: string; html: string }): Promise<{ saved: boolean; error?: string }> => {
    if (!req || typeof req.html !== 'string') return Promise.resolve({ saved: false, error: 'payload' });
    return ipcRenderer.invoke('koeito:savePdf', { defaultName: String(req.defaultName ?? ''), html: req.html });
  },
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('koeito:openExternal', String(url)),
};

contextBridge.exposeInMainWorld('koeito', api);
if (process.env.KOEITO_E2E_PDF_OUT) {
  contextBridge.exposeInMainWorld('koeitoTest', { pdf: (html: string): Promise<boolean> => ipcRenderer.invoke('koeito:testPdf', html) });
}
