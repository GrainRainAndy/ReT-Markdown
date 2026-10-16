import { createEditor, type EditorSession } from './editor/session';
import { liveExtensions } from './live/decorations';
import type { LiveExtensionFactory } from './editor/live-contract';
import { encodeSource } from './editor/source';
import { NATIVE_MESSAGE_TYPES, type Envelope, type MessageType, type Payloads, type Snapshot } from './protocol';

export interface EditorBootstrap { documentID: string; sessionID: string }
export interface EditorTransport {
  readonly session: EditorSession | null;
  receive(envelope: unknown): Promise<Envelope>;
  installLiveExtensions(factory: LiveExtensionFactory): void;
  destroy(): void;
}
declare global {
  interface Window {
    retEditorBootstrap?: EditorBootstrap;
    retEditor?: EditorTransport;
    webkit?: { messageHandlers?: { ret?: { postMessage(envelope: Envelope): void } } };
  }
}
const commands = new Set(['undo', 'redo', 'format', 'find', 'replace', 'replaceAll', 'copySource', 'copyPlain', 'copyRich', 'insertImage', 'setMode', 'setAppearance', 'setZoom', 'revealRange', 'setReadOnly', 'setAssets']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!record(value) || !revision(value.revision)) throw new Error('Invalid snapshot revision');
  encodeSource(value as unknown as Snapshot);
}
function assetMap(value: unknown): Record<string, string> {
  if (!record(value)) throw new Error('Invalid image capability map');
  const assets: Record<string, string> = Object.create(null);
  for (const [destination, capability] of Object.entries(value)) {
    if (typeof capability !== 'string' || !capability.startsWith('ret-resource://asset/')) throw new Error('Invalid local image capability');
    // Native mints these opaque UUID capabilities; destinations never become URLs.
    assets[destination] = capability;
  }
  return assets;
}
export function createTransport(parent: HTMLElement, identity: EditorBootstrap, post: (envelope: Envelope) => void, fallbackResolver?: (destination: string) => string | null): EditorTransport {
  if (!identifier(identity.documentID) || !identifier(identity.sessionID)) throw new Error('Invalid bootstrap identity');
  let session: EditorSession | null = null, sequence = 0, destroyed = false;
  let assets: Record<string, string> = Object.create(null), liveFactory: LiveExtensionFactory | undefined;
  const replies = new Map<string, { signature: string; promise: Promise<Envelope> }>();
  const commits = new Map<string, number>();
  const snapshotReplies = new Map<string, number>();
  const requests = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const send = <T extends MessageType>(type: T, payload: Payloads[T], replyTo?: string): Envelope<T> =>
    ({ v: 1, ...identity, id: `web-${++sequence}`, type, payload, ...(replyTo ? { replyTo } : {}) }) as Envelope<T>;
  const publish = (envelope: Envelope) => { if (!destroyed) post(envelope); };
  const result = (id: string, ok = true, error?: string) => send('result', { ok, ...(error ? { error } : {}) }, id);
  const snapshot = (id: string) => {
    if (!session) throw new Error('Editor not loaded');
    const envelope = send('snapshot', session.barrier(), id);
    snapshotReplies.set(envelope.id, envelope.payload.snapshot.revision); return envelope;
  };
  const resolveImage = (destination: string): string | null => {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(destination)) return null;
    let decoded = destination;
    try { decoded = decodeURIComponent(destination); } catch { /* Literal malformed escapes remain lookup keys. */ }
    return assets[destination] ?? assets[decoded] ?? fallbackResolver?.(decoded) ?? null;
  };
  const request = (type: 'clipboardWrite', payload: Payloads['clipboardWrite']): Promise<void> => {
    const envelope = send(type, payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(envelope.id); reject(new Error('Native clipboard request timed out')); }, 15000);
      requests.set(envelope.id, { resolve, reject, timer }); publish(envelope);
    });
  };
  const handle = async (envelope: Envelope): Promise<Envelope> => {
    const { id, type, payload } = envelope;
    switch (type) {
      case 'load': {
        if (session) throw new Error('load initializes a new session only');
        validateSnapshot(payload.snapshot);
        if (!['source', 'live'].includes(payload.mode) || !['system', 'light', 'dark'].includes(payload.appearance) ||
          typeof payload.assetBase !== 'string' || typeof payload.zoom !== 'number' || !Number.isFinite(payload.zoom) || payload.zoom < 0.25 || payload.zoom > 5 ||
          !record(payload.selection) || !revision(payload.selection.anchor) || !revision(payload.selection.head) ||
          payload.selection.anchor > payload.snapshot.text.length || payload.selection.head > payload.snapshot.text.length) throw new Error('Invalid load options');
        assets = payload.assets === undefined ? Object.create(null) : assetMap(payload.assets);
        session = createEditor(parent, payload.snapshot, commit => {
          const message = send('commit', commit); commits.set(message.id, commit.revision); publish(message);
        }, {
          resolveImage, liveExtensions: liveFactory,
          onState: state => { if (session) publish(send('state', state)); },
          writeClipboard: value => request('clipboardWrite', value),
          // Return immediately: native asset import may later enqueue applyPatches behind this command.
          requestAsset: action => { const message = send('assetRequest', { action, requestID: `asset-${sequence + 1}` }); publish(message); },
          openLink: url => publish(send('openLink', { url })),
        });
        session.dispatch({ selection: payload.selection });
        session.setMode(payload.mode);
        await session.command('setAppearance', { appearance: payload.appearance });
        await session.command('setZoom', { zoom: payload.zoom });
        session.view?.focus();
        publish(send('state', session.status()));
        return send('loaded', { revision: session.snapshot().revision }, id);
      }
      case 'ack': {
        if (!session || !revision(payload.revision)) throw new Error('Invalid acknowledgement');
        const expected = envelope.replyTo ? commits.get(envelope.replyTo) ?? snapshotReplies.get(envelope.replyTo) : undefined;
        if (expected === undefined || expected !== payload.revision) throw new Error('Acknowledgement does not match a commit/snapshot');
        // Older duplicate acks can arrive after a barrier has acknowledged a later revision.
        if (session.pendingCommits().some(c => c.revision <= payload.revision)) session.acknowledge(payload.revision);
        for (const [key, rev] of commits) if (rev <= payload.revision) commits.delete(key);
        for (const [key, rev] of snapshotReplies) if (rev <= payload.revision) snapshotReplies.delete(key);
        return result(id);
      }
      case 'resyncRequired':
        if (!revision(payload.expected) || !session || payload.expected > session.snapshot().revision) throw new Error('Invalid resync revision');
        // Native freezes persistence and requests a barrier. JS never adopts its stale mirror.
        return snapshot(id);
      case 'barrier':
        if (!['save', 'export', 'close'].includes(payload.purpose)) throw new Error('Invalid barrier purpose');
        return snapshot(id);
      case 'command': {
        if (!session) throw new Error('Editor not loaded');
        if (!commands.has(payload.name)) throw new Error('Command not allowlisted');
        if (payload.name === 'setAssets') {
          if (!record(payload.args)) throw new Error('setAssets requires {assets}');
          const updated = assetMap(payload.args.assets); assets = updated;
          if (liveFactory) session.liveExtensions(liveFactory);
        } else await session.command(payload.name, payload.args);
        return result(id);
      }
      case 'applyPatches':
        if (!session || !revision(payload.base) || !Array.isArray(payload.patches) || payload.reason !== 'assets') throw new Error('Invalid native patches');
        session.apply(payload.base, payload.patches, 'assets'); return result(id);
      case 'saved':
        if (!session || !revision(payload.revision) || payload.revision > session.snapshot().revision || typeof payload.contentHash !== 'string') throw new Error('Invalid saved receipt');
        return result(id); // Receipt never overwrites later edits or clears the sole history.
      case 'result': case 'error': {
        const pending = envelope.replyTo ? requests.get(envelope.replyTo) : undefined;
        if (pending) {
          if (envelope.type === 'result' && typeof envelope.payload.ok !== 'boolean') throw new Error('Invalid native result');
          clearTimeout(pending.timer); requests.delete(envelope.replyTo!);
          if (envelope.type === 'result' && envelope.payload.ok) pending.resolve();
          else pending.reject(new Error(envelope.type === 'error' ? envelope.payload.message : envelope.payload.error ?? 'Native request failed'));
        }
        return result(id);
      }
      default: throw new Error('Message not allowlisted');
    }
  };
  const transport: EditorTransport = {
    get session() { return session; },
    async receive(input) {
      let id: string | undefined;
      try {
        if (destroyed) throw new Error('Transport destroyed');
        if (!record(input) || !identifier(input.id)) throw new Error('Invalid message id');
        id = input.id;
        if (input.v !== 1 || input.documentID !== identity.documentID || input.sessionID !== identity.sessionID ||
          !record(input.payload) || typeof input.type !== 'string' || !(NATIVE_MESSAGE_TYPES as readonly string[]).includes(input.type) ||
          input.replyTo !== undefined && !identifier(input.replyTo)) throw new Error('Invalid envelope version, identity, payload or type');
        const signature = JSON.stringify(input);
        if (signature.length > 64 * 1024 * 1024) throw new Error('Message exceeds transport limit');
        const prior = replies.get(id);
        if (prior) { if (prior.signature !== signature) throw new Error('Message id reused for different payload'); return prior.promise; }
        // Register before executing an async mutation; repeated concurrent IDs share one execution.
        const promise = Promise.resolve().then(() => handle(input as unknown as Envelope)).catch(error =>
          send('error', { code: 'invalidMessage', message: error instanceof Error ? error.message : String(error) }, id));
        replies.set(id, { signature, promise });
        return promise;
      } catch (error) {
        return send('error', { code: 'invalidMessage', message: error instanceof Error ? error.message : String(error) }, id);
      }
    },
    installLiveExtensions(factory) {
      liveFactory = factory; session?.liveExtensions(factory);
    },
    destroy() {
      destroyed = true; session?.destroy();
      for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('Transport destroyed')); }
      requests.clear(); replies.clear(); commits.clear(); snapshotReplies.clear();
    },
  };
  // receive exists on the returned object before native observes ready.
  queueMicrotask(() => { if (!destroyed) publish(send('ready', {})); });
  return transport;
}

function bootstrap(): void {
  const parent = document.querySelector<HTMLElement>('#editor') ?? document.querySelector<HTMLElement>('#app') ?? document.body.appendChild(document.createElement('main'));
  parent.classList.add('markdown-body');
  const native = window.webkit?.messageHandlers?.ret;
  const identity = window.retEditorBootstrap ?? { documentID: 'browser-preview', sessionID: `preview-${Date.now()}` };
  const transport = createTransport(parent, identity, envelope => {
    if (native) native.postMessage(envelope);
    else if (envelope.type === 'clipboardWrite') {
      // Offline browser fallback uses standard clipboard capability, without HTML conversion on paste.
      const write = envelope.payload.html && typeof ClipboardItem !== 'undefined'
        ? navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([envelope.payload.text], { type: 'text/plain' }), 'text/html': new Blob([envelope.payload.html], { type: 'text/html' }) })])
        : navigator.clipboard?.writeText(envelope.payload.text) ?? Promise.reject(new Error('Clipboard permission unavailable'));
      void write.then(() => transport.receive({ v: 1, ...identity, id: `browser-${envelope.id}`, replyTo: envelope.id, type: 'result', payload: { ok: true } }),
        error => transport.receive({ v: 1, ...identity, id: `browser-${envelope.id}`, replyTo: envelope.id, type: 'result', payload: { ok: false, error: String(error) } }));
    }
  });
  transport.installLiveExtensions(liveExtensions);
  window.retEditor = transport;
  if (!native) void transport.receive({ v: 1, ...identity, id: 'preview-load', type: 'load', payload: {
    snapshot: { text: '', eols: [], bom: false, revision: 0 }, mode: 'source', selection: { anchor: 0, head: 0 }, assetBase: '', assets: {}, appearance: 'system', zoom: 1,
  } });
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
