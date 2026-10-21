// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/render/markdown';
import { mathHitOffset } from '../src/live/math-hit';

/** Real renderer/DOM; only layout (unavailable in jsdom) is supplied here. */
function fixture(source: string, boxes: Record<string, [number, number, number, number]>) {
  const doc = document;
  doc.body.innerHTML = renderMarkdown(source).html;
  const dom = doc.querySelector<HTMLElement>('[data-math-from]')!;
  const raw = source.slice(Number(dom.dataset.mathFrom), Number(dom.dataset.mathTo));
  doc.defaultView!.Range.prototype.getClientRects = function () {
    const text = this.startContainer.textContent!.slice(this.startOffset, this.endOffset);
    const box = boxes[text];
    return (box ? [new doc.defaultView!.DOMRect(...box)] : []) as unknown as DOMRectList;
  };
  return { dom, raw, doc, hit: (x: number, y: number) => mathHitOffset(dom, raw, false, x, y) };
}

describe('source-mapped math hit rectangles', () => {
  it('distinguishes fraction rows without assuming HTML text order', () => {
    const { hit } = fixture('$\\frac{1}{2}$', { '1': [10, 0, 10, 10], '2': [10, 25, 10, 10] });
    expect(hit(11, 5)).toBe(7); expect(hit(19, 5)).toBe(8);
    expect(hit(11, 30)).toBe(10); expect(hit(19, 30)).toBe(11);
    expect(hit(15, 18)).toBeNull(); expect(hit(100, 5)).toBeNull();
  });
  it('accepts the fractional leading pixel truncated by native MouseEvent coordinates', () => {
    const { hit } = fixture('$\\frac{1}{2}$', { '1': [248.3125, 84.265625, 6.71875, 13], '2': [248.3125, 98.578125, 6.71875, 13] });
    expect(hit(248, 105)).toBe(10);
    expect(hit(247, 105)).toBeNull();
    expect(hit(248, 113)).toBeNull();
  });
  it('selects a character within a natively combined text span', () => {
    const { hit } = fixture('$\\text{abc}$', { b: [40, 10, 10, 12] });
    expect(hit(41, 15)).toBe(8); expect(hit(49, 15)).toBe(9);
  });
  it('maps transformed command glyphs atomically and minus to its source byte', () => {
    const { hit } = fixture('$\\alpha-7$', { 'α': [0, 0, 10, 10], '−': [20, 0, 10, 10] });
    expect(hit(1, 5)).toBe(1); expect(hit(9, 5)).toBe(7);
    expect(hit(21, 5)).toBe(7); expect(hit(29, 5)).toBe(8);
  });
  it('returns raw token relative offsets across container prefixes and CRLF', () => {
    const { hit } = fixture('😀\r\n\r\n> $$\r\n>   \\frac{1}{7}\r\n> $$', { '7': [10, 20, 10, 10] });
    expect(hit(19, 25)).toBe(18);
  });
  it('rejects a stale source even when it has the same UTF-16 length', () => {
    const { dom } = fixture('$\\alpha+7$', { 'α': [0, 0, 10, 10] });
    expect(mathHitOffset(dom, '$\\omega+7$', false, 1, 5)).toBeNull();
  });
  it('rejects malformed, missing, overlapping, hidden and zero-area geometry', () => {
    const { dom, hit } = fixture('$x+y$', { x: [0, 0, 10, 10], y: [0, 0, 10, 10] });
    expect(hit(1, 5)).toBeNull();
    dom.querySelector('[data-math-map]')!.setAttribute('data-math-map', '[[0,1,-1,999]]');
    expect(hit(1, 5)).toBeNull();
    const hidden = fixture('$x$', { x: [0, 0, 10, 10] });
    hidden.dom.style.visibility = 'hidden'; expect(hidden.hit(1, 5)).toBeNull();
    expect(fixture('$x$', { x: [0, 0, 0, 10] }).hit(0, 5)).toBeNull();
    expect(fixture('$\\neq$', { '≠': [0, 0, 10, 10] }).hit(1, 5)).toBeNull();
  });
  it('retains operator-gap selection only for a proven simple literal row', () => {
    const { hit } = fixture('$x+7$', { x: [0, 0, 10, 10], '+': [20, 0, 10, 10], '7': [40, 0, 10, 10] });
    expect(hit(14, 5)).toBe(2); expect(hit(18, 5)).toBe(2);
    expect(hit(18, 20)).toBeNull();
  });
});
