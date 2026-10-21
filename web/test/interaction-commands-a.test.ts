import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource } from '../src/editor/source';
import * as commands from '../src/editor/commands';
import type { Mode } from '../src/protocol';
import MarkdownIt from 'markdown-it';

const setup = (raw: string, at: number, end = at, mode: Mode = 'live') => {
  const s = createSession({ ...decodeSource(new TextEncoder().encode(raw)), revision: 0 }, () => {});
  s.setMode(mode); s.dispatch({ selection: { anchor: at, head: end } }); return s;
};

describe('A newline ownership and local replacement', () => {
  for (const mode of ['live', 'source'] as const) {
    it.each(['$$\n- x\n$$', '$$\n- x', '```\n- x\n```', '<div>\n- x\n</div>'])
      (`uses literal Enter before list rules (${mode}): %j`, async text => {
        const at = text.indexOf('x') + 1, s = setup(text, at, at, mode);
        await s.command('format', { kind: 'newline' });
        expect(s.snapshot().text).toBe(text.slice(0, at) + '\n' + text.slice(at));
      });
  }
  it.each([
    ['> AlphaBeta', 7, 7, '> Alpha\n> Beta'],
    ['> > AlphaBeta', 9, 9, '> > Alpha\n> > Beta'],
    ['> 9) [X]\tAlphaBeta\n> 42) next', 14, 14, '> 9) [X]\tAlpha\n> 10) [ ]\tBeta\n> 42) next'],
    ['+ Alpha chosen tail\n+ next', 8, 14, '+ Alpha \n+  tail\n+ next'],
    ['7. AlphaBeta\n42. next', 8, 8, '7. Alpha\n8. Beta\n42. next'],
    ['> - ', 4, 4, '> '],
    ['> Alpha\n\n# Head tail', 5, 15, '> Alp\n>  tail'],
  ] as const)('preserves prefix and unselected suffix: %j', async (text, at, end, expected) => {
    for (const reverse of [false, true]) {
      const s = setup(text, reverse ? end : at, reverse ? at : end);
      await s.command('format', { kind: 'newline' }); expect(s.snapshot().text).toBe(expected);
      await s.command('undo'); expect(s.snapshot().text).toBe(text);
    }
  });
});

describe('A structural formatting', () => {
  it.each([1, 2, 3, 6])('consumes the complete Setext heading at level %i', async level => {
    const raw = '\ufeffAlpha\r\n=====\r\n\r\ntail', s = setup(raw, 2);
    await s.command('format', { kind: 'heading', level });
    expect(s.snapshot().text).toBe(level < 3 ? `Alpha\n${level === 1 ? '=====' : '-----'}\n\ntail` : `${'#'.repeat(level)} Alpha\n\ntail`);
    if (level < 3) expect(s.selection()).toEqual({ anchor: 2, head: 2 });
    await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
  });
  for (const kind of ['heading', 'orderedList', 'taskList', 'quote']) {
    it.each(['```\n- x\n```', '$$\n- x\n$$', '<div>\n- x\n</div>', '    - x'])
      (`skips literal blocks for live ${kind}: %j`, async text => {
        const s = setup(text, 0, text.length);
        await s.command('format', { kind, level: 2 }); expect(s.snapshot().text).toBe(text);
      });
  }
  it('skips the complete literal block in a cross-block heading selection', async () => {
    const s = setup('Alpha\n\n```\n- x\n```\n\nOmega', 0, 25);
    await s.command('format', { kind: 'heading', level: 2 });
    expect(s.snapshot().text).toBe('## Alpha\n\n```\n- x\n```\n\n## Omega');
  });
  it('allows explicit source heading edits inside HTML', async () => {
    const s = setup('<div>\nAlpha\n</div>', 7, 7, 'source');
    await s.command('format', { kind: 'heading', level: 2 });
    expect(s.snapshot().text).toBe('<div>\n## Alpha\n</div>');
  });
});

describe('A list hierarchy movement', () => {
  it.each([
    ['10. previous\n11. parent\n    - child\n12. next', 'parent', '10. previous\n\n    11. parent\n        - child\n12. next', '10. previous\n\n11. parent\n    - child\n12. next'],
    ['> 10. previous\n> 11. parent\n>     - child\n> 12. next', 'parent', '> 10. previous\n> \n>     11. parent\n>         - child\n> 12. next', '> 10. previous\n> \n> 11. parent\n>     - child\n> 12. next'],
    ['- previous\n- parent\n  - child\n- next', 'parent', '- previous\n  - parent\n    - child\n- next'],
    ['> - previous\n> - parent', 'parent', '> - previous\n>   - parent'],
    ['-\tprevious\n- parent\n  - child', 'parent', '-\tprevious\n    - parent\n      - child'],
  ])('moves an item with descendants under the previous sibling: %j', async (text, word, expected, outdented?: string) => {
    const s = setup(text, text.indexOf(word));
    await s.command('format', { kind: 'indent' }); expect(s.snapshot().text).toBe(expected);
    const tree = markdownLanguage.parser.parse(s.snapshot().text);
    let depth = 0;
    for (let n = tree.resolveInner(s.snapshot().text.indexOf(word), 1); n; n = n.parent!) if (n.name === 'ListItem') depth++;
    expect(depth).toBe(2);
    if (outdented) expect(new MarkdownIt().parse(s.snapshot().text, {}).filter(t => t.type === 'ordered_list_open')).toHaveLength(2);
    // Outdent preserves an existing separator; Undo is the byte-exact inverse.
    await s.command('format', { kind: 'outdent' }); expect(s.snapshot().text).toBe(outdented ?? text);
    await s.command('undo'); await s.command('undo'); expect(s.snapshot().text).toBe(text);
  });
  it('keeps ordinary indentation controls', async () => {
    const s = setup('plain', 2); await s.command('format', { kind: 'indent' });
    expect(s.snapshot().text).toBe('  plain'); await s.command('format', { kind: 'outdent' }); expect(s.snapshot().text).toBe('plain');
  });
  it.each([
    '- previous\n- parent\n  -\t\t literal\n        - code',
    '> - previous\n> - parent\n>   -\t\t literal\n>         - code',
    '- previous\n- parent\n  ```\n  \tcode\n  ```',
    '- previous\n- parent\n  >\t- child\n  >\t  continuation',
  ])('preserves descendant literal and paragraph content while moving: %j', async text => {
    const md = new MarkdownIt(), bodies = (value: string) => md.parse(value, {}).filter(t =>
      ['inline', 'code_block', 'fence'].includes(t.type)).map(t => [t.type, t.content]);
    const expected = bodies(text), s = setup(text, text.indexOf('parent'));
    await s.command('format', { kind: 'indent' }); expect(bodies(s.snapshot().text)).toEqual(expected);
    await s.command('format', { kind: 'outdent' }); expect(bodies(s.snapshot().text)).toEqual(expected);
    await s.command('undo'); await s.command('undo'); expect(s.snapshot().text).toBe(text);
  });
});

describe('A ordinary paragraph join', () => {
  it('joins exactly two LF and restores original bytes through root history', async () => {
    const raw = '\ufeffAlpha\r\n\nBeta\rtail', s = setup(raw, 7);
    expect(commands).toHaveProperty('joinParagraphBackward');
    expect((commands as any).joinParagraphBackward(s)).toBe(true);
    expect(s.snapshot().text).toBe('AlphaBeta\ntail'); expect(s.selection()).toEqual({ anchor: 5, head: 5 });
    await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
  });
  it.each([
    ['Alpha\n\n\nBeta', 8, 'live'], ['# Alpha\n\nBeta', 9, 'live'],
    ['Alpha\n\nBeta', 7, 'source'], ['Alpha\n\n Beta', 8, 'live'],
    ['$$\nx\n$$\n\nBeta', 9, 'live'], ['Alpha\n\n> Beta', 9, 'live'],
  ] as const)('declines nonstandard paragraph join: %j', (text, at, mode) => {
    const s = setup(text, at, at, mode); expect(commands).toHaveProperty('joinParagraphBackward');
    expect((commands as any).joinParagraphBackward(s)).toBe(false); expect(s.snapshot().text).toBe(text);
  });
});
