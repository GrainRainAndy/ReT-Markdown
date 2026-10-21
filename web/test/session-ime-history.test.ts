import { expect, it } from 'vitest';
import { Transaction } from '@codemirror/state';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource } from '../src/editor/source';
import type { Commit } from '../src/protocol';

it('keeps CM cross-line deletion and delayed first preedit in one composition undo', async () => {
  const initial = { ...decodeSource(new TextEncoder().encode('\uFEFFAlpha\r\n\rBeta\n\ntail')), revision: 0 };
  const commits: Commit[] = [], s = createSession(initial, c => commits.push(c));
  s.dispatch({ selection: { anchor: 11, head: 0 } }); s.beginComposition();
  // The mounted test proves CM emits this unannotated input at compositionstart.
  s.dispatch({ changes: { from: 0, to: 11 }, userEvent: 'input', annotations: Transaction.time.of(1000) });
  s.dispatch({ changes: { from: 0, insert: '中' }, selection: { anchor: 1 },
    userEvent: 'input.type.compose.start', annotations: Transaction.time.of(3000) });
  expect(s.barrier()).toEqual({ snapshot: initial, selection: { anchor: 11, head: 0 }, composing: true });
  s.endComposition(); expect(commits).toHaveLength(1);
  await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(encodeSource(initial));
  expect(s.selection()).toEqual({ anchor: 11, head: 0 });
  await s.command('redo'); expect(s.snapshot().text).toBe('中\n\ntail');
  s.destroy();
});
