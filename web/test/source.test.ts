import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPatches, decodeSource, encodeSource } from '../src/editor/source';
import type { Source, Patch, Envelope, Commit } from '../src/protocol';

const bytes = (text: string) => new TextEncoder().encode(text);
const decoded = (text: string) => decodeSource(bytes(text));
const fixtures = new URL('../../build/fixtures/', import.meta.url);

describe('source byte fidelity', () => {
  it.each(['', '\ufeff', '\ufeff\ufeffx', 'a\r\nb\rc\nend', 'a\r\n', 'a\r', 'a\n', 'e\u0301 ≠ é 😀 中\u0000'])('round trips %j without rewriting bytes', text => {
    expect(encodeSource(decoded(text))).toEqual(bytes(text));
  });
  it('normalizes only terminators and extracts exactly one leading BOM', () => {
    expect(decoded('\ufeffa\r\nb\rc\n\ufeffe\u0301')).toEqual({
      text: 'a\nb\nc\n\ufeffe\u0301', eols: ['\r\n', '\r', '\n'], bom: true,
    });
  });
  it.each(readdirSync(fixtures).filter(name => name.endsWith('.md')))('matches controller fixture %s byte for byte', name => {
    const input = new Uint8Array(readFileSync(new URL(name, fixtures)));
    expect(encodeSource(decodeSource(input))).toEqual(input);
  });
  it.each([[0xff], [0x80], [0xc0, 0xaf], [0xc2], [0xe2, 0x28, 0xa1], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xef, 0xbb]])('rejects malformed UTF-8 %j', (...input) => {
    expect(() => decodeSource(Uint8Array.from(input))).toThrow();
  });
  it.each([
    { text: 'a\n', eols: [], bom: false },
    { text: 'a', eols: ['\n'], bom: false },
    { text: 'a\n', eols: ['x'], bom: false },
    { text: 'a\r', eols: [], bom: false },
    { text: '\ud800', eols: [], bom: false },
    { text: '\udc00', eols: [], bom: false },
    { text: '', eols: [], bom: 'false' },
  ])('rejects invalid source %j before encoding', input => {
    expect(() => encodeSource(input as Source)).toThrow();
    expect(() => applyPatches(input as Source, [])).toThrow();
  });
});

describe('simultaneous UTF-16 patches', () => {
  it('edits a middle paragraph and preserves exact prefix and suffix bytes', () => {
    const prefix = '\ufeff---\r\nx: e\u0301\r---\n\n';
    const suffix = '\r\n\r<custom a="x">😀</custom>\n';
    const source = decoded(prefix + 'middle' + suffix);
    const from = decoded(prefix).text.length;
    const before = structuredClone(source);
    const result = applyPatches(source, [{ from, to: from + 6, insert: '中间', eols: [] }]);
    expect(encodeSource(result)).toEqual(bytes(prefix + '中间' + suffix));
    expect(source).toEqual(before);
  });
  it('uses pre-transaction positions and replaces only affected EOL entries', () => {
    const source = decoded('😀a\r\nb\rc\nend');
    const result = applyPatches(source, [
      { from: 2, to: 4, insert: 'X\nY\n', eols: ['\r', '\r\n'] },
      { from: 6, to: 7, insert: 'Z', eols: [] },
    ]);
    expect(encodeSource(result)).toEqual(bytes('😀X\rY\r\nb\rZ\nend'));
  });
  it('allows edits between combining scalars and complete emoji', () => {
    expect(applyPatches(decoded('e\u0301😀'), [{ from: 1, to: 2, insert: '', eols: [] }]).text).toBe('e😀');
    expect(applyPatches(decoded('e\u0301😀'), [{ from: 2, to: 4, insert: '中', eols: [] }]).text).toBe('e\u0301中');
  });
  it('preserves insertion ordering for adjacent zero-width patches', () => {
    expect(applyPatches(decoded('ab'), [
      { from: 1, to: 1, insert: 'X', eols: [] },
      { from: 1, to: 1, insert: 'Y', eols: [] },
    ]).text).toBe('aXYb');
  });
  it('can remove every terminator without adding a final newline', () => {
    expect(encodeSource(applyPatches(decoded('a\r\nb\rc\n'), [
      { from: 1, to: 6, insert: '', eols: [] },
    ]))).toEqual(bytes('a'));
  });
  const p = (from: number, to: number, insert = '', eols: string[] = []) => ({ from, to, insert, eols });
  it.each([
    [p(1, 2)], [p(0, 1)], [p(-1, 0)], [p(0, 99)], [p(3, 2)], [p(0.5, 2)],
    [p(NaN, 2)], [p(0, Infinity)], [p(Number.MAX_SAFE_INTEGER + 1, 0)],
    [p(3, 3), p(2, 2)], [p(0, 3), p(2, 4)],
    [p(2, 2, '\r')], [p(2, 2, '\n')], [p(2, 2, '', ['\n'])],
    [p(2, 2, '\n', ['bad'])], [p(2, 2, '\ud800')],
    [p(2, 2, 'valid'), p(3, 4, '\n')],
  ])('rejects malformed transaction %j atomically', (...patches) => {
    const source = decoded('😀a\r\nb');
    const before = structuredClone(source);
    expect(() => applyPatches(source, patches as Patch[])).toThrow();
    expect(source).toEqual(before);
  });
});

it('serializes the architecture commit envelope without renaming or nesting fields', () => {
  const message: Envelope<'commit'> = {
    v: 1, documentID: 'doc', sessionID: 'session', id: 'web-1', type: 'commit',
    payload: { base: 0, revision: 1, patches: [{ from: 0, to: 0, insert: '😀\n', eols: ['\r\n'] }],
      selection: { anchor: 3, head: 3 }, reason: 'edit' } satisfies Commit,
  };
  expect(JSON.parse(JSON.stringify(message))).toEqual({
    v: 1, documentID: 'doc', sessionID: 'session', id: 'web-1', type: 'commit',
    payload: { base: 0, revision: 1, patches: [{ from: 0, to: 0, insert: '😀\n', eols: ['\r\n'] }],
      selection: { anchor: 3, head: 3 }, reason: 'edit' },
  });
});
