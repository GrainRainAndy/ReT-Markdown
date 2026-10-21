import { expect, it } from 'vitest';
import { Transaction } from '@codemirror/state';
import { createSession } from '../src/editor/session';
import { decodeSource } from '../src/editor/source';
import type { Commit } from '../src/protocol';

for (const name of ['undo', 'format', 'find'] as const)
it(`rechecks ${name} ownership when another composition starts before its continuation`, async () => {
  const initial = { ...decodeSource(new TextEncoder().encode('\uFEFFab\r\ntail')), revision: 0 };
  const commits: Commit[] = [], s = createSession(initial, c => commits.push(c));
  try {
    s.dispatch({ selection: { anchor: 1 } }); s.beginComposition();
    s.dispatch({ changes: { from: 1, insert: '中' }, selection: { anchor: 2 },
      userEvent: 'input.type.compose.start', annotations: Transaction.time.of(1000) });
    let outcome = 'pending';
    const pending = s.command(name, name === 'format' ? { kind: 'bold' } : name === 'find' ? { query: 'tail' } : undefined)
      .then(() => { outcome = 'resolved'; }, error => { outcome = String(error); });
    s.endComposition(); s.beginComposition();
    s.dispatch({ changes: { from: 2, insert: '文' }, selection: { anchor: 3 },
      userEvent: 'input.type.compose.start', annotations: Transaction.time.of(3000) });
    await Promise.resolve(); await Promise.resolve();
    expect(outcome).toBe('pending');
    expect(s.state.doc.toString()).toBe('a中文b\ntail');
    expect(s.selection()).toEqual({ anchor: 3, head: 3 });
    expect(s.barrier()).toEqual({ snapshot: { ...initial, text: 'a中b\ntail', revision: 1 }, selection: { anchor: 2, head: 2 }, composing: true });
    s.endComposition(); await pending;
    expect(outcome).toBe('resolved');
    if (name === 'undo') {
      expect(s.snapshot()).toEqual({ ...initial, text: 'a中b\ntail', revision: 3 });
      expect(commits.at(-1)?.reason).toBe('undo');
    } else if (name === 'format') {
      expect(s.snapshot()).toEqual({ ...initial, text: 'a中文****b\ntail', revision: 3 });
    } else {
      expect(s.snapshot()).toEqual({ ...initial, text: 'a中文b\ntail', revision: 2 });
      expect(s.selection()).toEqual({ anchor: 5, head: 9 });
    }
  } finally { s.destroy(); }
});

it('rejects a queued command when its composing session is destroyed', async () => {
  const s = createSession({ text: 'ab', eols: [], bom: false, revision: 0 }, () => {});
  s.beginComposition();
  const result = s.command('undo').then(() => 'resolved', error => String(error));
  s.destroy();
  expect(await result).toContain('Editor session destroyed');
});
