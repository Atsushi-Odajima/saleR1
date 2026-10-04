declare const __APP_VERSION__: string;
declare const __BUILD_KIND__: 'test' | 'release';
declare const __LICENSE_PUBKEY__: JsonWebKey | null;
declare const __RELEASE_INFO__: {
  pwaUrl: string | null;
  sellerName: string | null;
  sellerContact: string | null;
  salesUrl: string | null;
  helpUrl: string | null;
};

export const APP_VERSION = __APP_VERSION__;
export const BUILD_KIND = __BUILD_KIND__;
export const IS_TEST_BUILD = __BUILD_KIND__ !== 'release';
export const LICENSE_PUBKEY = __LICENSE_PUBKEY__;
export const RELEASE_INFO = __RELEASE_INFO__;
