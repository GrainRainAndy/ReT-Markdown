import { describe, expect, it } from 'vitest';
import { redoDepth, undoDepth } from '@codemirror/commands';
import { markdownLanguage } from '@codemirror/lang-markdown';
import MarkdownIt from 'markdown-it';
import { renderMarkdown } from '../src/render/markdown';
import { createSession } from '../src/editor/session';
import { applyPatches, decodeSource, encodeSource } from '../src/editor/source';
import type { FormatOptions } from '../src/editor/commands';
import type { Commit, Snapshot } from '../src/protocol';

const initial = (raw: string): Snapshot => ({ ...decodeSource(new TextEncoder().encode(raw)), revision: 0 });
const rawBytes = (raw: string) => new TextEncoder().encode(raw);

// These fixtures go through the production command router, transaction, EOL field,
// commit publication and sole CM history; no list transformation is reimplemented.
async function convert(raw: string, options: FormatOptions, range?: [number, number]) {
  const before = initial(raw), commits: Commit[] = [];
  const session = createSession(before, commit => commits.push(commit));
  const [anchor, head] = range ?? [0, before.text.length];
  session.dispatch({ selection: { anchor, head } });
  await session.command('format', options);
  return { session, before, commits };
}

describe('AC2 list type conversion', () => {
  it('replaces selected bullet markers rather than stacking ordered prefixes', async () => {
    const { session, before, commits } = await convert('- alpha\n- beta', { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('1. alpha\n2. beta');
    expect(commits).toHaveLength(1);
    expect(commits[0].patches).toEqual([
      { from: 0, to: 1, insert: '1.', eols: [] },
      { from: 8, to: 9, insert: '2.', eols: [] },
    ]);
    expect(undoDepth(session.state)).toBe(1);
    await session.command('undo');
    expect(encodeSource(session.snapshot())).toEqual(encodeSource(before));
    expect(undoDepth(session.state)).toBe(0);
    expect(redoDepth(session.state)).toBe(1);
    await session.command('redo');
    expect(session.snapshot().text).toBe('1. alpha\n2. beta');
    let mirror = before;
    for (const commit of commits) mirror = { ...applyPatches(mirror, commit.patches), revision: commit.revision };
    expect(mirror).toEqual(session.snapshot());
  });

  it.each(['-', '+', '*'])('recognizes %s bullets with original indentation and spacing', async marker => {
    const { session } = await convert(`  ${marker}\talpha\n  ${marker}  beta`, { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('  1.\talpha\n  2.  beta');
  });

  it.each(['.', ')'])('recognizes ordered %s delimiters when converting to bullets', async delimiter => {
    const { session } = await convert(`12${delimiter} alpha\n13${delimiter} beta`, { kind: 'unorderedList' });
    expect(session.snapshot().text).toBe('- alpha\n- beta');
  });

  it.each(['list', 'bulletList', 'unorderedList'])('honors the %s alias and explicit bullet marker', async kind => {
    const { session } = await convert('1. alpha\n2. beta', { kind, marker: '+' });
    expect(session.snapshot().text).toBe('+ alpha\n+ beta');
  });

  it.each([
    ['- [x] alpha\n+ [ ] beta\n* [X] gamma', 'orderedList', '1. alpha\n2. beta\n3. gamma'],
    ['1) [x] alpha\n2) [ ] beta', 'unorderedList', '- alpha\n- beta'],
    ['1. alpha\n2. beta', 'taskList', '- [ ] alpha\n- [ ] beta'],
    ['1) [X] alpha\n2) [ ] beta', 'taskList', '- [X] alpha\n- [ ] beta'],
    ['+ alpha\n* beta', 'taskList', '+ [ ] alpha\n* [ ] beta'],
    ['  +\t[X]\talpha', 'orderedList', '  1.\talpha'],
  ])('converts %j to %s with a consistent checkbox rule', async (raw, kind, expected) => {
    const { session } = await convert(raw, { kind });
    expect(session.snapshot().text).toBe(expected);
  });

  it.each([
    ['  +\talpha\n  *  beta', 'unorderedList'],
    ['7) alpha\n7)  beta', 'orderedList'],
    ['+ [X]\talpha\n* [ ]  beta', 'taskList'],
  ])('keeps already matching %s tokens byte-for-byte (%s)', async (raw, kind) => {
    const { session, commits } = await convert(raw, { kind });
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
    expect(commits).toEqual([]);
    expect(undoDepth(session.state)).toBe(0);
  });

  it('does not consume checkbox-like prose which the grammar does not mark as a task', async () => {
    const { session } = await convert('- [x]alpha\n- text [X] later', { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('1. [x]alpha\n2. text [X] later');
  });

  it('keeps child markers and continuation content while adjusting necessary parent indentation', async () => {
    const raw = '- previous\n- parent\n  continuation\n  + child\n    child continuation\n- next';
    const { session } = await convert(raw, { kind: 'orderedList' }, [13, 16]);
    expect(session.snapshot().text).toBe('- previous\n1. parent\n   continuation\n   + child\n     child continuation\n- next');
  });

  it('converts a continuation selection through its owning item once', async () => {
    const { session } = await convert('- parent\n  continuation\n  second\n- next', { kind: 'orderedList' }, [11, 32]);
    expect(session.snapshot().text).toBe('1. parent\n   continuation\n   second\n- next');
  });

  it('numbers selected siblings independently of nested items, continuations and blank lines', async () => {
    const raw = '- parent\n  continuation\n  + child\n  + second\n\n- next';
    const { session } = await convert(raw, { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('1. parent\n   continuation\n   1. child\n   2. second\n\n2. next');
  });

  it('converts nested items without touching parent markers or tab indentation', async () => {
    const { session } = await convert('- parent\n\t+ child\n\t+ second\n- next', { kind: 'orderedList' }, [12, 27]);
    expect(session.snapshot().text).toBe('- parent\n\t1. child\n\t2. second\n- next');
  });

  it('converts real quoted list markers and preserves the containing quote', async () => {
    const { session } = await convert('> - alpha\n>   continued\n> - beta', { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('> 1. alpha\n>    continued\n> 2. beta');
  });

  it.each(['orderedList', 'unorderedList', 'taskList'])('excludes fenced and indented code inside lists (%s)', async kind => {
    const raw = '- parent\n  ```md\n  - literal\n  1) literal\n  ```\n\n      + code\n      2. code\n- next';
    const { session } = await convert(raw, { kind });
    const first = kind === 'orderedList' ? '1. parent' : kind === 'taskList' ? '- [ ] parent' : '- parent';
    const last = kind === 'orderedList' ? '2. next' : kind === 'taskList' ? '- [ ] next' : '- next';
    const middle = kind === 'orderedList' ? '\n   ```md\n   - literal\n   1) literal\n   ```\n\n       + code\n       2. code\n'
      : '\n  ```md\n  - literal\n  1) literal\n  ```\n\n      + code\n      2. code\n';
    expect(session.snapshot().text).toBe(first + middle + last);
  });

  it.each(['```md\n- literal\n1) literal\n```', '~~~\n* literal\n~~~', '    - literal\n    1. literal'])('leaves a code-only selection untouched: %j', async raw => {
    const { session, commits } = await convert(raw, { kind: 'orderedList' });
    expect(session.snapshot()).toEqual(initial(raw));
    expect(commits).toEqual([]);
  });

  it('converts plain lines, preserving a selected blank line and excluding the line at the selection end', async () => {
    const { session } = await convert('alpha\n\nbeta\ntail', { kind: 'orderedList' }, [0, 12]);
    expect(session.snapshot().text).toBe('1. alpha\n\n2. beta\ntail');
  });

  it('preserves BOM, mixed EOLs, unselected tokens, Unicode and no-final-newline across undo/redo', async () => {
    const raw = '\uFEFF+ untouched\r\n\r\n- 😀甲\r- [X] 乙\n\n7) untouched';
    const { session, before, commits } = await convert(raw, { kind: 'orderedList' }, [27, 14]);
    const expected = '\uFEFF+ untouched\r\n\r\n1. 😀甲\r2. 乙\n\n7) untouched';
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(expected));
    expect(session.snapshot().eols).toEqual(before.eols);
    expect(commits).toHaveLength(1);
    expect(undoDepth(session.state)).toBe(1);
    await session.command('undo');
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
    await session.command('redo');
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(expected));
  });

  it('keeps an unselected child nested after a wider parent marker', async () => {
    const raw = '- parent\n  + child\n    child continuation\n- next';
    const { session } = await convert(raw, { kind: 'orderedList' }, [2, 8]);
    expect(session.snapshot().text).toBe('1. parent\n   + child\n     child continuation\n- next');
    expect(markdownLanguage.parser.parse(session.snapshot().text).toString()).toBe(
      'Document(OrderedList(ListItem(ListMark,Paragraph,BulletList(ListItem(ListMark,Paragraph)))),BulletList(ListItem(ListMark,Paragraph)))',
    );
  });

  it('keeps a list code block inside its item and outside the conversion after a wider marker', async () => {
    const raw = '- parent\n\n      - literal\n      1. code\n- next';
    const { session } = await convert(raw, { kind: 'orderedList' }, [2, 8]);
    expect(session.snapshot().text).toBe('1. parent\n\n       - literal\n       1. code\n- next');
    expect(markdownLanguage.parser.parse(session.snapshot().text).toString()).toBe(
      'Document(OrderedList(ListItem(ListMark,Paragraph,CodeBlock(CodeText,CodeText))),BulletList(ListItem(ListMark,Paragraph)))',
    );
  });

  it('retains the content column with local prefix padding when a parent marker becomes narrower', async () => {
    const raw = '12) parent\n    continuation\n    * child\n- next';
    const { session } = await convert(raw, { kind: 'unorderedList' }, [4, 10]);
    expect(session.snapshot().text).toBe('-   parent\n    continuation\n    * child\n- next');
    expect(markdownLanguage.parser.parse(session.snapshot().text).toString()).toBe(
      'Document(BulletList(ListItem(ListMark,Paragraph,BulletList(ListItem(ListMark,Paragraph))),ListItem(ListMark,Paragraph)))',
    );
  });

  it('does not mistake a literal code quote for a container prefix when padding descendants', async () => {
    const { session } = await convert('- parent\n\n      > literal\n- next', { kind: 'orderedList' }, [2, 8]);
    expect(session.snapshot().text).toBe('1. parent\n\n       > literal\n- next');
  });

  it('converts the real item marker when its fenced code starts on the same line', async () => {
    const { session } = await convert('- ```md\n  - literal\n  ```\n- next', { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('1. ```md\n   - literal\n   ```\n2. next');
    expect(markdownLanguage.parser.parse(session.snapshot().text).toString()).toBe(
      'Document(OrderedList(ListItem(ListMark,FencedCode(CodeMark,CodeInfo,CodeText,CodeMark)),ListItem(ListMark,Paragraph)))',
    );
  });

  it('converts the real marker of an item beginning with indented code, preserving its code indentation', async () => {
    const { session } = await convert('-     literal\n      - code\n- next', { kind: 'orderedList' });
    expect(session.snapshot().text).toBe('1.     literal\n       - code\n2. next');
    expect(markdownLanguage.parser.parse(session.snapshot().text).toString()).toBe(
      'Document(OrderedList(ListItem(ListMark,CodeBlock(CodeText,CodeText)),ListItem(ListMark,Paragraph)))',
    );
  });

  it.each(['- ```md\n  - literal\n  ```', '-     literal\n      - code'])('leaves a code-first item literal for task conversion: %j', async raw => {
    const { session, commits } = await convert(raw, { kind: 'taskList' });
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
    expect(commits).toEqual([]);
  });

  it.each([
    ['', 'orderedList', '1. '],
    ['  ', 'taskList', '  - [ ] '],
    ['-', 'taskList', '- [ ] '],
    ['- ', 'orderedList', '1. '],
  ])('formats an empty item or insertion line %j (%s)', async (raw, kind, expected) => {
    const { session } = await convert(raw, { kind }, [raw.length, raw.length]);
    expect(session.snapshot().text).toBe(expected);
  });

  it('keeps the entire nested mixed-EOL operation in one undo event', async () => {
    const raw = '\uFEFF- parent\r\n  - child\r    continuation\n\r\n      > code\n- next';
    const { session, before, commits } = await convert(raw, { kind: 'orderedList' });
    const after = session.snapshot();
    expect(commits).toHaveLength(1);
    expect(undoDepth(session.state)).toBe(1);
    expect(after.eols).toEqual(before.eols);
    expect(after.bom).toBe(true);
    await session.command('undo');
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
    await session.command('redo');
    expect(encodeSource(session.snapshot())).toEqual(encodeSource(after));
  });
});

describe('AC2 round 1 grammar regressions', () => {
  const markdown = new MarkdownIt();
  const bodies = (text: string) => markdown.parse(text, {}).filter(token =>
    ['inline', 'fence', 'code_block'].includes(token.type)).map(token => ({ type: token.type, content: token.content }));
  const cases = [
    { name: 'long ordered paragraph', raw: '1000. parent\n      continuation\n- next', range: [6, 12] as [number, number],
      kind: 'unorderedList', expected: '- parent\n  continuation\n- next', body: 'parent\ncontinuation', node: 'Paragraph' },
    { name: 'four-space separator', raw: '1.    parent\n      continuation\n- next', range: [6, 12] as [number, number],
      kind: 'unorderedList', expected: '-    parent\n     continuation\n- next', body: 'parent\ncontinuation', node: 'Paragraph' },
    { name: 'long ordered task', raw: '1000. parent\n      continuation\n- next', range: [6, 12] as [number, number],
      kind: 'taskList', expected: '- [ ] parent\n  continuation\n- next', body: '[ ] parent\ncontinuation', node: 'Task' },
    { name: 'narrowed code-first item', raw: '12.     literal\n        - code\n- next', range: [0, 14] as [number, number],
      kind: 'unorderedList', expected: '-     literal\n      - code\n- next', body: 'literal\n- code\n', node: 'CodeBlock' },
    { name: 'code gap with a trailing tab', raw: '1.    \tliteral\n            - code\n- next', range: [0, 1] as [number, number],
      kind: 'unorderedList', expected: '-      literal\n           - code\n- next', body: ' literal\n     - code\n', node: 'CodeBlock' },
    { name: 'code gap with an interior tab', raw: '12. \t literal\n            - code\n- next', range: [0, 1] as [number, number],
      kind: 'unorderedList', expected: '-      literal\n          - code\n- next', body: ' literal\n    - code\n', node: 'CodeBlock' },
    { name: 'code gap beginning with a tab', raw: '123.\t literal\n            - code\n- next', range: [0, 1] as [number, number],
      kind: 'unorderedList', expected: '-     literal\n         - code\n- next', body: 'literal\n   - code\n', node: 'CodeBlock' },
    { name: 'paragraph tab gap crossing the code threshold', raw: '1. \t  parent\n      continuation\n- next', range: [0, 1] as [number, number],
      kind: 'unorderedList', expected: '-    parent\n     continuation\n- next', body: 'parent\ncontinuation', node: 'Paragraph' },
  ];

  for (const fixture of cases) {
    it.each([false, true])(`AC2-R1 preserves body meaning for ${fixture.name} (BOM/mixed EOL=%s)`, async mixed => {
      const surround = (text: string) => mixed
        ? '\uFEFFoutside 😀\r\n\r\n' + text.replace('\n', '\r').replace('\n', '\r\n') + '\n\rtail'
        : text;
      const raw = surround(fixture.raw), expected = surround(fixture.expected);
      const offset = mixed ? initial(raw).text.indexOf(fixture.raw.split('\n')[0]) : 0;
      const result = await convert(raw, { kind: fixture.kind }, [fixture.range[0] + offset, fixture.range[1] + offset]);
      const { session, before, commits } = result;
      const after = session.snapshot(), bodyIndex = mixed ? 1 : 0;
      const expectedType = fixture.node === 'CodeBlock' ? 'code_block' : 'inline';
      expect(bodies(before.text)[bodyIndex]).toEqual({ type: expectedType, content: fixture.body.replace(/^\[ \] /, '') });
      expect(bodies(after.text)[bodyIndex]).toEqual({ type: expectedType, content: fixture.body });
      const item = markdownLanguage.parser.parse(after.text).topNode.getChild('BulletList')!.getChild('ListItem')!;
      expect(item.getChild(fixture.node)).not.toBeNull();
      if (fixture.node === 'Task') expect(item.getChild('Task')!.getChild('TaskMarker')).not.toBeNull();
      const html = markdown.render(after.text);
      if (fixture.node === 'CodeBlock') expect(html).toContain(`<pre><code>${fixture.body}</code></pre>`);
      else {
        expect(html).not.toContain('<pre>');
        expect(html).toContain('parent\ncontinuation</li>');
        if (fixture.node === 'Task') expect(renderMarkdown(after.text).html).toContain('type="checkbox"');
      }
      expect(encodeSource(after)).toEqual(rawBytes(expected));
      expect(after.eols).toEqual(before.eols);
      expect(after.bom).toBe(before.bom);
      expect(commits).toHaveLength(1);
      expect(commits[0].patches.every(p => !p.insert.includes('\n') &&
        !before.text.slice(p.from, p.to).includes('\n') && p.eols.length === 0)).toBe(true);
      expect(undoDepth(session.state)).toBe(1);
      const snapshots = [after];
      await session.command('undo');
      snapshots.push(session.snapshot());
      expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
      expect(undoDepth(session.state)).toBe(0);
      expect(redoDepth(session.state)).toBe(1);
      await session.command('redo');
      snapshots.push(session.snapshot());
      expect(encodeSource(session.snapshot())).toEqual(rawBytes(expected));
      expect(commits.map(commit => commit.reason)).toEqual(['edit', 'undo', 'redo']);
      let mirror = before;
      for (const [index, commit] of commits.entries()) {
        expect(commit.base).toBe(mirror.revision);
        mirror = { ...applyPatches(mirror, commit.patches), revision: commit.revision };
        expect(mirror).toEqual(snapshots[index]);
        expect(encodeSource(mirror)).toEqual(encodeSource(snapshots[index]));
      }
    });
  }

  it.each([
    { name: 'quoted descendants', raw: '> 1000. parent\n>       continuation\n>       * child\n> - next',
      expected: '> - parent\n>   continuation\n>   * child\n> - next' },
    { name: 'nested owner', raw: '- outer\n\n  1000. parent\n        continuation\n        * child\n- next',
      expected: '- outer\n\n  - parent\n    continuation\n    * child\n- next' },
    { name: 'selected parent and child', raw: '1000. parent\n      1. child\n         continuation\n- next',
      expected: '- parent\n  -  child\n     continuation\n- next', all: true },
    { name: 'partial tab dedent', raw: '12.     literal\n\t\t- code\n- next',
      expected: '-     literal\n\t  - code\n- next' },
    { name: 'literal code quote', raw: '1000. parent\n\n          > literal\n- next',
      expected: '- parent\n\n      > literal\n- next' },
    { name: 'fence and later paragraph', raw: '1000. ```md\n      - literal\n      ```\n\n      after\n- next',
      expected: '- ```md\n  - literal\n  ```\n\n  after\n- next' },
    { name: 'lazy continuation', raw: '1000. parent\nlazy\n      continuation\n- next',
      expected: '- parent\nlazy\n  continuation\n- next' },
  ])('AC2-R1 keeps container and body meaning during dedent: $name', async fixture => {
    const anchor = fixture.raw.includes('1000.') ? fixture.raw.indexOf('1000.') : 0;
    const { session, before, commits } = await convert(fixture.raw, { kind: 'unorderedList' },
      [anchor, fixture.all ? fixture.raw.length : anchor + 1]);
    const after = session.snapshot();
    expect(after.text).toBe(fixture.expected);
    expect(bodies(after.text)).toEqual(bodies(before.text));
    // Adjacent converted lists can merge. Compare each item's subtree so that
    // this intended merge does not hide detached children or changed blocks.
    const grammar = (text: string) => {
      const items: string[] = [];
      markdownLanguage.parser.parse(text).iterate({ enter(node) {
        if (node.name === 'ListItem') items.push(node.node.toString().replaceAll('OrderedList', 'BulletList'));
      } });
      return items;
    };
    expect(grammar(after.text)).toEqual(grammar(before.text));
    const codeHTML = (text: string) => markdown.render(text).match(/<pre>[\s\S]*?<\/pre>/g) ?? [];
    expect(codeHTML(after.text)).toEqual(codeHTML(before.text));
    expect(commits).toHaveLength(1);
    expect(undoDepth(session.state)).toBe(1);
    await session.command('undo');
    expect(encodeSource(session.snapshot())).toEqual(rawBytes(fixture.raw));
    await session.command('redo');
    expect(session.snapshot().text).toBe(fixture.expected);
  });

  it.each([
    { raw: '- ```md\n  - literal\n  ```\n\n  after\n- next', range: [29, 30] as [number, number], code: 'FencedCode' },
    { raw: '-     literal\n      - code\n\n  after\n- next', range: [30, 31] as [number, number], code: 'CodeBlock' },
  ])('AC2-R2 rejects task conversion of a $code owner selected through its later paragraph', async fixture => {
    for (const mixed of [false, true]) for (const marker of [undefined, '+', '1000.']) {
      const raw = mixed ? '\uFEFF' + fixture.raw.replace('\n', '\r\n').replace('\n  after', '\r  after') : fixture.raw;
      const { session, before, commits } = await convert(raw, { kind: 'taskList', marker }, fixture.range);
      expect(before.text.slice(...fixture.range)).toBe('a');
      const item = markdownLanguage.parser.parse(before.text).topNode.getChild('BulletList')!.getChild('ListItem')!;
      expect(item.getChild(fixture.code)).not.toBeNull();
      expect(item.getChild('Paragraph')).not.toBeNull();
      expect(session.snapshot()).toEqual(before);
      expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
      expect(bodies(session.snapshot().text)).toEqual(bodies(before.text));
      expect(renderMarkdown(session.snapshot().text).html).toBe(renderMarkdown(before.text).html);
      expect(session.selection()).toEqual({ anchor: fixture.range[0], head: fixture.range[1] });
      expect(commits).toEqual([]);
      expect(session.pendingCommits()).toEqual([]);
      expect(undoDepth(session.state)).toBe(0);
      expect(redoDepth(session.state)).toBe(0);
    }
  });
});

describe('AC2 round 2 effective descendant columns', () => {
  const markdown = new MarkdownIt();
  const bodies = (text: string) => markdown.parse(text, {}).filter(token =>
    ['inline', 'fence', 'code_block'].includes(token.type)).map(token => [token.type, token.content]);
  const structure = (text: string) => {
    const items: string[] = [];
    markdownLanguage.parser.parse(text).iterate({ enter(node) {
      if (node.name === 'ListItem') items.push(node.node.toString().replaceAll('OrderedList', 'BulletList'));
    } });
    return items;
  };
  const codeHTML = (text: string) => markdown.render(text).match(/<pre>[\s\S]*?<\/pre>/g) ?? [];

  it.each([
    { name: 'narrowing', raw: '1.    parent\n      - \t literal\n            - code\n- next',
      range: [6, 12] as [number, number], kind: 'unorderedList',
      expected: '-    parent\n     -      literal\n           - code\n- next' },
    { name: 'widening', raw: '- parent\n  - \t literal\n        - code\n- next',
      range: [2, 8] as [number, number], kind: 'orderedList',
      expected: '1. parent\n   -      literal\n         - code\n- next' },
  ])('AC2-R1a preserves an unselected code child after ancestor $name', async fixture => {
    for (const mixed of [false, true]) {
      const surround = (text: string) => mixed
        ? '\uFEFFoutside 😀\r\n\r\n' + text.replace('\n', '\r').replace('\n', '\r\n') + '\n\rtail'
        : text;
      const raw = surround(fixture.raw), expected = surround(fixture.expected);
      const offset = mixed ? initial(raw).text.indexOf(fixture.raw.split('\n')[0]) : 0;
      const { session, before, commits } = await convert(raw, { kind: fixture.kind },
        [offset + fixture.range[0], offset + fixture.range[1]]);
      const after = session.snapshot();
      expect(bodies(before.text)).toContainEqual(['code_block', ' literal\n- code\n']);
      expect(bodies(after.text)).toEqual(bodies(before.text));
      expect(structure(after.text)).toEqual(structure(before.text));
      expect(codeHTML(after.text)).toEqual(codeHTML(before.text));
      expect(encodeSource(after)).toEqual(rawBytes(expected));
      expect(after.eols).toEqual(before.eols);
      expect(after.bom).toBe(before.bom);
      expect(commits).toHaveLength(1);
      expect(undoDepth(session.state)).toBe(1);
      expect(commits[0].patches.every(p => !p.insert.includes('\n') &&
        !before.text.slice(p.from, p.to).includes('\n') && p.eols.length === 0)).toBe(true);
      const snapshots = [after];
      await session.command('undo');
      snapshots.push(session.snapshot());
      expect(encodeSource(session.snapshot())).toEqual(rawBytes(raw));
      expect(undoDepth(session.state)).toBe(0);
      expect(redoDepth(session.state)).toBe(1);
      await session.command('redo');
      snapshots.push(session.snapshot());
      expect(encodeSource(session.snapshot())).toEqual(rawBytes(expected));
      expect(commits.map(commit => commit.reason)).toEqual(['edit', 'undo', 'redo']);
      let mirror = before;
      for (const [index, commit] of commits.entries()) {
        expect(commit.base).toBe(mirror.revision);
        mirror = { ...applyPatches(mirror, commit.patches), revision: commit.revision };
        expect(mirror).toEqual(snapshots[index]);
        expect(encodeSource(mirror)).toEqual(encodeSource(snapshots[index]));
      }
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('preserves body/structure across %i-digit markers and ancestor tab stops', async digits => {
    const failures: unknown[] = [];
    const numbered = '1'.repeat(digits) + '.';
    const gaps = [' ', '    ', '\t', ' \t ', '\t ', '  \t  ', '    \t', '     ', '\t\t', '\t\t\t', '    \t\t'];
    const width = (text: string) => [...text].reduce((column, ch) => column + (ch === '\t' ? 4 - column % 4 : 1), 0);
    for (const indent of [0, 1, 2, 3]) for (const widening of [false, true]) {
      const rootMarker = widening ? '-' : numbered, rootGap = widening ? ' ' : '    ';
      const root = ' '.repeat(indent) + rootMarker + rootGap + 'parent';
      const rootColumn = indent + rootMarker.length + rootGap.length;
      for (const childMarker of ['-', '1.', '111.', '111111111.']) for (const gap of gaps) {
        const prefix = ' '.repeat(rootColumn) + childMarker;
        const gapWidth = width(prefix + gap) - width(prefix);
        const childColumn = width(prefix) + (gapWidth > 4 ? 1 : gapWidth);
        const continuation = ' '.repeat(childColumn + (gapWidth > 4 ? 4 : 0)) + (gapWidth > 4 ? '- code' : 'continued');
        // The blank line permits non-1 numbered children under CommonMark.
        const raw = root + '\n\n' + prefix + gap + 'literal\n' + continuation + '\n- next';
        for (const selection of ['parent', 'parent+child', 'child']) {
          const from = selection === 'child' ? raw.indexOf('literal') : raw.indexOf('parent');
          const to = selection === 'parent+child' ? raw.indexOf('\n- next') : from + (selection === 'child' ? 7 : 6);
          const marker = widening ? numbered : '-';
          const { session, before, commits } = await convert(raw, { kind: 'list', marker }, [from, to]);
          const after = session.snapshot();
          const expectedBodies = bodies(before.text), actualBodies = bodies(after.text);
          const expectedStructure = structure(before.text), actualStructure = structure(after.text);
          const expectedMarks = [selection === 'child' ? rootMarker : marker, selection === 'parent' ? childMarker : marker, '-'];
          const actualMarks: string[] = [];
          markdownLanguage.parser.parse(after.text).iterate({ enter(node) {
            if (node.name === 'ListMark') actualMarks.push(after.text.slice(node.from, node.to));
          } });
          const events = expectedMarks[0] !== rootMarker || expectedMarks[1] !== childMarker ? 1 : 0;
          if (expectedStructure.length !== 3 || JSON.stringify(actualBodies) !== JSON.stringify(expectedBodies) ||
            JSON.stringify(actualStructure) !== JSON.stringify(expectedStructure) ||
            JSON.stringify(codeHTML(after.text)) !== JSON.stringify(codeHTML(before.text)) ||
            JSON.stringify(actualMarks) !== JSON.stringify(expectedMarks) ||
            undoDepth(session.state) !== events || commits.length !== events) {
            failures.push({ indent, widening, childMarker, gap, selection, raw, after: after.text, expectedBodies, actualBodies,
              expectedStructure, actualStructure, expectedMarks, actualMarks, events, commits: commits.length });
          }
        }
      }
    }
    expect(failures.slice(0, 3), `${failures.length} of 1056 column/selection combinations failed`).toEqual([]);
  });

  it.each([
    { name: 'code descendant within a quote', raw: '> - parent\n>   -\t\t literal\n>         - code\n> - next' },
    { name: 'code descendant under a nested quote', raw: '- parent\n  > -\t\t literal\n  >       - code\n- next' },
    { name: 'already ordered middle item', raw: '- parent\n\n  1. middle\n\n     -\t\t literal\n           - code\n- next' },
    { name: 'literal tab after a code quote', raw: '- parent\n\n      >\tcode\n- next' },
    { name: 'literal leading tab in indented code', raw: '- parent\n\n      \tcode\n- next' },
    { name: 'literal leading tab in fenced code', raw: '- parent\n  ```\n  \tcode\n  \tmore\n  ```\n- next', fenced: true },
  ])('preserves effective columns through $name', async fixture => {
    const anchor = fixture.raw.indexOf('parent');
    for (const selectedMiddle of [false, true]) {
      const middle = fixture.raw.indexOf('middle');
      const head = selectedMiddle && middle >= 0 ? middle + 6 : anchor + 6;
      const { session, before } = await convert(fixture.raw, { kind: 'orderedList' }, [anchor, head]);
      expect(bodies(before.text).some(([type]) => type === (fixture.fenced ? 'fence' : 'code_block'))).toBe(true);
      expect(bodies(session.snapshot().text)).toEqual(bodies(before.text));
      expect(structure(session.snapshot().text)).toEqual(structure(before.text));
      expect(codeHTML(session.snapshot().text)).toEqual(codeHTML(before.text));
      expect(undoDepth(session.state)).toBe(1);
      await session.command('undo');
      expect(encodeSource(session.snapshot())).toEqual(encodeSource(before));
    }
  });
});
