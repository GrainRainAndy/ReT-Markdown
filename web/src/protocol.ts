/** Protocol v1. All offsets are UTF-16 in LF-normalized text. */
export type EOL = '\n' | '\r\n' | '\r';
export type Revision = number;
export type Range = { from: number; to: number };
export type Selection = { anchor: number; head: number };
export type Source = { text: string; eols: EOL[]; bom: boolean };
export type Snapshot = Source & { revision: Revision };
export type Patch = Range & { insert: string; eols: EOL[] };
export type CommitReason = 'edit' | 'undo' | 'redo' | 'assets';
export type Commit = { base: Revision; revision: Revision; patches: Patch[]; selection: Selection; reason: CommitReason };
export type Mode = 'live' | 'source';
export type Appearance = 'system' | 'light' | 'dark';
export type SnapshotPurpose = 'save' | 'export' | 'close';
export type CommandName = 'undo' | 'redo' | 'format' | 'find' | 'replace' | 'replaceAll' |
  'copySource' | 'copyPlain' | 'copyRich' | 'insertImage' | 'setMode' | 'setAppearance' | 'setZoom' | 'revealRange' |
  'setReadOnly' | 'setAssets'; // Internal Save As transaction lock.
export type EditorCommand = { name: CommandName; args?: unknown };

export interface Payloads {
  ready: Record<string, never>;
  load: { snapshot: Snapshot; mode: Mode; selection: Selection; assetBase: string; assets?: Record<string, string>; appearance: Appearance; zoom: number };
  loaded: { revision: Revision };
  commit: Commit;
  ack: { revision: Revision };
  resyncRequired: { expected: Revision };
  barrier: { purpose: SnapshotPurpose };
  snapshot: { snapshot: Snapshot; selection: Selection; composing: boolean };
  command: EditorCommand;
  result: { ok: boolean; error?: string };
  applyPatches: { base: Revision; patches: Patch[]; reason: 'assets' };
  saved: { revision: Revision; contentHash: string };
  state: { revision: Revision; selection: Selection; canUndo: boolean; canRedo: boolean; composing: boolean; mode: Mode };
  clipboardWrite: { text: string; html?: string };
  openLink: { url: string };
  assetRequest: { action: 'paste' | 'choose' | 'drop'; requestID: string };
  error: { code: string; message: string; range?: Range };
}
export type MessageType = keyof Payloads;
/** Distributive union preserves the type/payload relationship when T is omitted. */
export type Envelope<T extends MessageType = MessageType> = {
  [K in T]: { v: 1; documentID: string; sessionID: string; id: string; replyTo?: string; type: K; payload: Payloads[K] }
}[T];
export type BridgeEnvelope<T extends MessageType = MessageType> = Envelope<T>;
export const WEB_MESSAGE_TYPES = ['ready', 'loaded', 'commit', 'snapshot', 'result', 'state', 'clipboardWrite', 'openLink', 'assetRequest', 'error'] as const satisfies readonly MessageType[];
export const NATIVE_MESSAGE_TYPES = ['load', 'ack', 'resyncRequired', 'barrier', 'command', 'applyPatches', 'saved', 'result', 'error'] as const satisfies readonly MessageType[];
