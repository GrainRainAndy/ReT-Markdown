import { describe, expect, it } from 'vitest';
import { isLiteralRange } from '../src/editor/structure';
import { createSession } from '../src/editor/session';
import { decodeSource } from '../src/editor/source';

describe('A shared literal ownership', () => {
  it.each([
    ['$$\n- x\n$$', 5, true], ['$$\n- x\n', 7, true],
    ['A $x$ tail', 3, true], ['A $x$ tail', 5, false], ['A $x', 4, true],
    ['```\n- x\n', 8, true], ['```\n```\n', 8, false],
    ['> ```\n> x\n\ntail', 11, false], ['    - x', 6, true],
    ['<div>\n- x\n</div>', 8, true], ['`- x`', 3, true],
    ['- x', 2, false], ['# x', 2, false], ['Alpha\n\nBeta', 7, false],
  ] as const)('classifies insertion ownership: %j at %i', (text, at, expected) => {
    expect(isLiteralRange(text, at)).toBe(expected);
  });
  it('protects any intersected literal range, including reversed selection', () => {
    const text = 'Alpha $x$ tail';
    expect(isLiteralRange(text, 0, 9)).toBe(true);
    expect(isLiteralRange(text, 9, 0)).toBe(true);
    expect(isLiteralRange(text, 0, 6)).toBe(false);
  });
});

describe('A adjacent container controls', () => {
  const setup = (text: string, at: number) => {
    const s = createSession({ ...decodeSource(new TextEncoder().encode(text)), revision: 0 }, () => {});
    s.setMode('live'); s.dispatch({ selection: { anchor: at } }); return s;
  };
  it('keeps ordinary Tab outdent as removal of one indentation unit', async () => {
    const s = setup('\tplain', 3);
    await s.command('format', { kind: 'outdent' }); expect(s.snapshot().text).toBe('plain');
  });
  it.each([
    ['\tplain', 'indent', '  \tplain'],
    [' \tplain', 'outdent', '\tplain'],
    ['    code\n\tmore', 'indent', '      code\n\tmore'],
  ])('keeps ordinary whitespace bytes outside the edited unit: %j', async (text, kind, expected) => {
    const s = setup(text, 3); await s.command('format', { kind }); expect(s.snapshot().text).toBe(expected);
  });
  it.each(['> ```\n> - x\n> ```', '> $$\n> - x\n> $$', '> <div>\n> - x\n> </div>'])
    ('keeps the real quote container during literal Enter: %j', async text => {
      const at = text.indexOf('x') + 1, s = setup(text, at);
      await s.command('format', { kind: 'newline' });
      expect(s.snapshot().text).toBe(text.slice(0, at) + '\n> ' + text.slice(at));
    });
  it.each(['```\n> - x\n```', '$$\n> - x\n$$', '<div>\n> - x\n</div>'])
    ('does not invent a quote from literal content: %j', async text => {
      const at = text.indexOf('x') + 1, s = setup(text, at);
      await s.command('format', { kind: 'newline' });
      expect(s.snapshot().text).toBe(text.slice(0, at) + '\n' + text.slice(at));
    });
  it('keeps list marker and task whitespace when replacing a selection', async () => {
    const text = '  *\t[X]\tAlpha chosen tail\n  * sibling', s = setup(text, 14);
    s.dispatch({ selection: { anchor: 20, head: 14 } });
    await s.command('format', { kind: 'newline' });
    expect(s.snapshot().text).toBe('  *\t[X]\tAlpha \n  *\t[ ]\t tail\n  * sibling');
  });
});
