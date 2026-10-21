/** All source offsets are UTF-16 code units and ranges are half-open. */
export interface SourceRange { from: number; to: number }
export interface Patch extends SourceRange { insert: string }
export type Affinity = 'before' | 'after';
export interface Anchor { offset: number; affinity: Affinity }
export type Owner =
  | { kind: 'prose' | 'source' }
  | { kind: 'code' | 'math'; nodeId: string }
  | { kind: 'cell'; tableId: string; row: number; column: number };
export interface LogicalSelection {
  anchor: Anchor;
  head: Anchor;
  owner: Owner;
  kind: 'text' | 'node' | 'cells';
  cellRange?: { fromRow: number; fromColumn: number; toRow: number; toColumn: number };
}
export interface DocumentSnapshot {
  readonly source: string;
  readonly revision: number;
  readonly dirty: boolean;
  readonly selection: LogicalSelection;
}
