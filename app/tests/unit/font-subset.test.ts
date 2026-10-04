import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadHarfbuzz, subsetFont } from '../../src/platform/fontSubset';

describe('font subset', () => {
  it('subsets the bundled Noto Sans JP to a small TrueType', async () => {
    const hb = await loadHarfbuzz(async () => readFileSync('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm'));
    const font = new Uint8Array(readFileSync('../R01_Koeito/assets/fonts/NotoSansJP.ttf'));
    const t0 = Date.now();
    const out = subsetFont(hb, font, '顧客の声を、根拠のある提案へ。送料');
    const ms = Date.now() - t0;
    expect(out.byteLength).toBeGreaterThan(1000);
    expect(out.byteLength).toBeLessThan(200_000);
    expect(Array.from(out.subarray(0, 4))).toEqual([0, 1, 0, 0]);
    // second call works (memory reuse)
    expect(subsetFont(hb, font, 'あ').byteLength).toBeGreaterThan(500);
    console.log('subset bytes', out.byteLength, 'ms', ms);
  });
});
