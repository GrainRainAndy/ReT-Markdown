// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { renderInlineContexts, renderMarkdown, richClipboard } from '../src/render/markdown';

function rendered(source: string) {
  const result = renderMarkdown(source);
  expect(result.issues).toEqual([]);
  document.body.innerHTML = result.html;
  return document;
}

function mapped(document: Document) {
  return [...document.querySelectorAll<HTMLElement>('.katex-html [data-math-map]')].flatMap(el =>
    (JSON.parse(el.dataset.mathMap!) as number[][]).map(([a, b, from, to]) => ({
      text: el.textContent!.slice(a, b), from, to,
    })));
}

describe('math renderer source provenance', () => {
  it.each([
    ['$\\frac{1}{2}$', '1', 7, 8],
    ['$\\frac{1}{2}$', '2', 10, 11],
    ['$x^{23}+4$', '3', 5, 6],
    ['$x_{23}+4$', '2', 4, 5],
    ['$\\sqrt[3]{x+7}$', '3', 7, 8],
    ['$\\sqrt[3]{x+7}$', '7', 12, 13],
    ['$\\alpha+7$', 'α', 1, 7],
    ['$x-7$', '−', 2, 3],
    ['$x +7$', '7', 4, 5],
    ['$\\frac{x^{7}}{\\sqrt{3+y}}$', '7', 10, 11],
    ['$\\text{abc}$', 'b', 8, 9],
    ['$\\hat{x}$', 'x', 6, 7],
    ['$$\\sum_{i=1}^{7}x_i$$', '7', 14, 15],
    ['$\\begin{matrix}1&2\\\\3&7\\end{matrix}$', '7', 22, 23],
  ])('maps %s glyph %s to its actual lexical interval', (source, text, from, to) => {
    const doc = rendered(source as string);
    const wrapper = doc.querySelector('[data-math-from]');
    expect(wrapper?.getAttribute('data-math-from')).toBe('0');
    expect(wrapper?.getAttribute('data-math-to')).toBe(String(source.length));
    expect(mapped(doc)).toContainEqual({ text, from, to });
  });

  it.each(['> ', '> > ', '- ', '> - '])('retains CRLF and stripped container trivia: %s', prefix => {
    const continuation = prefix.replace('- ', '  ');
    const source = '😀\r\n\r\n' + prefix + '$$\r\n' + continuation + '  \\frac{1}{7}\r\n' + continuation + '$$';
    const doc = rendered(source);
    const wrapper = doc.querySelector<HTMLElement>('[data-math-from]')!;
    const from = Number(wrapper?.dataset.mathFrom);
    expect(source.slice(from, Number(wrapper?.dataset.mathTo))).toBe(source.slice(6 + prefix.length));
    expect(mapped(doc).find(g => g.text === '7')).toEqual({ text: '7', from: source.indexOf('7') - from, to: source.indexOf('7') - from + 1 });
  });

  it('keeps duplicate table formulas and escaped pipe discontinuities in original coordinates', () => {
    const token = '$x\\|\\alpha$';
    const source = '😀\r\n\r\n| A | B |\r\n| - | - |\r\n|' + token + '|' + token + '|';
    const doc = rendered(source);
    const wrappers = [...doc.querySelectorAll<HTMLElement>('[data-math-from]')];
    expect(wrappers).toHaveLength(2);
    expect(wrappers.map(el => [Number(el.dataset.mathFrom), Number(el.dataset.mathTo)])).toEqual([[29, 40], [41, 52]]);
    for (const wrapper of wrappers) {
      const glyphs = mapped(wrapper.ownerDocument).filter(g => g.text === 'α');
      expect(glyphs).toContainEqual({ text: 'α', from: 4, to: 10 });
      expect(mapped(wrapper.ownerDocument)).toContainEqual({ text: '∣', from: 2, to: 4 });
    }
    const contexts = renderInlineContexts(source, wrappers.map(el => ({ from: Number(el.dataset.mathFrom), to: Number(el.dataset.mathTo) })));
    expect(contexts.every(result => result.html.includes('data-math-map'))).toBe(true);
  });

  it.each(['\\def\\foo{7}\\foo', '\\newcommand{\\foo}[1]{#1#1}\\foo{x}', '\\neq'])('does not claim macro expansion provenance: %s', tex => {
    const doc = rendered('$' + tex + '$');
    expect(doc.querySelector('[data-math-from]')).not.toBeNull();
    expect(mapped(doc)).toEqual([]);
  });

  it.each(['\\frac{x^{23}}{\\sqrt[3]{y_7}}', '\\alpha-12', '\\text{office abc}', '\\hat{x}', '\\begin{matrix}1&2\\\\3&7\\end{matrix}', '\\sum_{i=1}^{7}x_i'])('only adds attributes to native HTML: %s', tex => {
    const doc = rendered('$' + tex + '$');
    const wrapper = doc.querySelector('[data-math-from]')!;
    expect(wrapper).not.toBeNull();
    for (const element of wrapper.querySelectorAll('*')) for (const attr of [...element.attributes]) {
      if (attr.name.startsWith('data-math-')) element.removeAttribute(attr.name);
    }
    const native = document.createElement('div');
    native.innerHTML = katex.renderToString(tex, { trust: false, strict: 'ignore', throwOnError: true, maxExpand: 1000, maxSize: 50 });
    const baseline = native.innerHTML;
    expect(wrapper.innerHTML).toBe(baseline);
  });

  it('keeps untrusted HTML disabled and clipboard math as MathML', () => {
    const source = '$\\htmlData{math-start=1}{x}$';
    expect(renderMarkdown(source).html).not.toContain('data-math-start="1"');
    const clipboard = richClipboard('$\\frac{1}{2}$').html;
    expect(clipboard).toContain('<math');
    expect(clipboard).not.toContain('data-math-map');
  });
});
