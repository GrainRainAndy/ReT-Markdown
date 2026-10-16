import { StateEffect, StateField, EditorState, type Extension, type ChangeSet } from '@codemirror/state';
import { history, invertedEffects } from '@codemirror/commands';
import type { EOL, Patch, Source } from '../protocol';
import { applyPatches } from './source';

/** Arrays are immutable snapshots; inverses travel with CM's own history event. */
export const restoreEOLs = StateEffect.define<readonly EOL[]>();
export const eolField = StateField.define<readonly EOL[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(restoreEOLs)) value = effect.value;
    return value;
  },
});
export const newlineCount = (text: string) => (text.match(/\n/g) ?? []).length;
export function inheritedEOL(source: Source, position: number): EOL {
  const index = newlineCount(source.text.slice(0, position));
  return source.eols[index] ?? source.eols[index - 1] ?? '\n';
}
export function sourceAt(state: EditorState, bom: boolean): Source {
  return { text: state.doc.toString(), eols: [...state.field(eolField)], bom };
}
export function changedPatches(before: Source, changes: ChangeSet, after: Source): Patch[] {
  const patches: Patch[] = [];
  let cursor = 0, eolIndex = 0;
  changes.iterChanges((from, to, newFrom, newTo) => {
    eolIndex += newlineCount(after.text.slice(cursor, newFrom));
    const insert = after.text.slice(newFrom, newTo), count = newlineCount(insert);
    patches.push({ from, to, insert, eols: after.eols.slice(eolIndex, eolIndex + count) });
    cursor = newTo; eolIndex += count;
  });
  // An EOL-only replacement is still a content change, even if CM elides text changes.
  if (!patches.length) {
    let index = 0;
    for (let p = 0; p < before.text.length; p++) if (before.text[p] === '\n') {
      if (before.eols[index] !== after.eols[index]) patches.push({ from: p, to: p + 1, insert: '\n', eols: [after.eols[index]] });
      index++;
    }
  }
  return patches;
}
export function sourceHistory(initial: Source): Extension {
  return [
    eolField.init(() => [...initial.eols]),
    EditorState.transactionExtender.of(tr => {
      if (!tr.docChanged || tr.effects.some(e => e.is(restoreEOLs))) return null;
      const before = sourceAt(tr.startState, initial.bom);
      const patches: Patch[] = [];
      tr.changes.iterChanges((from, to, _a, _b, inserted) => {
        const insert = inserted.toString();
        patches.push({ from, to, insert, eols: Array<EOL>(newlineCount(insert)).fill(inheritedEOL(before, from)) });
      });
      return { effects: restoreEOLs.of(applyPatches(before, patches).eols) };
    }),
    invertedEffects.of(tr => tr.docChanged || tr.effects.some(e => e.is(restoreEOLs))
      ? [restoreEOLs.of([...tr.startState.field(eolField)])] : []),
    history(),
  ];
}
