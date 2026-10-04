// Font subsetting with HarfBuzz (wasm, no imports). Used to embed only the glyphs a
// report needs, so the single-file HTML stays small and offline-safe.

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_length(b: number): number;
  hb_blob_get_data(b: number, lenPtr: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(s: number, cp: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

let hbPromise: Promise<HbExports> | null = null;

export function loadHarfbuzz(wasmBytes: () => Promise<ArrayBuffer | Uint8Array>): Promise<HbExports> {
  if (!hbPromise) {
    hbPromise = (async () => {
      const bytes = await wasmBytes();
      const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
      return instance.exports as unknown as HbExports;
    })();
    hbPromise.catch(() => {
      hbPromise = null;
    });
  }
  return hbPromise;
}

/** Return a TrueType subset containing the code points of `text` (plus basic Latin). */
export function subsetFont(hb: HbExports, font: Uint8Array, text: string): Uint8Array {
  const ptr = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, ptr);
  const blob = hb.hb_blob_create(ptr, font.byteLength, 2 /* WRITABLE */, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error('subset_input');
    const set = hb.hb_subset_input_unicode_set(input);
    const cps = new Set<number>();
    for (const ch of text) cps.add(ch.codePointAt(0)!);
    for (let c = 0x20; c < 0x7f; c++) cps.add(c);
    for (const c of cps) hb.hb_set_add(set, c);
    const sub = hb.hb_subset_or_fail(face, input);
    if (!sub) throw new Error('subset_failed');
    const resBlob = hb.hb_face_reference_blob(sub);
    const off = hb.hb_blob_get_data(resBlob, 0);
    const len = hb.hb_blob_get_length(resBlob);
    const out = new Uint8Array(len);
    out.set(new Uint8Array(hb.memory.buffer, off, len));
    hb.hb_blob_destroy(resBlob);
    hb.hb_face_destroy(sub);
    return out;
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(ptr);
  }
}
