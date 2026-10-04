// Map a DOM selection back to raw-text UTF-16 offsets.
// Text segments carry data-o (their start offset); paragraph text containers carry
// data-ps / data-pe. Margin numbers and other decoration have no offsets and are skipped.

function num(el: Element, attr: string): number {
  return Number((el as HTMLElement).dataset[attr]);
}

export function boundaryToOffset(root: HTMLElement, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    const seg = parent?.closest('[data-o]');
    if (seg && root.contains(seg)) return num(seg, 'o') + offset;
    // decoration text (e.g. paragraph number) → start of that paragraph
    const para = parent?.closest('[data-para]')?.querySelector('[data-ps]');
    if (para) return num(para, 'ps');
    return null;
  }
  const el = node as HTMLElement;
  if (el.dataset?.o !== undefined) return offset === 0 ? num(el, 'o') : num(el, 'o') + (el.textContent?.length ?? 0);
  if (el.dataset?.ps !== undefined) {
    const child = el.childNodes[offset] as HTMLElement | undefined;
    if (!child) return num(el, 'pe');
    if (child.dataset?.o !== undefined) return num(child, 'o');
    return num(el, 'ps');
  }
  // generic container: the next paragraph start, or the end of the last paragraph
  const child = el.childNodes[offset] as HTMLElement | undefined;
  if (child) {
    const p = child.dataset?.ps !== undefined ? child : child.querySelector?.('[data-ps]');
    if (p) return num(p, 'ps');
  }
  const all = (el.closest('[data-reader]') ?? el).querySelectorAll('[data-pe]');
  const before = Array.from(all).filter((x) => (child ? x.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING : true));
  const last = before[before.length - 1];
  return last ? num(last, 'pe') : null;
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  const a = boundaryToOffset(root, r.startContainer, r.startOffset);
  const b = boundaryToOffset(root, r.endContainer, r.endOffset);
  if (a === null || b === null) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}
