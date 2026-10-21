import { describe, expect, it } from 'vitest';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource } from '../src/editor/source';
import { joinParagraphBackward } from '../src/editor/commands';
import { structureContext } from '../src/editor/structure';
import { renderMarkdown } from '../src/render/markdown';
import type { Commit } from '../src/protocol';
import { build } from 'esbuild';
import { rawCssPlugin } from '../../scripts/web-tooling.mjs';

function setup(text: string, anchor: number, head = anchor) {
  let i = 0;
  const raw = '\ufeff' + text.replace(/\n/g, () => ['\r\n', '\n', '\r'][i++ % 3]);
  const bytes = new TextEncoder().encode(raw), commits: Commit[] = [];
  const s = createSession({ ...decodeSource(bytes), revision: 0 }, c => commits.push(c));
  s.setMode('live'); s.dispatch({ selection: { anchor, head } });
  return { s, bytes, commits, selection: { anchor, head } };
}
async function history(f: ReturnType<typeof setup>) {
  expect(f.commits).toHaveLength(1);
  const after = encodeSource(f.s.snapshot());
  await f.s.command('undo'); expect(encodeSource(f.s.snapshot())).toEqual(f.bytes);
  expect(f.s.selection()).toEqual(f.selection);
  await f.s.command('redo'); expect(encodeSource(f.s.snapshot())).toEqual(after);
}
function depth(text: string, word: string) {
  let depth = 0;
  for (let n = structureContext(text).tree.resolveInner(text.indexOf(word), 1); n; n = n.parent!) {
    if (n.name === 'ListItem') depth++;
  }
  return depth;
}
const code = (text: string) => [...renderMarkdown(text).html.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/g)].map(m => m[1]);

it('initializes code ownership in the actual browser bundle without relying on function names', async () => {
  const result = await build({ stdin: { contents: `
    export { createTransport } from './web/src/main';
    export { liveExtensions } from './web/src/live/decorations';
    export { structureContext } from './web/src/editor/structure';
    export { renderMarkdown } from './web/src/render/markdown';
    export { createSession } from './web/src/editor/session';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false,
    platform: 'browser', format: 'iife', globalName: 'reviewBundle', plugins: [rawCssPlugin()] });
  const bundled = new Function(result.outputFiles[0].text + '; return reviewBundle;')();
  expect(bundled.structureContext('```\ncode\n```').literals).toHaveLength(1);
  expect(bundled.renderMarkdown('```\ncode\n```').html).toContain('<code>code\n</code>');
});

describe('review A: literal descendants retain their rendered code bytes', () => {
  it.each([
    ['> - previous\n> - parent\n>   >\t\tcode', '\tcode\n'],
    ['> - previous\n> - parent\n>   >\t    code', '    code\n'],
    ['> - previous\n> - parent\n>   >\t```\n>   >\t  code\n>   >\t```', '    code\n'],
    ['> - previous\n> - parent\n>   >\t```\n>   >\t  code\n>   >\t```\n>   > tail', '    code\n'],
    ['- previous\n- parent\n  ```\n  \tcode\n  ```', '\tcode\n'],
  ])('moves and outdents without changing code content: %j', async (text, body) => {
    expect(code(text)).toEqual([body]);
    const f = setup(text, text.indexOf('parent'));
    await f.s.command('format', { kind: 'indent' });
    expect(code(f.s.snapshot().text)).toEqual([body]);
    expect(depth(f.s.snapshot().text, 'parent')).toBe(2);
    await history(f);
    await f.s.command('format', { kind: 'outdent' });
    expect(code(f.s.snapshot().text)).toEqual([body]);
    expect(depth(f.s.snapshot().text, 'parent')).toBe(1);
  });
});

describe('review A: ordered hierarchy agrees with the actual renderer', () => {
  it('inserts only one separator when moving selected consecutive siblings', async () => {
    const text = '10. previous\n11. parent\n42. sibling\n99. untouched';
    for (const reverse of [false, true]) {
      const from = text.indexOf('parent'), to = text.indexOf('99.');
      const f = setup(text, reverse ? to : from, reverse ? from : to);
      await f.s.command('format', { kind: 'indent' });
      const expected = '10. previous\n\n    11. parent\n    42. sibling\n99. untouched';
      expect(f.s.snapshot().text).toBe(expected);
      expect(depth(expected, 'parent')).toBe(2); expect(depth(expected, 'sibling')).toBe(2);
      expect((renderMarkdown(expected).html.match(/<ol(?:\s|>)/g) ?? [])).toHaveLength(2);
      await history(f);
    }
  });
  it.each([
    ['10. previous\n11. parent\n    - child\n42. sibling', '10. previous\n\n    11. parent\n        - child\n42. sibling'],
    ['> 10. previous\n> 11. parent\n>     - child\n> 42. sibling', '> 10. previous\n> \n>     11. parent\n>         - child\n> 42. sibling'],
    ['1. previous\n2. parent', '1. previous\n\n   2. parent'],
    ['10. previous\n\n11. parent', '10. previous\n\n    11. parent'],
  ])('preserves the original child ordinal and outside siblings: %j', async (text, expected) => {
    const f = setup(text, text.indexOf('parent'));
    await f.s.command('format', { kind: 'indent' });
    expect(f.s.snapshot().text).toBe(expected);
    expect(depth(expected, 'parent')).toBe(2);
    const html = renderMarkdown(expected).html;
    expect((html.match(/<ol(?:\s|>)/g) ?? [])).toHaveLength(2);
    expect(html).toContain(text.includes('11.') ? '<ol start="11">' : '<ol start="2">');
    if (text.includes('child')) expect(depth(expected, 'child')).toBe(3);
    await history(f);
  });
});

describe('review A: complete multiline Setext conversion', () => {
  for (const prefix of ['', '> ', '- > ']) for (const level of [1, 2, 3, 6]) {
    it(`converts multiline heading at level ${level} in ${JSON.stringify(prefix)}`, async () => {
      const continuation = prefix.replace('-', ' ');
      const text = `${prefix}😀 Alpha\n${continuation}**Beta**\n${continuation}=====\n\ntail`;
      const f = setup(text, text.indexOf('Beta'));
      await f.s.command('format', { kind: 'heading', level });
      const expected = level <= 2 ? text.replace('=====', level === 1 ? '=====' : '-----')
        : `${prefix}${'#'.repeat(level)} 😀 Alpha **Beta**\n\ntail`;
      expect(f.s.snapshot().text).toBe(expected);
      const html = renderMarkdown(expected).html;
      expect(html).toContain(`<h${level}>😀 Alpha${level <= 2 ? '\n' : ' '}<strong>Beta</strong></h${level}>`);
      if (level === 1) expect(f.commits).toHaveLength(0); else await history(f);
    });
  }
});

describe('review A: mixed container continuation follows the actual inner marker', () => {
  it('retains the existing empty-list exit that removes the item indentation', async () => {
    const text = '  - item\n  - \nlast', f = setup(text, 13);
    await f.s.command('format', { kind: 'newline' });
    expect(f.s.snapshot().text).toBe('  - item\n\nlast');
    await history(f);
  });
  it.each([
    ['- > 7. AlphaBeta\n  > 42. sibling', 12, 12, '- > 7. Alpha\n  > 8. Beta\n  > 42. sibling'],
    ['> - > 7. AlphaBeta', 14, 14, '> - > 7. Alpha\n>   > 8. Beta'],
    ['- > * [X]\tAlphaBeta', 15, 15, '- > * [X]\tAlpha\n  > * [ ]\tBeta'],
    ['- > AlphaBeta', 9, 9, '- > Alpha\n  > Beta'],
    ['- > 7. Alpha chosen tail\n  > 42. sibling', 13, 19, '- > 7. Alpha \n  > 8.  tail\n  > 42. sibling'],
  ])('uses container continuation prefixes: %j', async (text, at, end, expected) => {
    for (const reverse of [false, true]) {
      const f = setup(text as string, reverse ? end as number : at as number, reverse ? at as number : end as number);
      await f.s.command('format', { kind: 'newline' });
      expect(f.s.snapshot().text).toBe(expected);
      const html = renderMarkdown(expected as string).html;
      expect(html).toContain('<blockquote>');
      if ((text as string).includes('7.')) {
        expect(depth(expected as string, (expected as string).includes('Beta') ? 'Beta' : 'tail')).toBe(2);
        expect((html.match(/<li>/g) ?? []).length).toBeGreaterThanOrEqual(3);
      }
      await history(f);
    }
  });
});

describe('review A: insertion boundaries and ordinary paragraph joins', () => {
  it.each(['> Alpha', '> > Alpha', '> - Alpha'])('does not duplicate untouched prefixes at offset zero: %j', async text => {
    const f = setup(text, 0);
    await f.s.command('format', { kind: 'newline' });
    expect(f.s.snapshot().text).toBe('\n' + text);
    expect(renderMarkdown(f.s.snapshot().text).html).toBe(renderMarkdown(text).html);
    await history(f);
  });
  it.each(['Alpha `code`', 'Alpha $x$', 'Alpha <b>x</b>', 'Alpha **bold**'])('joins after a closed inline literal in ordinary prose: %j', async first => {
    const text = first + '\n\nBeta', f = setup(text, first.length + 2);
    expect(joinParagraphBackward(f.s)).toBe(true);
    expect(f.s.snapshot().text).toBe(first + 'Beta');
    expect(f.s.selection()).toEqual({ anchor: first.length, head: first.length });
    await history(f);
  });
  it.each(['```\ncode\n```', '$$\nx\n$$', '<div>x</div>', 'Alpha $unclosed'])('does not join literal ownership across its boundary: %j', first => {
    const f = setup(first + '\n\nBeta', first.length + 2);
    expect(joinParagraphBackward(f.s)).toBe(false);
  });
});
