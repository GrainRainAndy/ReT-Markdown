interface Glyph { rect: DOMRect; from: number; to: number }

/** Exact UTF-16 offset relative to the raw token (including delimiters).
 * Metadata follows parser provenance; DOM order is irrelevant to complex TeX.
 */
export function mathHitOffset(dom: HTMLElement, source: string, _block: boolean, x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const wrappers = dom.matches('[data-math-from]') ? [dom] : [...dom.querySelectorAll<HTMLElement>('[data-math-from]')];
  if (wrappers.length !== 1) return null;
  const wrapper = wrappers[0], from = Number(wrapper.dataset.mathFrom), to = Number(wrapper.dataset.mathTo);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to - from !== source.length) return null;
  try { if (JSON.parse(wrapper.dataset.mathSource ?? '') !== source) return null; } catch { return null; }
  const roots = wrapper.querySelectorAll('.katex-html');
  if (roots.length !== 1) return null;
  const doc = dom.ownerDocument, win = doc.defaultView;
  if (!win) return null;
  const glyphs: Glyph[] = [];
  for (const el of roots[0].querySelectorAll<HTMLElement>('[data-math-map]')) {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) return null;
    let hidden = false;
    for (let parent: Element | null = el; parent; parent = parent.parentElement) {
      const style = win.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') { hidden = true; break; }
    }
    if (hidden) continue;
    let segments: unknown;
    try { segments = JSON.parse(el.dataset.mathMap ?? ''); } catch { return null; }
    if (!Array.isArray(segments)) return null;
    let previous = 0;
    for (const segment of segments) {
      if (!Array.isArray(segment) || segment.length !== 4 || !segment.every(Number.isSafeInteger)) return null;
      const [start, end, sourceFrom, sourceTo] = segment;
      if (start !== previous || end <= start || end > node.textContent!.length || sourceFrom < 0 || sourceTo <= sourceFrom || sourceTo > source.length) return null;
      previous = end;
      const range = doc.createRange(); range.setStart(node, start); range.setEnd(node, end);
      const rects = range.getClientRects();
      if (rects.length !== 1) continue;
      const rect = rects[0];
      if (![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
      glyphs.push({ rect, from: sourceFrom, to: sourceTo });
    }
    if (previous !== node.textContent!.length) return null;
  }
  let hits = glyphs.filter(({ rect }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  // MouseEvent client coordinates truncate fractional CSS pixels. A narrow
  // glyph's first painted pixel may therefore report just before its Range.
  // Prefer exact hits; otherwise accept only one intersecting pixel footprint.
  if (!hits.length && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0) {
    hits = glyphs.filter(({ rect }) => x < rect.right && x + 1 > rect.left && y < rect.bottom && y + 1 > rect.top);
  }
  if (hits.length === 1) {
    const { rect, from, to } = hits[0];
    return x < (rect.left + rect.right) / 2 ? from : to;
  }
  if (hits.length > 1) return null;

  // Bridge operator spacing only for a complete, source-ordered literal row.
  // Never apply nearest-edge or total-width estimates to complex structures.
  const literal = /^(\${1,2})([A-Za-z0-9+*\/=().,:<>!?|\-]+)\1$/.exec(source);
  if (!literal || glyphs.length !== literal[2].length) return null;
  const ordered = [...glyphs].sort((a, b) => a.from - b.from);
  let top = -Infinity, bottom = Infinity, right = -Infinity;
  for (let i = 0; i < ordered.length; i++) {
    const glyph = ordered[i], offset = literal[1].length + i;
    if (glyph.from !== offset || glyph.to !== offset + 1 || glyph.rect.left < right) return null;
    top = Math.max(top, glyph.rect.top); bottom = Math.min(bottom, glyph.rect.bottom); right = glyph.rect.right;
  }
  if (top >= bottom || y < top || y > bottom || x < ordered[0].rect.left || x > right) return null;
  let distance = Infinity, result: number | null = null;
  for (const glyph of ordered) for (const [edge, offset] of [[glyph.rect.left, glyph.from], [glyph.rect.right, glyph.to]]) {
    if (Math.abs(x - edge) < distance) { distance = Math.abs(x - edge); result = offset; }
  }
  return result;
}
