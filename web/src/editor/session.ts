import { Annotation, ChangeSet, Compartment, EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, undo, redo, undoDepth, redoDepth, isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { codeLanguage, fencedCodeHighlighting } from '../live/code-highlighting';
import { linkOpening } from '../live/links';
import { search, searchKeymap, openSearchPanel, getSearchQuery, setSearchQuery, SearchQuery,
  findNext, findPrevious, replaceNext, replaceAll } from '@codemirror/search';
import type { Appearance, Commit, CommitReason, Mode, Patch, Payloads, Range, Revision, Selection, Snapshot, Source } from '../protocol';
import { applyPatches, encodeSource } from './source';
import { changedPatches, restoreEOLs, sourceAt, sourceHistory } from './history';
import { clipboardPayload, pastePayload, type ClipboardPayload, type PasteInput } from './clipboard';
import { format, insertImages, type FormatOptions } from './commands';
import { findRanges, nextRange, replacePatches, type FindOptions } from './search';
import type { LiveExtensionFactory, LiveOptions } from './live-contract';

export interface EditorOptions {
  liveExtensions?: LiveExtensionFactory;
  resolveImage?: (destination: string) => string | null;
  onState?: (state: Payloads['state'] & { readOnly: boolean }) => void;
  writeClipboard?: (payload: ClipboardPayload) => void | Promise<void>;
  requestAsset?: (action: 'paste' | 'choose' | 'drop') => void | Promise<void>;
  openLink?: (url: string) => void;
}
export interface EditOptions { selection?: Selection; userEvent?: string }
const reasonAnnotation = Annotation.define<CommitReason>();
const nativeAsset = Annotation.define<boolean>();
const clone = (snapshot: Snapshot): Snapshot => ({ ...snapshot, eols: [...snapshot.eols] });
const sameSource = (a: Source, b: Source) => a.text === b.text && a.bom === b.bom && a.eols.length === b.eols.length && a.eols.every((e, i) => e === b.eols[i]);

/** Owns one persistent CM history; the view is an optional projection of that state. */
export class EditorSession {
  state: EditorState;
  view?: EditorView;
  private committed: Snapshot;
  private committedSelection: Selection = { anchor: 0, head: 0 };
  private mode: Mode = 'source';
  private appearance: Appearance = 'system';
  private zoom = 1;
  private readonly options: EditorOptions;
  private readonly emit: (commit: Commit) => void;
  private readonly modeSlot = new Compartment();
  private readonly appearanceSlot = new Compartment();
  private readonly zoomSlot = new Compartment();
  private readonly readOnlySlot = new Compartment();
  private readonly liveSlot = new Compartment();
  private composing = false;
  private compositionRange: Range | null = null;
  private composedChanges: ChangeSet | null = null;
  private afterComposition: (() => void)[] = [];
  private compositionTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private locked = false;
  private acknowledged: Revision;
  private readonly outbox = new Map<Revision, Commit>();

  constructor(initial: Snapshot, emit: (commit: Commit) => void, options: EditorOptions = {}) {
    if (!Number.isSafeInteger(initial.revision) || initial.revision < 0) throw new Error('Invalid revision');
    encodeSource(initial); // Validate the source before constructing any state.
    this.committed = clone(initial); this.acknowledged = initial.revision;
    this.emit = emit; this.options = options;
    this.state = EditorState.create({ doc: initial.text, extensions: [
      sourceHistory(initial), markdown({ codeLanguages: codeLanguage }), fencedCodeHighlighting, search({ top: true }),
      EditorState.transactionExtender.of(tr => tr.docChanged && tr.isUserEvent('input.replace')
        ? { annotations: isolateHistory.of('full') } : null),
      this.modeSlot.of(EditorView.editorAttributes.of({ 'data-mode': this.mode })),
      this.appearanceSlot.of(this.theme()), this.zoomSlot.of([]), this.liveSlot.of([]),
      this.readOnlySlot.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
      EditorState.transactionFilter.of(tr => this.locked && tr.docChanged && !tr.annotation(nativeAsset) ? [] : tr),
      keymap.of([
        { key: 'Mod-z', run: () => this.runHistory('undo') },
        { key: 'Mod-Shift-z', run: () => this.runHistory('redo') },
        { key: 'Mod-y', run: () => this.runHistory('redo') },
        { key: 'Mod-/', run: () => { this.setMode(this.mode === 'live' ? 'source' : 'live'); return true; } },
        ...[['Mod-b', 'bold'], ['Mod-i', 'italic'], ['Mod-`', 'inlineCode'], ['Mod-k', 'link'], ['Mod-Shift-7', 'orderedList'], ['Mod-Shift-8', 'list']].map(([key, kind]) => ({ key, run: () => this.keyFormat(kind) })),
        { key: 'Enter', run: () => this.keyFormat('newline') },
        { key: 'Tab', run: () => this.keyFormat('indent') },
        { key: 'Shift-Tab', run: () => this.keyFormat('outdent') },
        { key: 'Mod-f', run: () => { void this.command('find'); return true; } },
        { key: 'Mod-g', run: () => { void this.command('find', { backwards: false }); return true; } },
        { key: 'Mod-Shift-g', run: () => { void this.command('find', { backwards: true }); return true; } },
        { key: 'Mod-Alt-f', run: () => { void this.command('replace'); return true; } },
        ...searchKeymap, ...defaultKeymap,
      ]),
      EditorView.domEventHandlers({
        compositionstart: () => { this.beginComposition(); return false; },
        compositionend: () => {
          // CM flushes final DOM mutations in a microtask after this event.
          clearTimeout(this.compositionTimer);
          this.compositionTimer = setTimeout(() => { if (!this.destroyed) this.endComposition(); }, 0);
          return false;
        },
        copy: event => {
          if (this.state.selection.main.empty) return false;
          const payload = clipboardPayload(this.getSource(), this.selection(), this.mode);
          event.preventDefault(); event.clipboardData?.setData('text/plain', payload.text);
          if (this.options.writeClipboard) void Promise.resolve(this.options.writeClipboard(payload)).catch(() => {});
          return true;
        },
        cut: event => {
          if (this.composing || this.locked) return true;
          if (this.state.selection.main.empty) return false;
          const payload = clipboardPayload(this.getSource(), this.selection(), this.mode);
          event.preventDefault(); event.clipboardData?.setData('text/plain', payload.text);
          if (this.options.writeClipboard) void Promise.resolve(this.options.writeClipboard(payload)).catch(() => {});
          const { from, to } = this.state.selection.main;
          this.edit([{ from, to, insert: '', eols: [] }], { userEvent: 'delete.cut' }); return true;
        },
        paste: event => {
          if (this.composing || this.locked) { event.preventDefault(); return true; }
          const data = event.clipboardData;
          if (!data) return false;
          event.preventDefault();
          void this.paste({ text: data.types.includes('text/plain') ? data.getData('text/plain') : null,
            hasImage: Array.from(data.items).some(item => item.type.startsWith('image/')) }).catch(() => {});
          return true;
        },
        drop: event => {
          if (!event.dataTransfer) return false;
          if (Array.from(event.dataTransfer.files).some(file => file.type.startsWith('image/'))) {
            event.preventDefault();
            if (!this.locked && !this.composing) void this.options.requestAsset?.('drop');
            return true;
          }
          return false;
        },
      }),
      linkOpening(url => this.options.openLink?.(url), () => this.composing),
      EditorView.lineWrapping,
    ] });
    if (options.liveExtensions) this.liveExtensions(options.liveExtensions);
  }
  private assertAlive(): void { if (this.destroyed) throw new Error('Editor session destroyed'); }
  private assertEditable(): void {
    this.assertAlive(); if (this.locked) throw new Error('Editor is read-only during asset adoption');
    if (this.composing) throw new Error('Wait for composition to finish');
  }
  private keyFormat(kind: string): boolean {
    if (this.composing || this.locked) return false;
    format(this, { kind }); return true;
  }
  attach(parent: HTMLElement): void {
    this.assertAlive();
    if (this.view) throw new Error('View already attached');
    this.view = new EditorView({ state: this.state, parent,
      dispatchTransactions: transactions => { for (const tr of transactions) this.dispatch(tr); } });
  }
  getSource(): Source { return sourceAt(this.state, this.committed.bom); }
  snapshot(): Snapshot { return clone(this.committed); }
  selection(): Selection { const { anchor, head } = this.state.selection.main; return { anchor, head }; }
  barrier(): Payloads['snapshot'] {
    return { snapshot: this.snapshot(), selection: { ...(this.composing ? this.committedSelection : this.selection()) }, composing: this.composing };
  }
  status(): Payloads['state'] & { readOnly: boolean } {
    return { revision: this.committed.revision, selection: this.composing ? { ...this.committedSelection } : this.selection(), canUndo: !this.locked && !this.composing && undoDepth(this.state) > 0,
      canRedo: !this.locked && !this.composing && redoDepth(this.state) > 0, composing: this.composing, mode: this.mode, readOnly: this.locked };
  }
  private notify(): void { this.options.onState?.(this.status()); }
  dispatch(spec: TransactionSpec | Transaction): void {
    this.assertAlive();
    const tr = spec instanceof Transaction ? spec : this.state.update(spec);
    if (tr.startState !== this.state) throw new Error('Stale CodeMirror transaction');
    if (this.locked && tr.docChanged && !tr.annotation(nativeAsset)) return;
    if (tr.annotation(Transaction.userEvent)?.startsWith('input.type.compose') && !this.composing) this.beginComposition();
    const before = this.getSource();
    const next = sourceAt(tr.state, this.committed.bom);
    // Check UTF-16 boundaries/metadata even on transactions produced directly by CM.
    applyPatches(before, changedPatches(before, tr.changes, next));
    this.state = tr.state; this.view?.update([tr]);
    if (this.composing) {
      this.composedChanges = this.composedChanges!.compose(tr.changes);
      const main = this.state.selection.main;
      this.compositionRange = { from: Math.min(this.compositionRange!.from, main.from), to: Math.max(main.to, this.compositionRange!.from) };
    } else {
      this.publish(tr.changes, tr.annotation(reasonAnnotation) ?? (tr.isUserEvent('undo') ? 'undo' : tr.isUserEvent('redo') ? 'redo' : 'edit'));
      this.committedSelection = this.selection();
    }
    this.notify();
  }
  private publish(changes: ChangeSet, reason: CommitReason): void {
    const after = this.getSource();
    if (sameSource(this.committed, after)) return;
    if (this.committed.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Revision exhausted');
    const commit: Commit = { base: this.committed.revision, revision: this.committed.revision + 1,
      patches: changedPatches(this.committed, changes, after), selection: this.selection(), reason };
    this.committed = { ...after, revision: commit.revision };
    this.outbox.set(commit.revision, structuredClone(commit));
    this.emit(structuredClone(commit));
  }
  edit(patches: readonly Patch[], options: EditOptions = {}): void {
    this.assertEditable(); this.patchTransaction(patches, 'edit', options);
  }
  private patchTransaction(patches: readonly Patch[], reason: CommitReason, options: EditOptions = {}): void {
    const next = applyPatches(this.getSource(), patches);
    if (sameSource(this.getSource(), next)) return;
    this.dispatch({ changes: patches.map(p => ({ from: p.from, to: p.to, insert: p.insert })),
      effects: restoreEOLs.of(next.eols), selection: options.selection,
      annotations: [reasonAnnotation.of(reason), isolateHistory.of('full'), nativeAsset.of(reason === 'assets')],
      userEvent: options.userEvent ?? 'input' });
  }
  apply(base: Revision, patches: readonly Patch[], reason: 'assets'): void {
    this.assertAlive(); if (this.composing) throw new Error('Wait for composition to finish');
    if (base !== this.committed.revision) throw new Error('Stale asset patch base');
    if (reason !== 'assets') throw new Error('Invalid patch reason');
    this.patchTransaction(patches, reason);
  }
  acknowledge(revision: Revision): void {
    if (!Number.isSafeInteger(revision) || revision < this.acknowledged || revision > this.committed.revision) throw new Error('Invalid acknowledgement revision');
    this.acknowledged = revision;
    for (const key of this.outbox.keys()) if (key <= revision) this.outbox.delete(key);
  }
  pendingCommits(): Commit[] { return [...this.outbox.values()].map(c => structuredClone(c)); }
  beginComposition(): void {
    this.assertAlive(); if (this.composing) return;
    if (this.locked) throw new Error('Editor is read-only');
    this.committedSelection = this.selection(); this.composing = true;
    const { from, to } = this.state.selection.main; this.compositionRange = { from, to };
    this.composedChanges = ChangeSet.empty(this.state.doc.length); this.notify();
  }
  endComposition(): void {
    if (!this.composing) return;
    this.composing = false; this.compositionRange = null;
    const changes = this.composedChanges!; this.composedChanges = null;
    this.publish(changes, 'edit'); this.committedSelection = this.selection(); this.notify();
    for (const action of this.afterComposition.splice(0)) action();
  }
  private runHistory(name: 'undo' | 'redo'): boolean {
    if (this.composing || this.locked) return false;
    return (name === 'undo' ? undo : redo)({ state: this.state, dispatch: tr => this.dispatch(tr) });
  }
  private theme() {
    const dark = this.appearance === 'dark' || this.appearance === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
    return EditorView.theme({ '&': { color: 'var(--body-fg)', backgroundColor: 'var(--body-bg)', colorScheme: dark ? 'dark' : 'light' },
      '.cm-content': { caretColor: 'var(--body-fg)' }, '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' } }, { dark });
  }
  setMode(mode: Mode): void {
    if (mode !== 'source' && mode !== 'live') throw new Error('Invalid mode');
    if (this.composing) { this.afterComposition.push(() => this.setMode(mode)); return; }
    this.mode = mode; this.dispatch({ effects: this.modeSlot.reconfigure(EditorView.editorAttributes.of({ 'data-mode': mode })), annotations: Transaction.addToHistory.of(false) });
  }
  liveExtensions(factory: LiveExtensionFactory): void {
    if (this.composing) { this.afterComposition.push(() => this.liveExtensions(factory)); return; }
    const options: LiveOptions = { getSource: () => this.getSource(), apply: (patches, options) => this.edit(patches, options),
      resolveImage: destination => this.options.resolveImage?.(destination) ?? null, getMode: () => this.mode,
      composition: () => ({ composing: this.composing, range: this.compositionRange ? { ...this.compositionRange } : null }) };
    this.dispatch({ effects: this.liveSlot.reconfigure(factory(options)), annotations: Transaction.addToHistory.of(false) });
  }
  async paste(input: PasteInput): Promise<void> {
    this.assertEditable(); const payload = pastePayload(input);
    if (payload.kind === 'image') { await this.options.requestAsset?.('paste'); return; }
    if (payload.kind === 'none') return;
    const { from, to } = this.state.selection.main, { text, eols } = payload.source;
    this.edit([{ from, to, insert: text, eols }], { selection: { anchor: from + text.length, head: from + text.length }, userEvent: 'input.paste' });
  }
  async command(name: string, args?: unknown): Promise<void> {
    this.assertAlive();
    const object = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    if (name === 'setReadOnly') {
      if (typeof object.value !== 'boolean') throw new Error('setReadOnly requires boolean value');
      if (object.value && this.composing) throw new Error('Cannot lock during composition');
      this.locked = object.value;
      this.dispatch({ effects: this.readOnlySlot.reconfigure([EditorState.readOnly.of(this.locked), EditorView.editable.of(!this.locked)]), annotations: Transaction.addToHistory.of(false) }); return;
    }
    if (['copySource', 'copyPlain', 'copyRich'].includes(name)) {
      await this.options.writeClipboard?.(clipboardPayload(this.getSource(), this.selection(), this.mode,
        name === 'copyRich' ? 'rich' : name === 'copyPlain' ? 'plain' : 'source', { resolveImage: this.options.resolveImage })); return;
    }
    if (this.composing) await new Promise<void>(resolve => this.afterComposition.push(resolve));
    this.assertAlive();
    switch (name) {
      case 'undo': case 'redo': this.runHistory(name); return;
      case 'setMode': this.setMode((typeof args === 'string' ? args : object.mode) as Mode); return;
      case 'setAppearance': {
        const appearance = typeof args === 'string' ? args : object.appearance;
        if (!['system', 'light', 'dark'].includes(String(appearance))) throw new Error('Invalid appearance');
        this.appearance = appearance as Appearance;
        this.dispatch({ effects: this.appearanceSlot.reconfigure(this.theme()), annotations: Transaction.addToHistory.of(false) }); return;
      }
      case 'setZoom': {
        const zoom = typeof args === 'number' ? args : object.zoom;
        if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0.25 || zoom > 5) throw new Error('Invalid zoom');
        this.zoom = zoom;
        this.dispatch({ effects: this.zoomSlot.reconfigure(EditorView.theme({ '&': { fontSize: `${16 * zoom}px` } })), annotations: Transaction.addToHistory.of(false) }); return;
      }
      case 'format': this.assertEditable(); format(this, (typeof args === 'string' ? { kind: args } : object) as FormatOptions); return;
      case 'insertImage': {
        this.assertEditable();
        if (object.destinations !== undefined || object.destination !== undefined) {
          const destinations = object.destinations ?? [object.destination];
          if (!Array.isArray(destinations)) throw new Error('Image destinations must be an array');
          insertImages(this, destinations, object.alt === undefined ? '' : object.alt as string);
        } else await this.options.requestAsset?.('choose');
        return;
      }
      case 'revealRange': {
        const range = (object.range ?? object) as Range;
        if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to < range.from || range.to > this.state.doc.length) throw new Error('Invalid reveal range');
        // Source selection itself reveals delimiters in the live extension.
        this.dispatch({ selection: EditorSelection.single(range.from, range.to), effects: EditorView.scrollIntoView(range.from, { y: 'center' }) }); return;
      }
      case 'find': case 'replace': case 'replaceAll': {
        if (object.query !== undefined && typeof object.query !== 'string') throw new Error('Find requires query text');
        if (!args && this.view && name !== 'replaceAll') {
          openSearchPanel(this.view);
          if (name === 'replace') this.view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus();
          return;
        }
        const panel = getSearchQuery(this.state);
        const backwards = typeof object.backwards === 'boolean' ? object.backwards : object.previous === true;
        const query = new SearchQuery({ search: typeof object.query === 'string' ? object.query : panel.search,
          replace: typeof object.replacement === 'string' ? object.replacement : panel.replace,
          caseSensitive: typeof object.caseSensitive === 'boolean' ? object.caseSensitive : panel.caseSensitive,
          regexp: typeof object.regexp === 'boolean' ? object.regexp : panel.regexp,
          literal: panel.literal, wholeWord: panel.wholeWord });
        if (!query.eq(panel)) this.dispatch({ effects: setSearchQuery.of(query) });
        if (this.view) {
          if (name !== 'find') this.assertEditable();
          (name === 'replaceAll' ? replaceAll : name === 'replace' ? replaceNext : backwards ? findPrevious : findNext)(this.view);
          return;
        }
        // Headless commands share CM's query state; mounted UI uses CM's own commands above.
        const options: FindOptions = { query: query.search, replacement: query.replace, caseSensitive: query.caseSensitive, regexp: query.regexp, backwards };
        const ranges = findRanges(this.getSource().text, options);
        if (name === 'replaceAll') { this.assertEditable(); this.edit(replacePatches(this.getSource(), options, ranges)); return; }
        const selection = this.state.selection.main;
        if (name === 'replace') {
          this.assertEditable(); const selected = ranges.find(r => r.from === selection.from && r.to === selection.to);
          if (selected) { this.edit(replacePatches(this.getSource(), options, [selected])); return; }
        }
        const range = nextRange(ranges, backwards ? selection.from : selection.to, backwards);
        if (range) this.dispatch({selection: EditorSelection.single(range.from, range.to), userEvent:'select.search'}); return;
      }
      default: throw new Error(`Unknown command: ${name}`);
    }
  }
  destroy(): void {
    if (this.destroyed) return;
    clearTimeout(this.compositionTimer); this.view?.destroy(); this.view = undefined; this.destroyed = true;
    for (const action of this.afterComposition.splice(0)) action();
  }
}
export function createSession(initial: Snapshot, emit: (commit: Commit) => void, options?: EditorOptions): EditorSession {
  return new EditorSession(initial, emit, options);
}
export function createEditor(parent: HTMLElement, initial: Snapshot, emit: (commit: Commit) => void, options?: EditorOptions): EditorSession {
  const session = createSession(initial, emit, options); session.attach(parent); return session;
}
/** Task 4 can inject/reconfigure live decorations without writing the session. */
export function liveExtensions(session: EditorSession, factory: LiveExtensionFactory): void { session.liveExtensions(factory); }
