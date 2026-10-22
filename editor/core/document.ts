import { History, type HistoryState } from './history';
import type { DocumentSnapshot, LogicalSelection, Patch } from './types';

function freezeSelection(selection: LogicalSelection, length: number): LogicalSelection {
  for (const anchor of [selection.anchor, selection.head]) {
    if (!Number.isInteger(anchor.offset) || anchor.offset < 0 || anchor.offset > length) throw new RangeError('Selection is outside the source');
    if (anchor.affinity !== 'before' && anchor.affinity !== 'after') throw new TypeError('Invalid affinity');
  }
  const copy = structuredClone(selection);
  Object.freeze(copy.anchor); Object.freeze(copy.head); Object.freeze(copy.owner);
  if (copy.cellRange) Object.freeze(copy.cellRange);
  return Object.freeze(copy);
}

function isWellFormed(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

/** Validates before mutating. Patches use coordinates in the same original source. */
function applyPatches(source: string, patches: readonly Patch[]): string {
  const sorted = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  const boundaries = new Set<number>([source.length]);
  for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)) boundaries.add(segment.index);
  let previous: Patch | undefined;
  for (const patch of sorted) {
    if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to) || patch.from < 0 || patch.to < patch.from || patch.to > source.length) throw new RangeError('Invalid patch range');
    if (typeof patch.insert !== 'string' || !isWellFormed(patch.insert)) throw new TypeError('Insert must be well-formed UTF-16');
    if (!boundaries.has(patch.from) || !boundaries.has(patch.to)) throw new RangeError('Patch splits a grapheme');
    if (previous && (patch.from < previous.to || patch.from === previous.from)) throw new RangeError('Patches overlap or share an ambiguous insertion point');
    previous = patch;
  }
  let result = source;
  for (const patch of [...sorted].reverse()) result = result.slice(0, patch.from) + patch.insert + result.slice(patch.to);
  return result;
}

export class DocumentSession {
  private current: DocumentSnapshot;
  private savedSource: string;
  private readonly history = new History();
  private readonly listeners = new Set<(snapshot: DocumentSnapshot) => void>();
  constructor(source: string) {
    if (!isWellFormed(source)) throw new TypeError('Source must be well-formed UTF-16');
    this.savedSource = source;
    this.current = Object.freeze({ source, revision: 0, dirty: false, selection: freezeSelection({ anchor: { offset: 0, affinity: 'after' }, head: { offset: 0, affinity: 'after' }, owner: { kind: 'source' }, kind: 'text' }, source.length) });
  }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }
  get source(): string { return this.current.source; }
  get revision(): number { return this.current.revision; }
  get dirty(): boolean { return this.current.dirty; }
  get selection(): LogicalSelection { return this.current.selection; }
  get snapshot(): DocumentSnapshot { return this.current; }
  subscribe(listener: (snapshot: DocumentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  setSelection(selection: LogicalSelection): void {
    const next = freezeSelection(selection, this.source.length);
    this.history.breakGroup();
    this.current = Object.freeze({ ...this.current, selection: next });
    this.publish();
  }
  apply(patches: readonly Patch[], selection: LogicalSelection, group?: string): DocumentSnapshot {
    const source = applyPatches(this.source, patches);
    const nextSelection = freezeSelection(selection, source.length);
    if (source === this.source) { this.setSelection(nextSelection); return this.current; }
    this.history.record({ source: this.source, selection: this.selection }, { source, selection: nextSelection }, group);
    this.commit({ source, selection: nextSelection });
    return this.current;
  }
  undo(): boolean {
    const state = this.history.undo();
    if (!state) return false;
    this.commit(state);
    return true;
  }
  redo(): boolean {
    const state = this.history.redo();
    if (!state) return false;
    this.commit(state);
    return true;
  }
  /** Call only after the host has confirmed this exact snapshot reached disk. */
  markSaved(source: string): void {
    this.savedSource = source;
    this.history.breakGroup();
    this.current = Object.freeze({ ...this.current, dirty: this.source !== source });
    this.publish();
  }
  private commit(state: HistoryState): void {
    this.current = Object.freeze({ ...state, revision: this.revision + 1, dirty: state.source !== this.savedSource });
    this.publish();
  }
  private publish(): void { const snapshot = this.current; for (const listener of [...this.listeners]) listener(snapshot); }
}
