import { describe, expect, it } from 'vitest';
import { DocumentSession } from '../../editor/core/document';
import type { LogicalSelection } from '../../editor/core/types';

const caret = (offset: number, kind: 'source' | 'prose' = 'source'): LogicalSelection => ({
  anchor: { offset, affinity: 'after' }, head: { offset, affinity: 'after' }, owner: { kind }, kind: 'text',
});

describe('source-authoritative transactions', () => {
  it('changes only B in mixed untouched source and restores exact source on undo', () => {
    const session = new DocumentSession('A\r\n\r\nB');
    session.setSelection(caret(5));
    session.apply([{ from: 5, to: 6, insert: 'C' }], caret(6));
    expect(session.source).toBe('A\r\n\r\nC');
    expect(session.dirty).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.source).toBe('A\r\n\r\nB');
    expect(session.selection).toEqual(caret(5));
    expect(session.dirty).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.source).toBe('A\r\n\r\nC');
    expect(session.revision).toBe(3);
  });
  it.each(['', '\uFEFF', '\uFEFFa\r\n\n \r\n', 'A\n', 'A\n\n\n'])('preserves BOM, EOF and whitespace: %j', source => {
    const session = new DocumentSession(source);
    session.apply([{ from: source.length, to: source.length, insert: '字' }], caret(source.length + 1));
    session.undo();
    expect(session.source).toBe(source);
  });
  it('does not clear newer dirty content when an older save completes', () => {
    const session = new DocumentSession('a');
    session.apply([{ from: 1, to: 1, insert: 'b' }], caret(2));
    const saved = session.source;
    session.apply([{ from: 2, to: 2, insert: 'c' }], caret(3));
    session.markSaved(saved);
    expect(session.dirty).toBe(true);
    session.undo();
    expect(session.source).toBe('ab');
    expect(session.dirty).toBe(false);
  });
  it.each([
    [{ from: -1, to: 0, insert: '' }], [{ from: 0, to: 4, insert: '' }],
    [{ from: 2, to: 1, insert: '' }], [{ from: 0.5, to: 1, insert: '' }],
    [{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }],
    [{ from: 1, to: 1, insert: 'x' }, { from: 1, to: 1, insert: 'y' }],
  ])('rejects invalid or ambiguous patches atomically: %j', (...patches) => {
    const session = new DocumentSession('abc');
    expect(() => session.apply(patches, caret(0))).toThrow(RangeError);
    expect(session.source).toBe('abc');
    expect(session.revision).toBe(0);
    expect(session.undo()).toBe(false);
  });
  it('applies all patches in original coordinates even if supplied unsorted', () => {
    const session = new DocumentSession('abc def');
    session.apply([{ from: 4, to: 7, insert: 'Z' }, { from: 0, to: 1, insert: 'XY' }], caret(6));
    expect(session.source).toBe('XYbc Z');
    session.undo();
    expect(session.source).toBe('abc def');
  });
  it.each([['😀', 1], ['e\u0301', 1], ['\r\n', 1]])('rejects edits that split a visible character: %j', (source, offset) => {
    const session = new DocumentSession(source);
    expect(() => session.apply([{ from: offset, to: offset, insert: 'x' }], caret(0))).toThrow();
    expect(session.source).toBe(source);
  });
  it('groups consecutive explicit typing transactions and restores ownership and selection', () => {
    const session = new DocumentSession('');
    session.setSelection(caret(0, 'prose'));
    session.apply([{ from: 0, to: 0, insert: '中' }], caret(1, 'prose'), 'typing-1');
    session.apply([{ from: 1, to: 1, insert: '文' }], caret(2, 'prose'), 'typing-1');
    session.setSelection(caret(2));
    session.apply([{ from: 2, to: 2, insert: '!' }], caret(3), 'source-1');
    session.undo();
    expect(session.source).toBe('中文');
    expect(session.selection.owner.kind).toBe('source');
    session.undo();
    expect(session.source).toBe('');
    expect(session.selection).toEqual(caret(0, 'prose'));
    session.redo();
    expect(session.source).toBe('中文');
    expect(session.selection).toEqual(caret(2, 'prose'));
  });
  it('breaks typing groups on a selection change and clears redo on new content', () => {
    const session = new DocumentSession('');
    session.apply([{ from: 0, to: 0, insert: 'a' }], caret(1), 'typing');
    session.setSelection(caret(0));
    session.apply([{ from: 0, to: 0, insert: 'b' }], caret(1), 'typing');
    session.undo();
    expect(session.source).toBe('a');
    session.apply([{ from: 1, to: 1, insert: 'c' }], caret(2));
    expect(session.redo()).toBe(false);
    expect(session.source).toBe('ac');
  });
  it('publishes immutable snapshots and lets consumers unsubscribe', () => {
    const session = new DocumentSession('a');
    const received: string[] = [];
    const unsubscribe = session.subscribe(snapshot => received.push(snapshot.source));
    const selection = caret(2);
    session.apply([{ from: 1, to: 1, insert: 'b' }], selection);
    selection.head.offset = 0;
    expect(session.selection.head.offset).toBe(2);
    expect(Object.isFrozen(session.selection.head)).toBe(true);
    unsubscribe();
    session.undo();
    expect(received).toEqual(['ab']);
  });
  it('rejects invalid resulting selections before any commit', () => {
    const session = new DocumentSession('a');
    expect(() => session.apply([{ from: 0, to: 1, insert: '' }], caret(1))).toThrow();
    expect(session.source).toBe('a');
    expect(session.revision).toBe(0);
  });
  it('selection-only changes create no content revision or undo entry', () => {
    const session = new DocumentSession('abc');
    session.apply([], caret(2));
    expect(session.revision).toBe(0);
    expect(session.selection.head.offset).toBe(2);
    expect(session.undo()).toBe(false);
  });
});

it('rejects unpaired UTF16 in incoming sources and insertions', () => {
  expect(() => new DocumentSession('\uD800')).toThrow(TypeError);
  const session = new DocumentSession('a');
  expect(() => session.apply([{ from: 1, to: 1, insert: '\uDC00' }], caret(2))).toThrow(TypeError);
  expect(session.source).toBe('a');
});
