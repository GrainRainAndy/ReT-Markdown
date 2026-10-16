import { describe, expect, it } from 'vitest';
import { EditorSelection, Transaction } from '@codemirror/state';
import { undoDepth } from '@codemirror/commands';
import { renderMarkdown } from '../src/render/markdown';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource, applyPatches } from '../src/editor/source';
import type { Commit, Snapshot } from '../src/protocol';

const initial = (raw: string): Snapshot => ({ ...decodeSource(new TextEncoder().encode(raw)), revision: 0 });
const bytes = (s: Snapshot) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(encodeSource(s));

describe('one source-first CodeMirror session', () => {
  it('alternates modes and inverts mixed EOL metadata with the sole CM history', async () => {
    const original = initial('\uFEFFa\r\nb\rc\n末尾');
    const commits: Commit[] = [];
    const s = createSession(original, c => commits.push(c));
    s.edit([{ from: 1, to: 3, insert: '\n换\n', eols: ['\r', '\r\n'] }]);
    s.setMode('live');
    s.edit([{ from: s.state.doc.length, to: s.state.doc.length, insert: '\n尾', eols: ['\r'] }]);
    s.setMode('source');
    await s.command('undo'); await s.command('undo');
    expect(encodeSource(s.snapshot())).toEqual(encodeSource(original));
    expect(commits.map(c => [c.base, c.revision, c.reason])).toEqual([[0, 1, 'edit'], [1, 2, 'edit'], [2, 3, 'undo'], [3, 4, 'undo']]);
    let mirror = original;
    for (const c of commits) mirror = { ...applyPatches(mirror, c.patches), revision: c.revision };
    expect(mirror).toEqual(s.snapshot());
    await s.command('redo'); await s.command('redo');
    expect(bytes(s.snapshot())).toBe('\uFEFFa\r换\r\n\rc\n末尾\r尾');
  });

  it('reconfigures mode, appearance and zoom without history, content, or selection changes', async () => {
    const commits: Commit[] = [];
    const s = createSession(initial('**text**'), c => commits.push(c));
    s.dispatch({ selection: EditorSelection.single(2, 6) });
    const doc = s.state.doc;
    s.setMode('live'); await s.command('setAppearance', { appearance: 'dark' });
    await s.command('setZoom', { zoom: 1.5 }); s.setMode('source');
    expect(s.state.doc).toBe(doc);
    expect(s.selection()).toEqual({ anchor: 2, head: 6 });
    expect(undoDepth(s.state)).toBe(0); expect(commits).toEqual([]);
  });

  it('finds hidden syntax and replaces all as one undo event', async () => {
    const s = createSession(initial('**a**\r\n**b**'), () => {});
    s.setMode('live');
    await s.command('find', { query: '**' });
    expect(s.selection()).toEqual({ anchor: 0, head: 2 });
    await s.command('replaceAll', { query: '**', replacement: '__' });
    expect(s.snapshot().text).toBe('__a__\n__b__'); expect(undoDepth(s.state)).toBe(1);
    await s.command('undo'); expect(bytes(s.snapshot())).toBe('**a**\r\n**b**');
  });

  it.each(['-', '+', '*'])('continues %s list prefix and containing-line EOL, then exits an empty item', async marker => {
    const s = createSession(initial(`  ${marker} item\r\nlast`), () => {});
    s.dispatch({ selection: { anchor: 8 } });
    await s.command('format', { kind: 'newline' });
    expect(bytes(s.snapshot())).toBe(`  ${marker} item\r\n  ${marker} \r\nlast`);
    await s.command('format', { kind: 'newline' });
    expect(bytes(s.snapshot())).toBe(`  ${marker} item\r\n\r\nlast`);
  });

  it('inherits typed newline terminators and restores them on undo/redo after CM typing grouping', async () => {
    const s = createSession(initial('a\r\nb\rc'), () => {});
    s.dispatch({ changes: { from: 1, insert: '\n' }, annotations: Transaction.userEvent.of('input.type') });
    s.dispatch({ changes: { from: 2, insert: '\n' }, annotations: Transaction.userEvent.of('input.type') });
    expect(s.snapshot().eols).toEqual(['\r\n', '\r\n', '\r\n', '\r']);
    await s.command('undo'); expect(bytes(s.snapshot())).toBe('a\r\nb\rc');
    await s.command('redo'); expect(s.snapshot().eols).toEqual(['\r\n', '\r\n', '\r\n', '\r']);
  });

  it('barriers retain last committed content and selection while composition changes provisional text', async () => {
    const commits: Commit[] = [];
    const s = createSession(initial('a\r\nb'), c => commits.push(c));
    s.dispatch({ selection: { anchor: 1 } }); s.beginComposition();
    s.dispatch({ changes: { from: 1, insert: 'n' }, selection: { anchor: 2 }, userEvent: 'input.type.compose.start' });
    s.dispatch({ changes: { from: 1, to: 2, insert: '你' }, selection: { anchor: 2 }, userEvent: 'input.type.compose' });
    expect(s.state.doc.toString()).toBe('a你\nb');
    expect(s.barrier()).toEqual({ snapshot: initial('a\r\nb'), selection: { anchor: 1, head: 1 }, composing: true });
    expect(commits).toEqual([]);
    expect(() => s.apply(0, [], 'assets')).toThrow(/compos/i);
    s.endComposition();
    expect(commits).toHaveLength(1); expect(commits[0].patches).toEqual([{ from: 1, to: 1, insert: '你', eols: [] }]);
    await s.command('undo'); expect(bytes(s.snapshot())).toBe('a\r\nb');
  });

  it('ignores cancelled preedit and rejects stale asset transactions without losing text', () => {
    const commits: Commit[] = []; const s = createSession(initial('a'), c => commits.push(c));
    s.beginComposition();
    s.dispatch({ changes: { from: 1, insert: 'n' }, userEvent: 'input.type.compose.start' });
    s.dispatch({ changes: { from: 1, to: 2 }, userEvent: 'input.type.compose' });
    s.endComposition(); expect(commits).toEqual([]); expect(s.snapshot()).toEqual(initial('a'));
    s.apply(0, [{ from: 1, to: 1, insert: '!', eols: [] }], 'assets');
    expect(() => s.apply(0, [{ from: 0, to: 0, insert: '?', eols: [] }], 'assets')).toThrow(/base|stale/i);
    expect(s.snapshot().text).toBe('a!');
  });

  it('protects source snapshots against caller mutation and counts EOL-only changes as commits', async () => {
    const s = createSession(initial('a\r\nb'), () => {});
    const leaked = s.snapshot(); leaked.eols[0] = '\r';
    expect(s.snapshot().eols).toEqual(['\r\n']);
    s.edit([{ from: 1, to: 2, insert: '\n', eols: ['\r'] }]);
    expect(s.snapshot().revision).toBe(1);
    await s.command('undo'); expect(s.snapshot().eols).toEqual(['\r\n']);
  });
});

it('locks user edits for Save As while allowing atomic native asset adoption, then unlocks', async () => {
  const s = createSession(initial('![a](old.assets/a.png)'), () => {});
  await s.command('setReadOnly', { value: true });
  expect(() => s.edit([{ from: 0, to: 0, insert: 'x', eols: [] }])).toThrow(/read.only|lock/i);
  s.dispatch({ changes: { from: 0, insert: 'user' }, userEvent: 'input.type' });
  expect(s.snapshot().text).toBe('![a](old.assets/a.png)');
  await expect(s.paste({ text: 'blocked' })).rejects.toThrow(/read.only|lock/i);
  s.apply(0, [{ from: 5, to: 8, insert: 'new', eols: [] }], 'assets');
  expect(s.snapshot().text).toBe('![a](new.assets/a.png)');
  await s.command('setReadOnly', { value: false });
  s.edit([{ from: 0, to: 0, insert: 'ok ', eols: [] }]);
  expect(s.snapshot().text).toBe('ok ![a](new.assets/a.png)');
  s.beginComposition();
  await expect(s.command('setReadOnly', { value: true })).rejects.toThrow(/compos/i);
  s.endComposition();
});

it('formatting a multiline selection inserts delimiters without changing its original terminators', async () => {
  const s = createSession(initial('a\r\nb\rc\n尾'), () => {});
  s.dispatch({ selection: { anchor: 0, head: s.state.doc.length } });
  await s.command('format', { kind: 'bold' });
  expect(bytes(s.snapshot())).toBe('**a\r\nb\rc\n尾**');
  expect(s.snapshot().eols).toEqual(['\r\n', '\r', '\n']);
  await s.command('undo'); expect(bytes(s.snapshot())).toBe('a\r\nb\rc\n尾');
});

it('retains committed edits until acknowledged, including undo revisions', async () => {
  const s = createSession(initial('a'), () => {});
  s.edit([{ from: 1, to: 1, insert: 'b', eols: [] }]);
  await s.command('undo');
  expect(s.pendingCommits().map(c => c.revision)).toEqual([1, 2]);
  s.acknowledge(1); expect(s.pendingCommits().map(c => c.revision)).toEqual([2]);
  expect(() => s.acknowledge(3)).toThrow(/acknowledge/i);
  s.acknowledge(2); expect(s.pendingCommits()).toEqual([]);
});

it('inserts native plural image destinations as one atomic source edit with inherited EOLs', async () => {
  const s = createSession(initial('before\r\nafter'), () => {});
  s.dispatch({ selection: { anchor: 7, head: 12 } });
  await s.command('insertImage', { destinations: ['报告.assets/图 1.png', '../other(2).png'], destination: 'ignored.png', alt: '' });
  expect(bytes(s.snapshot())).toBe('before\r\n![](<报告.assets/图%201.png>)\r\n![](<../other(2).png>)');
  expect(undoDepth(s.state)).toBe(1);
  await s.command('undo'); expect(bytes(s.snapshot())).toBe('before\r\nafter');
  await s.command('insertImage', { destination: 'one.png', alt: 'a[b]' });
  expect(s.snapshot().text).toBe('before\n![a\\[b\\]](<one.png>)');
});

describe('review regressions: list hierarchy and code context', () => {
  it.each(['indent', 'outdent'])('S1 %s moves the parent and descendants together without touching siblings or mixed EOLs', async kind => {
    const before = kind === 'indent' ? '- previous\r\n- parent\n  - child\r    continuation\n  - second\r\n- next' : '- previous\r\n  - parent\n    - child\r      continuation\n    - second\r\n- next';
    const expected = kind === 'indent' ? '- previous\r\n  - parent\n    - child\r      continuation\n    - second\r\n- next' : '- previous\r\n- parent\n  - child\r    continuation\n  - second\r\n- next';
    const s = createSession(initial(before), () => {});
    s.dispatch({ selection: { anchor: s.snapshot().text.indexOf('parent') } });
    await s.command('format', { kind });
    expect(bytes(s.snapshot())).toBe(expected);
    expect(s.snapshot().eols).toEqual(initial(before).eols);
    expect(undoDepth(s.state)).toBe(1);
    await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(encodeSource(initial(before)));
  });
  it('S1 outdent at the outermost level leaves the whole subtree intact', async () => {
    const s = createSession(initial('- parent\n  - child'), () => {});
    s.dispatch({ selection: { anchor: 4 } }); await s.command('format', { kind: 'outdent' });
    expect(s.snapshot()).toEqual(initial('- parent\n  - child'));
  });
  it.each(['- item', '12. item', '- '])('S5 Enter keeps %j literal inside fenced and indented code', async content => {
    for (const fenced of [true, false]) {
      const raw = fenced ? `lead\r\n\`\`\`\n${content}\r\`\`\`\r\ntail` : `lead\r\n\r\n    ${content}\rtail`;
      const s = createSession(initial(raw), () => {});
      const from = s.snapshot().text.indexOf(content) + content.length;
      s.dispatch({ selection: { anchor: from } });
      await s.command('format', { kind: 'newline' });
      const text = initial(raw).text;
      expect(s.snapshot().text).toBe(text.slice(0, from) + '\n' + (fenced ? '' : '    ') + text.slice(from));
      expect(s.snapshot().eols).toEqual(fenced ? ['\r\n', '\n', '\r', '\r', '\r\n'] : ['\r\n', '\r\n', '\r', '\r']);
      await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(encodeSource(initial(raw)));
    }
  });
  it.each(['7. item', '- [x] item'])('retains real ordered/task list continuation for %j', async text => {
    const s = createSession(initial(text), () => {}); s.dispatch({ selection: { anchor: text.length } });
    await s.command('format', { kind: 'newline' });
    expect(s.snapshot().text).toBe(text + (text.startsWith('7') ? '\n8. ' : '\n- [ ] '));
  });
});


it.each([false, true])('S2 inserts valid fenced code inside prose or at paragraph end (collapsed=%s)', async collapsed => {
  const raw = 'lead\r\nbefore chosen after\rtrail\nend';
  const s = createSession(initial(raw), () => {});
  const from = s.snapshot().text.indexOf('chosen');
  // The normalized paragraph ends immediately before the next LF.
  const position = collapsed ? s.state.doc.line(2).to : from;
  s.dispatch({ selection: { anchor: position, head: collapsed ? position : position + 6 } });
  await s.command('format', { kind: 'codeBlock' });
  expect(bytes(s.snapshot())).toBe(collapsed ? 'lead\r\nbefore chosen after\r```\r\r```\rtrail\nend' : 'lead\r\nbefore \r```\rchosen\r```\r after\rtrail\nend');
  const html = renderMarkdown(s.snapshot().text).html;
  expect(html).toContain(collapsed ? '<code>\n</code>' : '<code>chosen\n</code>');
  expect(html).toContain(collapsed ? '<p>lead\nbefore chosen after</p>' : '<p>lead\nbefore</p>');
  expect(html).toContain(collapsed ? '<p>trail\nend</p>' : '<p>after\ntrail\nend</p>');
  expect(undoDepth(s.state)).toBe(1);
  await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(encodeSource(initial(raw)));
});
