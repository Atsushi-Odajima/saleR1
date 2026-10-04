// Narrow, purpose-specific API exposed by the Electron preload (see electron/preload.ts).
export interface KoeitoBridge {
  platform: 'electron';
  chooseBackupFile(): Promise<{ name: string; bytes: Uint8Array } | null>;
  saveTextFile(req: { kind: 'backup' | 'html' | 'csv'; defaultName: string; content: string }): Promise<{ saved: boolean }>;
  savePdf(req: { defaultName: string; html: string }): Promise<{ saved: boolean; error?: string }>;
  openExternal(url: string): Promise<boolean>;
}
declare global {
  interface Window {
    koeito?: KoeitoBridge;
  }
}
export {};
