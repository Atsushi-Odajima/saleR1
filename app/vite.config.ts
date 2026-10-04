import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
// @ts-expect-error plain mjs helper
import { loadReleaseConfig } from './scripts/lib/release-config.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function buildConfig(mode: string) {
  if (mode === 'release') {
    const { cfg, errors } = loadReleaseConfig();
    if (errors.length) throw new Error('Release build refused:\n - ' + errors.join('\n - '));
    return { kind: 'release', pubkey: cfg.licensePublicKeyJwk, cfg };
  }
  const testPub = path.resolve('.dev-keys/test-public.jwk.json');
  if (!existsSync(testPub)) throw new Error('test key missing: run `node scripts/ensure-test-keys.mjs`');
  return {
    kind: 'test',
    pubkey: JSON.parse(readFileSync(testPub, 'utf8')),
    cfg: { pwaUrl: null, sellerName: null, sellerContact: null, salesUrl: null, helpUrl: null },
  };
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Emits manifest.webmanifest and a precaching service worker with a content-hashed cache name. */
function pwaPlugin(version: string, info: Record<string, unknown>): Plugin {
  return {
    name: 'koeito-pwa',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const manifest = {
        name: 'Koeito',
        short_name: 'Koeito',
        description: '顧客の声を、根拠のある提案へ。',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#F2EEE5',
        theme_color: '#402A3D',
        icons: [
          { src: 'brand/pwa_icon_192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'brand/pwa_icon_512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      };
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'release-info.json', source: JSON.stringify(info) });
      const files = new Set<string>(Object.keys(bundle));
      for (const f of listFiles(path.resolve('public'))) files.add(f);
      files.add('manifest.webmanifest');
      files.add('./');
      const h = createHash('sha256');
      for (const [name, chunk] of Object.entries(bundle)) {
        h.update(name);
        h.update(chunk.type === 'chunk' ? chunk.code : typeof chunk.source === 'string' ? chunk.source : Buffer.from(chunk.source));
      }
      const list = [...files].filter((f) => !f.endsWith('.map') && f !== 'sw.js' && f !== '_headers').sort();
      const sw = readFileSync(path.resolve('src/sw/sw.js'), 'utf8')
        .replace('__CACHE_NAME__', `koeito-${version}-${h.digest('hex').slice(0, 12)}`)
        .replace('__PRECACHE__', JSON.stringify(list));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n  Content-Security-Policy: ${CSP}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/sw.js\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n`,
      });
    },
  };
}

function cspPlugin(): Plugin {
  return {
    name: 'koeito-csp',
    transformIndexHtml(html) {
      return html.replace('%KOEITO_CSP%', CSP);
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const bc = buildConfig(command === 'serve' ? 'development' : mode);
  const info = { kind: bc.kind, salesUrl: bc.cfg.salesUrl ?? null, helpUrl: bc.cfg.helpUrl ?? null };
  return {
    base: './',
    plugins: [react(), cspPlugin(), pwaPlugin(pkg.version, info)],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_KIND__: JSON.stringify(bc.kind),
      __LICENSE_PUBKEY__: JSON.stringify(bc.pubkey),
      __RELEASE_INFO__: JSON.stringify({
        pwaUrl: bc.cfg.pwaUrl ?? null,
        sellerName: bc.cfg.sellerName ?? null,
        sellerContact: bc.cfg.sellerContact ?? null,
        salesUrl: bc.cfg.salesUrl ?? null,
        helpUrl: bc.cfg.helpUrl ?? null,
      }),
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2022',
      assetsInlineLimit: 0,
      chunkSizeWarningLimit: 2000,
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
