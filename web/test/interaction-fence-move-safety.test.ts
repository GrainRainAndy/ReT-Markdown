import { describe, expect, it } from 'vitest';
import MarkdownIt from 'markdown-it';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource } from '../src/editor/source';
import { renderMarkdown } from '../src/render/markdown';
import type { Commit } from '../src/protocol';
import { isLiteralRange, structureContext } from '../src/editor/structure';
import { redoDepth, undoDepth } from '@codemirror/commands';

const parser = new MarkdownIt({ html: true });
function parent(text: string) {
  const tokens = parser.parse(text, {}), stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'list_item_open') stack.push(i);
    if (token.type === 'list_item_close') stack.pop();
    if (token.type !== 'inline' || token.content !== 'parent') continue;
    const start = stack.at(-1)!, level = tokens[start].level;
    let end = i;
    while (tokens[end].type !== 'list_item_close' || tokens[end].level !== level) end++;
    return {
      depth: stack.length,
      tree: tokens.slice(start, end + 1).map(t => ({ type: t.type, level: t.level - level, content: t.content, info: t.info })),
    };
  }
  throw new Error('Missing parent item');
}
function code(text: string) {
  return {
    blocks: parser.parse(text, {}).filter(t => t.type === 'fence' || t.type === 'code_block')
      .map(t => ({ type: t.type, body: t.content, info: t.info })),
    html: [...renderMarkdown(text).html.matchAll(/<pre\b[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)].map(m => m[1]),
  };
}
async function move(text: string, kind: 'indent' | 'outdent') {
  let eol = 0;
  const bytes = new TextEncoder().encode('\ufeff' + text.replace(/\n/g, () => ['\r\n', '\r', '\n'][eol++ % 3]));
  const commits: Commit[] = [];
  const s = createSession({ ...decodeSource(bytes), revision: 0 }, c => commits.push(c));
  const selection = { anchor: text.indexOf('parent'), head: text.indexOf('parent') };
  try {
    s.setMode('live'); s.dispatch({ selection });
    const before = code(text), tree = parent(text);
    expect(before.blocks.length).toBeGreaterThan(0);
    await s.command('format', { kind });
    const after = s.snapshot().text, edited = encodeSource(s.snapshot());
    expect(code(after)).toEqual(before);
    expect(parent(after).tree).toEqual(tree.tree);
    expect(parent(after).depth).toBe(tree.depth + (kind === 'indent' ? 1 : -1));
    expect(commits).toHaveLength(1);
    const originalRaw = new TextDecoder().decode(bytes), editedRaw = new TextDecoder().decode(edited);
    expect(editedRaw.slice(0, editedRaw.indexOf('previous') + 8)).toBe(originalRaw.slice(0, originalRaw.indexOf('previous') + 8));
    if (text.includes('untouched')) {
      const untouched = text.split('\n').find(l => l.endsWith('untouched'))!;
      expect(editedRaw.slice(editedRaw.indexOf(untouched))).toBe(originalRaw.slice(originalRaw.indexOf(untouched)));
    }
    await s.command('undo');
    expect(encodeSource(s.snapshot())).toEqual(bytes);
    expect(s.selection()).toEqual(selection);
    await s.command('redo');
    expect(encodeSource(s.snapshot())).toEqual(edited);
    return after;
  } finally { s.destroy(); }
}

const accepted = '> - previous\n> - parent\n>   >>   ```\n>   >>\t ```\n>   >>   tail\n>   >>   ```';
it('literal ownership follows the renderer past a false Lezer closing fence', () => {
  expect(isLiteralRange(accepted, accepted.indexOf('tail'))).toBe(true);
});

it('does not grant literal ownership to a false Lezer fence after the real closer', () => {
  const text = '> - previous\n> - parent\n>   >   ```\n>   >\t ```\n>   > tail';
  expect(code(text).blocks).toEqual([{ type: 'fence', body: '', info: '' }]);
  expect(isLiteralRange(text, text.indexOf('tail'))).toBe(false);
});

it('accepted A1: literal matching backticks remain body and tail remains code', async () => {
  expect(code(accepted).blocks).toEqual([{ type: 'fence', body: ' ```\ntail\n', info: '' }]);
  const indented = await move(accepted, 'indent');
  expect(indented).toBe('> - previous\n>   - parent\n>     >>   ````\n>     >>    ```\n>     >>   tail\n>     >>   ````');
  await move(indented, 'outdent');
});

it('shared ranges identify actual opening, body and closing despite false Lezer marks', () => {
  const fence = structureContext(accepted).fences[0];
  expect(fence).toEqual({
    from: accepted.indexOf('>   >>'), to: accepted.length,
    opening: { from: accepted.indexOf('```'), to: accepted.indexOf('```') + 3 },
    closing: { from: accepted.lastIndexOf('```'), to: accepted.length },
    bodyRange: { from: accepted.indexOf('>   >>\t'), to: accepted.lastIndexOf('\n') + 1 },
    ownsEOF: false, content: ' ```\ntail\n',
  });
});

it.each(['`', '~'])('shared tree retains real fence ownership and parses following emphasis (%s)', char => {
  const text = accepted.replace(/`/g, char).replace('tail', '- x') + '\n\n**outside**';
  const tree = structureContext(text).tree, fences: { from: number; to: number }[] = [];
  tree.iterate({ enter(node) { if (node.name === 'FencedCode') fences.push({ from: node.from, to: node.to }); } });
  expect(fences).toEqual([{ from: text.indexOf(char.repeat(3)), to: text.lastIndexOf(char.repeat(3)) + 3 }]);
  expect(tree.resolveInner(text.indexOf('- x') + 2, 1).name).toBe('CodeText');
  expect(tree.resolveInner(text.indexOf('outside') + 2, 1).name).toBe('StrongEmphasis');
});

it('shared tree preserves CodeInfo Unicode and trailing EOF CodeText coordinates', () => {
  const text = '```js\u00a0 \t\ncode\n';
  const fence = structureContext(text).tree.topNode.getChild('FencedCode')!;
  const info = fence.getChild('CodeInfo')!, body = fence.getChild('CodeText')!;
  expect(text.slice(info.from, info.to)).toBe('js\u00a0');
  expect(text.slice(body.from, body.to)).toBe('code\n');
});

it.each(['', '\n'])('keeps an EOF fence unclosed through indent/outdent (%j)', async ending => {
  const text = accepted.slice(0, accepted.lastIndexOf('\n')) + ending;
  expect(structureContext(text).fences[0].closing).toBeNull();
  expect(structureContext(text).fences[0].ownsEOF).toBe(true);
  for (const after of [await move(text, 'indent')]) {
    const fence = structureContext(after).fences[0];
    expect(fence.closing).toBeNull();
    expect(fence.ownsEOF).toBe(true);
    expect(fence.bodyRange.to).toBe(after.length);
    expect(after.slice(fence.opening.from, fence.opening.to)).toBe('````');
    const outdented = await move(after, 'outdent');
    expect(structureContext(outdented).fences[0].closing).toBeNull();
  }
});

it('grows beyond all matching body runs while retaining info, longer closing and unrelated fences', async () => {
  const text = accepted.replace('>>   ```\n', '>>   ``` unknown\t \n')
    .replace('>>   tail', '>>\t `````\n>   >>   tail')
    .replace(/```$/, '```````\t ')
    + '\n>   >>\n>   >> ~~~safe\n>   >> SAFE\n>   >> ~~~\n> - untouched\n\n```outside\nKEEP\n```';
  const after = await move(text, 'indent');
  expect(after).toContain('>>   `````` unknown\t \n');
  expect(after).toContain('>>   ```````\t ');
  expect(parser.parse(after, {}).filter(t => t.type === 'fence').map(t => t.markup)).toEqual(['``````', '~~~', '```']);
  expect(structureContext(after).fences[0].closing).not.toBeNull();
});

it('does not lengthen a safe fence merely because its body contains matching characters', async () => {
  const text = accepted.replace('>>\t ```', '>>\t ``` payload');
  const after = await move(text, 'indent');
  expect(parser.parse(after, {}).filter(t => t.type === 'fence').map(t => t.markup)).toEqual(['```']);
});

// Independent raw outdent fixtures ensure correctness is not dependent on a
// prior indent having already expanded the delimiter or normalized the Tabs.
const samples: { label: string; text: string; nested: string }[] = [];
for (const marker of ['- ', '10. ']) for (const quote of ['>', '>>', '> >']) {
  for (const char of ['`', '~']) for (const length of [3, 4]) for (const closed of [false, true]) {
    for (const body of [char.repeat(length), char.repeat(length + 2), (char === '`' ? '~' : '`').repeat(length), char.repeat(length) + ' payload']) {
      for (const gap of ['\t ', ' \t', '\t\t', '     ']) {
        const outer = length === 3 ? '> ' : '';
        const prefix = outer + ' '.repeat(marker.length) + quote;
        const lines = [prefix + '   ' + char.repeat(length) + ' unknown', prefix + gap + body, prefix + '\t ', prefix + '   tail\tKEEP'];
        if (closed) lines.push(prefix + '   ' + char.repeat(length + 1) + '\t ');
        const after = '\n' + outer + marker + 'untouched\n\n~~~outside\nKEEP\tBYTES\n~~~';
        const text = 'outside\n\n' + outer + marker + 'previous\n' + outer + marker + 'parent\n' + lines.join('\n') + after;
        const nested = 'outside\n\n' + outer + marker + 'previous\n' + outer + '\n'
          + outer + ' '.repeat(marker.length) + marker + 'parent\n'
          + lines.map(l => outer + ' '.repeat(marker.length) + l.slice(outer.length)).join('\n') + after;
        samples.push({ label: JSON.stringify({ marker, quote, char, length, closed, body, gap }), text, nested });
      }
    }
  }
}
describe('fence-looking body lines retain renderer body and parent block tree', () => {
  it.each(samples)('indent then outdent $label', async ({ text }) => {
    await move(await move(text, 'indent'), 'outdent');
  });
  it.each(samples)('independent raw outdent $label', async ({ nested }) => {
    await move(nested, 'outdent');
  });
});

// These six actual list moves used to commit a changed renderer code sequence.
// Unsupported structure must preserve the entire operation, including history.
const unsupportedMoves = [
  '>\t1) previous\n>\t1) parent\n>\t   > > \t``` unknown\n>\t   > >\t```\n>\t   > >     \n>\t   > >\tlast\tZ\n>\t   > >\t ```',
  '>\t1) previous\n>\t1) parent\n>\t   > >   ``` unknown\n>\t   > >\t```\n>\t   > >\t\t\n>\t   > >last\tZ\n>\t   > >\t ```',
  '> - previous\n> - parent\n>   >>\t ```` unknown\n>   >>  \ta\tZ\n>   >>     \n>   >>last\tZ\n>   >> ````',
  '>\t1) previous\n>\t1) parent\n>\t   > ``` unknown\n>\t   >```\n>\t   > \t\n>\t   >last\tZ\n>\t   >\t ```',
  '>\t1) previous\n>\t1) parent\n>\t   >  ``` unknown\n>\t   >    ```\n>\t   >     \n>\t   >last\tZ\n>\t   >\t ```',
  '9. previous\n9. parent\n   >\t ```` unknown\n   >\t😀 code\n   >\t\n   > \tlast\tZ',
];
describe('atomic renderer code postcondition for structural moves', () => {
  it.each(unsupportedMoves.map((text, i) => ({ text, number: i + 1 })))('known case $number preserves source, selection, revision, commits and history', async ({ text }) => {
    let eol = 0;
    const bytes = new TextEncoder().encode('\ufeff' + text.replace(/\n/g, () => ['\r\n', '\r', '\n'][eol++ % 3]));
    const commits: Commit[] = [], s = createSession({ ...decodeSource(bytes), revision: 7 }, c => commits.push(c));
    try {
      s.setMode('live');
      const selection = { anchor: text.indexOf('parent'), head: text.indexOf('parent') };
      s.dispatch({ selection });
      expect(parent(text).depth).toBe(1);
      const before = s.snapshot(), blocks = code(text);
      await s.command('format', { kind: 'indent' });
      expect(code(s.snapshot().text)).toEqual(blocks);
      expect(s.snapshot()).toEqual(before);
      expect(encodeSource(s.snapshot())).toEqual(bytes);
      expect(s.selection()).toEqual(selection);
      expect(commits).toHaveLength(0);
      expect(undoDepth(s.state)).toBe(0); expect(redoDepth(s.state)).toBe(0);
      await s.command('undo'); await s.command('redo');
      expect(s.snapshot()).toEqual(before);
      expect(s.selection()).toEqual(selection);
      expect(commits).toHaveLength(0);
    } finally { s.destroy(); }
  });

  it('a refused move leaves an existing undo and redo branch intact', async () => {
    const text = unsupportedMoves[2], commits: Commit[] = [];
    const s = createSession({ ...decodeSource(new TextEncoder().encode(text)), revision: 0 }, c => commits.push(c));
    try {
      s.setMode('live');
      s.edit([{ from: 0, to: 0, insert: 'seed ', eols: [] }]);
      s.edit([{ from: 0, to: 5, insert: '', eols: [] }]);
      s.edit([{ from: text.length, to: text.length, insert: '\n\nredo', eols: ['\r\n', '\r'] }]);
      const redoBytes = encodeSource(s.snapshot());
      await s.command('undo');
      const selection = { anchor: text.indexOf('parent'), head: text.indexOf('parent') };
      s.dispatch({ selection });
      const before = s.snapshot(), count = commits.length, undo = undoDepth(s.state), redo = redoDepth(s.state);
      expect(undo).toBeGreaterThan(0); expect(redo).toBe(1);
      await s.command('format', { kind: 'indent' });
      expect(s.snapshot()).toEqual(before); expect(s.selection()).toEqual(selection);
      expect(commits).toHaveLength(count);
      expect(undoDepth(s.state)).toBe(undo); expect(redoDepth(s.state)).toBe(redo);
      await s.command('redo'); expect(encodeSource(s.snapshot())).toEqual(redoBytes);
      await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(encodeSource(before));
      await s.command('undo'); expect(s.snapshot().text).toBe('seed ' + text);
    } finally { s.destroy(); }
  });

  it.each([
    ['indent', '    code\n', '      code\n'],
    ['outdent', '      code\n', '    code\n'],
  ])('pure raw literal %s still changes code bytes with one undoable commit', async (kind, text, expected) => {
    const bytes = new TextEncoder().encode('\ufeff' + text.replace(/\n/g, '\r\n'));
    const commits: Commit[] = [], s = createSession({ ...decodeSource(bytes), revision: 0 }, c => commits.push(c));
    try {
      s.setMode('live'); s.dispatch({ selection: { anchor: text.indexOf('code') } });
      await s.command('format', { kind });
      expect(s.snapshot().text).toBe(expected);
      expect(code(s.snapshot().text)).not.toEqual(code(text));
      expect(commits).toHaveLength(1);
      const edited = encodeSource(s.snapshot());
      await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(bytes);
      await s.command('redo'); expect(encodeSource(s.snapshot())).toEqual(edited);
    } finally { s.destroy(); }
  });

  it('mixed raw and structural selection is refused atomically when raw changes protected code', async () => {
    const text = '    raw\n\n- previous\n- parent', commits: Commit[] = [];
    const s = createSession({ ...decodeSource(new TextEncoder().encode(text)), revision: 0 }, c => commits.push(c));
    try {
      s.setMode('live');
      const selection = { anchor: 0, head: text.length };
      s.dispatch({ selection });
      const before = s.snapshot();
      await s.command('format', { kind: 'indent' });
      expect(s.snapshot()).toEqual(before); expect(s.selection()).toEqual(selection);
      expect(commits).toHaveLength(0); expect(undoDepth(s.state)).toBe(0);
    } finally { s.destroy(); }
  });
});
