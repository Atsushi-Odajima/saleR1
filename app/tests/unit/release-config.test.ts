import { describe, it, expect } from 'vitest';
// @ts-expect-error plain mjs helper
import { validateReleaseConfig } from '../../scripts/lib/release-config.mjs';
// @ts-expect-error plain mjs helper
import { ensureTestKeys, generateKeyPair } from '../../scripts/lib/license-lib.mjs';

describe('release-config validation (production builds must fail on missing/fake values)', () => {
  it('accepts a complete config with a non-test public key', async () => {
    const { pub } = await generateKeyPair();
    expect(validateReleaseConfig({ pwaUrl: 'https://koeito-app.pages.dev/', licensePublicKeyJwk: pub, sellerName: '販売者名', sellerContact: 'support@koeito-shop.jp', salesUrl: null, helpUrl: null })).toEqual([]);
  });
  it('rejects missing, placeholder, http, test key and private key component', async () => {
    const { pub, priv } = await generateKeyPair();
    const test = (await ensureTestKeys()).pub;
    const base = { pwaUrl: 'https://koeito-app.pages.dev/', licensePublicKeyJwk: pub, sellerName: 'x販売', sellerContact: 'support@koeito-shop.jp' };
    expect(validateReleaseConfig({})).not.toEqual([]);
    expect(validateReleaseConfig({ ...base, pwaUrl: 'https://example.com/' }).join()).toMatch(/placeholder/);
    expect(validateReleaseConfig({ ...base, pwaUrl: 'http://koeito-app.pages.dev/' }).join()).toMatch(/https/);
    expect(validateReleaseConfig({ ...base, sellerContact: 'TODO' }).join()).toMatch(/placeholder/);
    expect(validateReleaseConfig({ ...base, licensePublicKeyJwk: test }).join()).toMatch(/TEST key/);
    expect(validateReleaseConfig({ ...base, licensePublicKeyJwk: priv }).join()).toMatch(/PRIVATE/);
    expect(validateReleaseConfig({ ...base, extra: 1 }).join()).toMatch(/unknown key/);
  });
});
