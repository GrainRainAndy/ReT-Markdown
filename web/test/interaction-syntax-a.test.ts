import { describe, expect, it } from 'vitest';
import { syntaxSpans } from '../src/live/syntax';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

describe('A parser-owned fenced boundaries', () => {
  it.each([
    ['```\na\n```', { opening: { from: 0, to: 3 }, closing: { from: 6, to: 9 }, body: { from: 4, to: 6 }, ownsEOF: false }],
    ['> ```\n> a\n> ```', { opening: { from: 2, to: 5 }, closing: { from: 12, to: 15 }, body: { from: 6, to: 10 }, ownsEOF: false }],
    ['```\na\n', { opening: { from: 0, to: 3 }, closing: null, body: { from: 4, to: 6 }, ownsEOF: true }],
    ['```', { opening: { from: 0, to: 3 }, closing: null, body: { from: 3, to: 3 }, ownsEOF: true }],
    ['````\na\n```', { opening: { from: 0, to: 4 }, closing: null, body: { from: 5, to: 10 }, ownsEOF: true }],
    ['```\n~~~', { opening: { from: 0, to: 3 }, closing: null, body: { from: 4, to: 7 }, ownsEOF: true }],
    ['> ```\n> a\n\noutside', { opening: { from: 2, to: 5 }, closing: null, body: { from: 6, to: 9 }, ownsEOF: false }],
    ['~~~js\n~~~', { opening: { from: 0, to: 3 }, closing: { from: 6, to: 9 }, body: { from: 6, to: 6 }, ownsEOF: false }],
  ])('exposes actual markers, physical body lines and EOF: %j', (text, fence) => {
    expect(syntaxSpans(text as string).find(s => s.kind === 'code')).toHaveProperty('fence', fence);
  });
  it('does not attach fence metadata to other syntax', () => {
    expect(syntaxSpans('    code\n\n`inline`\n\n$$x$$').every(s => !('fence' in s))).toBe(true);
  });
  it.each([
    ['regular-256k', '8006de70d5b4ee7c60b93245f810f326114c2da32009477c1564b2152756c6e8'],
    ['boundary-1m', 'e7e3ea9bc3c87efc5d1f2c70a8088baa2393bf678efe6b50b3c155b330d48b11'],
  ])('retains every existing span field while adding fence metadata: %s', async (name, hash) => {
    const source = await readFile(`build/fixtures/${name}.md`, 'utf8');
    const legacyFields = syntaxSpans(source).map(({ fence: _fence, ...span }) => span);
    expect(createHash('sha256').update(JSON.stringify(legacyFields)).digest('hex')).toBe(hash);
  });
});
