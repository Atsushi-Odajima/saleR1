// Koeito Electron main process.
// Security: contextIsolation, sandbox, no nodeIntegration, custom secure origin koeito://app,
// all permissions denied, navigation/new windows denied, network limited to the local shell.
import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, net, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const SCHEME = 'koeito';
const ORIGIN = 'koeito://app';
const DIST = path.join(__dirname, '..', 'dist');
const MAX_TEXT = 40 * 1024 * 1024; // backup ≤30MiB (+base64/JSON), HTML with fonts
const MAX_BACKUP_READ = 30 * 1024 * 1024;

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// fixed appId/name → %APPDATA%\Koeito for both the installer and the portable exe
app.setName('Koeito');
if (process.platform === 'win32') app.setAppUserModelId('jp.koeito.app');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

let allowedExternal: string[] = [];
async function loadReleaseInfo() {
  try {
    const raw = await fs.readFile(path.join(DIST, 'release-info.json'), 'utf8');
    const info = JSON.parse(raw) as { salesUrl?: string | null; helpUrl?: string | null };
    allowedExternal = [info.salesUrl, info.helpUrl].filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));
  } catch {
    allowedExternal = [];
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve koeito://app/<path> to a file inside dist, rejecting traversal and absolute paths. */
export function resolveAppPath(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:` || u.host !== 'app') return null;
  let p: string;
  try {
    p = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\') || /(^|\/)\.\.(\/|$)/.test(p)) return null;
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(DIST, p));
  const rel = path.relative(DIST, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

function registerProtocol() {
  protocol.handle(SCHEME, async (req) => {
    const file = resolveAppPath(req.url);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const body = await fs.readFile(file);
      const headers: Record<string, string> = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      };
      if (file.endsWith('.html')) headers['Content-Security-Policy'] = CSP;
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const ok = u.startsWith(`${ORIGIN}/`) || u === ORIGIN || u.startsWith('data:') || u.startsWith('blob:koeito://app/') || u.startsWith('devtools:') || u.startsWith('file:') || u === 'about:blank';
    cb({ cancel: !ok });
  });
}

function senderOk(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return url.startsWith(`${ORIGIN}/`) && mainWindow !== null && e.sender === mainWindow.webContents && e.senderFrame === mainWindow.webContents.mainFrame;
}

function lockDownContents(wc: WebContents, allowAppNavigation: boolean) {
  wc.on('will-navigate', (ev, url) => {
    if (!(allowAppNavigation && url.startsWith(`${ORIGIN}/`))) ev.preventDefault();
  });
  wc.on('will-redirect', (ev) => ev.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (allowedExternal.includes(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    backgroundColor: '#F2EEE5',
    title: 'Koeito',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  lockDownContents(mainWindow.webContents, true);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
  void mainWindow.loadURL(`${ORIGIN}/index.html`);
}

// ---------- IPC: narrow, validated, purpose-specific ----------
const TEXT_KINDS = {
  backup: { ext: 'koeito', name: 'Koeitoバックアップ' },
  html: { ext: 'html', name: 'HTML' },
  csv: { ext: 'csv', name: 'CSV' },
} as const;

function cleanName(n: unknown, ext: string): string {
  const s = typeof n === 'string' ? n : '';
  const base = path.basename(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || `koeito.${ext}`;
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

ipcMain.handle('koeito:saveTextFile', async (e, req: unknown) => {
  if (!senderOk(e) || !mainWindow) return { saved: false };
  const r = req as { kind?: unknown; defaultName?: unknown; content?: unknown };
  if (typeof r !== 'object' || r === null || typeof r.content !== 'string' || typeof r.kind !== 'string' || !(r.kind in TEXT_KINDS)) return { saved: false };
  if (r.content.length > MAX_TEXT) return { saved: false };
  const k = TEXT_KINDS[r.kind as keyof typeof TEXT_KINDS];
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: cleanName(r.defaultName, k.ext), filters: [{ name: k.name, extensions: [k.ext] }] });
  if (res.canceled || !res.filePath) return { saved: false };
  await fs.writeFile(res.filePath, r.content, 'utf8');
  return { saved: true };
});

ipcMain.handle('koeito:chooseBackupFile', async (e) => {
  if (!senderOk(e) || !mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Koeitoバックアップ', extensions: ['koeito'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  const st = await fs.stat(res.filePaths[0]);
  if (!st.isFile() || st.size > MAX_BACKUP_READ) return { name: path.basename(res.filePaths[0]), bytes: new Uint8Array(MAX_BACKUP_READ + 1) };
  const buf = await fs.readFile(res.filePaths[0]);
  return { name: path.basename(res.filePaths[0]), bytes: new Uint8Array(buf) };
});

ipcMain.handle('koeito:openExternal', async (e, url: unknown) => {
  if (!senderOk(e) || typeof url !== 'string' || !allowedExternal.includes(url)) return false;
  await shell.openExternal(url);
  return true;
});

/** Print the generated report HTML in an isolated window (no preload, no navigation) and save as PDF. */
ipcMain.handle('koeito:savePdf', async (e, req: unknown) => {
  if (!senderOk(e) || !mainWindow) return { saved: false, error: 'sender' };
  const r = req as { html?: unknown; defaultName?: unknown };
  if (typeof r !== 'object' || r === null || typeof r.html !== 'string' || r.html.length > MAX_TEXT || !r.html.startsWith('<!DOCTYPE html>')) return { saved: false, error: 'payload' };
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: cleanName(r.defaultName, 'pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (res.canceled || !res.filePath) return { saved: false };
  const tmp = path.join(app.getPath('temp'), `koeito-print-${randomUUID()}.html`);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, webSecurity: true, partition: `koeito-print-${randomUUID()}`, spellcheck: false, devTools: false },
  });
  const ps = win.webContents.session;
  ps.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  ps.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !(d.url === pathToFileURL(tmp).href || d.url.startsWith('data:')) }));
  lockDownContents(win.webContents, false);
  try {
    await fs.writeFile(tmp, r.html, 'utf8');
    await win.loadFile(tmp);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    await fs.writeFile(res.filePath, pdf);
    return { saved: true };
  } catch {
    return { saved: false, error: 'print' };
  } finally {
    win.destroy();
    await fs.rm(tmp, { force: true });
  }
});

// test hook (never in packaged builds): render HTML to PDF bytes without dialogs
if (!app.isPackaged && process.env.KOEITO_E2E_PDF_OUT) {
  ipcMain.handle('koeito:testPdf', async (e, html: string) => {
    if (!senderOk(e)) return false;
    const tmp = path.join(app.getPath('temp'), `koeito-print-${randomUUID()}.html`);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, partition: `koeito-print-${randomUUID()}` } });
    try {
      await fs.writeFile(tmp, html, 'utf8');
      await win.loadFile(tmp);
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
      await fs.writeFile(process.env.KOEITO_E2E_PDF_OUT!, pdf);
      return true;
    } finally {
      win.destroy();
      await fs.rm(tmp, { force: true });
    }
  });
}

app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    await loadReleaseInfo();
    registerProtocol();
    hardenSession();
    void net; // network stack is not used by the app
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
