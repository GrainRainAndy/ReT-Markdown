import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource } from '../src/editor/source';
import { renderMarkdown } from '../src/render/markdown';
import type { Commit } from '../src/protocol';
import { build } from 'esbuild';
import { rawCssPlugin } from '../../scripts/web-tooling.mjs';

const parser = new MarkdownIt({ html: true });
function code(text: string) {
  return {
    blocks: parser.parse(text, {}).filter(t => t.type === 'fence' || t.type === 'code_block')
      .map(t => ({ type: t.type, body: t.content })),
    rendered: [...renderMarkdown(text).html.matchAll(/<pre\b[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map(m => m[1]),
  };
}
function parentDepth(text: string) {
  let depth = 0;
  for (const token of parser.parse(text, {})) {
    if (token.type === 'list_item_open') depth++;
    if (token.type === 'list_item_close') depth--;
    if (token.type === 'inline' && token.content === 'parent') return depth;
  }
  throw new Error('Missing parent list item');
}

async function move(text: string, kind: 'indent' | 'outdent') {
  let line = 0;
  const bytes = new TextEncoder().encode('\ufeff' + text.replace(/\n/g, () => ['\r\n', '\n', '\r'][line++ % 3]));
  const commits: Commit[] = [];
  const s = createSession({ ...decodeSource(bytes), revision: 0 }, c => commits.push(c));
  s.setMode('live');
  const at = text.indexOf('parent'), selection = { anchor: at, head: at };
  s.dispatch({ selection });
  const before = code(text);
  expect(before.blocks.length).toBeGreaterThan(0);
  await s.command('format', { kind });
  const after = s.snapshot().text;
  expect(code(after)).toEqual(before);
  expect(parentDepth(after)).toBe(parentDepth(text) + (kind === 'indent' ? 1 : -1));
  for (const word of ['previous', 'parent', 'untouched']) {
    expect(after.split(word).length).toBe(text.split(word).length);
  }
  if (text.startsWith('outside\n\n')) expect(after.startsWith('outside\n\n')).toBe(true);
  if (text.endsWith('\n\ntail\tKEEP')) expect(after.endsWith('\n\ntail\tKEEP')).toBe(true);
  const untouched = text.split('\n').find(l => l.endsWith('untouched'));
  if (untouched) expect(after.split('\n')).toContain(untouched);
  expect(commits).toHaveLength(1);
  const edited = encodeSource(s.snapshot());
  const originalRaw = new TextDecoder().decode(bytes), editedRaw = new TextDecoder().decode(edited);
  if (untouched) expect(editedRaw.slice(editedRaw.indexOf(untouched))).toBe(originalRaw.slice(originalRaw.indexOf(untouched)));
  if (text.startsWith('outside\n\n')) {
    expect(editedRaw.slice(0, editedRaw.indexOf('previous') + 8)).toBe(originalRaw.slice(0, originalRaw.indexOf('previous') + 8));
  }
  await s.command('undo');
  expect(encodeSource(s.snapshot())).toEqual(bytes);
  expect(s.selection()).toEqual(selection);
  await s.command('redo');
  expect(encodeSource(s.snapshot())).toEqual(edited);
  s.destroy();
  return after;
}

describe('quoted Tab prefixes preserve code classification and literal body', () => {
  it.each([
    ['> 10. previous\n> 11. parent\n>     >\t\tcode', 'code_block', 'code\n'],
    ['> - previous\n> - parent\n>   >\t ```\n>   >\t   code\n>   >\t ```', 'fence', '    code\n'],
  ])('accepted repro survives indent and outdent: %j', async (text, type, body) => {
    expect(code(text)).toEqual({ blocks: [{ type, body }], rendered: [body] });
    const indented = await move(text, 'indent');
    await move(indented, 'outdent');
  });
});

const samples: { marker: string; depth: number; outer: string; separator: string;
  gap: string; shape: string; text: string; nested: string }[] = [];
for (const marker of ['- ', '1. ', '10. ', '100. ']) {
  for (const depth of [1, 2, 3]) for (const outer of ['', '> ']) {
    for (const separator of [' ', '\t', '']) {
      for (const gap of ['\t', '\t\t', ' \t', '  \t', '\t ', '\t  ', '\t    ', ' \t\t', ' ', '    ']) {
        for (const shape of ['indented', 'fenced']) {
          const prefix = outer + ' '.repeat(marker.length) + ('>' + separator).repeat(depth - 1) + '>' + gap;
          const lines = shape === 'fenced'
            ? [prefix + '```', prefix + '  code\tKEEP', prefix + '```']
            : [prefix + '    \tcode\tKEEP'];
          const text = 'outside\n\n' + outer + marker + 'previous\n' + outer + marker + 'parent\n'
            + lines.join('\n') + '\n' + outer + marker + 'untouched\n\ntail\tKEEP';
          // Independent raw nested fixture: outdent must also handle original
          // Tabs, rather than only prefixes canonicalized by a prior indent.
          const nested = 'outside\n\n' + outer + marker + 'previous\n' + outer + '\n'
            + outer + ' '.repeat(marker.length) + marker + 'parent\n'
            + lines.map(l => outer + ' '.repeat(marker.length) + l.slice(outer.length)).join('\n')
            + '\n' + outer + marker + 'untouched\n\ntail\tKEEP';
          samples.push({ marker, depth, outer, separator, gap, shape, text, nested });
        }
      }
    }
  }
}
describe('deterministic parent-width / quote-depth / whitespace / code-shape matrix', () => {
  it.each(samples)('preserves $shape with marker=$marker depth=$depth outer=$outer separator=$separator gap=$gap', async ({ text }) => {
    const indented = await move(text, 'indent');
    await move(indented, 'outdent');
  });
  it.each(samples)('outdents raw $shape with marker=$marker depth=$depth outer=$outer separator=$separator gap=$gap', async ({ nested }) => {
    await move(nested, 'outdent');
  });
});

describe('fence body indentation is independent of delimiter indentation', () => {
  for (const marker of ['- ', '1. ', '10. ', '100. ']) for (const depth of [1, 2, 3]) {
    for (const delimiter of [' ', '  ', '   ', '    ']) for (const gap of ['', ' ', '\t', '\t ', ' \t', '\t\t', '  \t', '    ', '\t    ']) {
      it(`retains body ${JSON.stringify(gap)} with delimiter ${JSON.stringify(delimiter)} at depth ${depth} under ${marker}`, async () => {
        const prefix = '> ' + ' '.repeat(marker.length) + '> '.repeat(depth - 1) + '>';
        const body = [`${prefix}${delimiter}\`\`\``, `${prefix}${gap}code\tKEEP`, `${prefix}${delimiter}\`\`\``];
        const text = `> ${marker}previous\n> ${marker}parent\n${body.join('\n')}`;
        expect(code(text).blocks[0]?.type).toBe('fence');
        const indented = await move(text, 'indent');
        await move(indented, 'outdent');
        const nested = `> ${marker}previous\n>\n> ${' '.repeat(marker.length)}${marker}parent\n`
          + body.map(l => '> ' + ' '.repeat(marker.length) + l.slice(2)).join('\n');
        await move(nested, 'outdent');
      });
    }
  }
});

it('preserves code through the production browser dependency graph', async () => {
  const result = await build({ stdin: { contents: `
    export { createTransport } from './web/src/main';
    export { liveExtensions } from './web/src/live/decorations';
    export { createSession } from './web/src/editor/session';
    export { renderMarkdown } from './web/src/render/markdown';
  `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false,
    platform: 'browser', target: ['safari17', 'chrome120'], format: 'iife',
    globalName: 'prefixBundle', plugins: [rawCssPlugin()] });
  const bundled = new Function(result.outputFiles[0].text + '; return prefixBundle;')() as {
    createSession: typeof createSession; renderMarkdown: typeof renderMarkdown;
  };
  for (const text of [
    '> 10. previous\n> 11. parent\n>     >\t\tcode',
    '> - previous\n> - parent\n>   >\t ```\n>   >\t   code\n>   >\t ```',
    '> - previous\n> - parent\n>   > ```\n>   >\tcode\n>   > ```',
  ]) {
    const s = bundled.createSession({ ...decodeSource(new TextEncoder().encode(text)), revision: 0 }, () => {});
    s.setMode('live'); s.dispatch({ selection: { anchor: text.indexOf('parent') } });
    const original = code(text);
    for (const kind of ['indent', 'outdent']) {
      await s.command('format', { kind });
      expect(code(s.snapshot().text)).toEqual(original);
      const actual = [...bundled.renderMarkdown(s.snapshot().text).html.matchAll(/<pre\b[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map(m => m[1]);
      expect(actual).toEqual(original.rendered);
    }
    s.destroy();
  }
});
