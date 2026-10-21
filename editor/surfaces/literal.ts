import { defaultKeymap } from "@codemirror/commands";
import { EditorState, EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  mapText,
  mapTextToSource,
  mapSourceToText,
  type TextMapping,
} from "../syntax/mapping";
import { minimalPatch, newlineAt } from "./editing";
import type { Patch } from "../core/types";
export interface LiteralOptions {
  source: () => string;
  range: () => { text: string; mapping: TextMapping };
  change: (patch: Patch, anchor: number, head: number) => void;
  select: (anchor: number, head: number) => void;
  command: (id: string) => void;
  key?: (event: KeyboardEvent) => boolean;
  composition: (active: boolean) => void;
  failure: (text: string, error: unknown) => void;
  label: string;
}
export class LiteralEditor {
  readonly view: EditorView;
  private updating = false;
  private composing = false;
  private baseline: string;
  private notifying = false;
  private disposed = false;
  private readonly defaultEnding: string;
  constructor(
    parent: HTMLElement,
    private options: LiteralOptions,
  ) {
    this.baseline = options.range().text;
    this.defaultEnding = newlineAt(options.source(), 0);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.baseline,
        extensions: [
          EditorView.contentAttributes.of({ "aria-label": options.label }),
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-z",
              run: () => {
                options.command("undo");
                return true;
              },
            },
            {
              key: "Mod-Shift-z",
              run: () => {
                options.command("redo");
                return true;
              },
            },
            {
              key: "Tab",
              run: (view) => {
                const s = view.state.selection.main;
                view.dispatch({
                  changes: { from: s.from, to: s.to, insert: "  " },
                  selection: { anchor: s.from + 2 },
                });
                return true;
              },
            },
            {
              key: "Enter",
              run: (view) => {
                const s = view.state.selection.main;
                view.dispatch({
                  changes: { from: s.from, to: s.to, insert: "\n" },
                  selection: { anchor: s.from + 1 },
                });
                return true;
              },
            },
            ...defaultKeymap,
          ]),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (event) => options.key?.(event) ?? false,
              compositionstart: () => {
                this.composing = true;
                options.composition(true);
                return false;
              },
              compositionend: () => {
                this.composing = false;
                queueMicrotask(() => {
                  this.commit();
                  options.composition(false);
                });
                return false;
              },
            }),
          ),
          EditorView.updateListener.of((update) => {
            if (this.updating) return;
            if (update.docChanged && !this.composing) this.commit();
            else if (update.selectionSet && !this.composing) {
              const m = options.range().mapping,
                s = update.state.selection.main;
              options.select(
                mapTextToSource(m, s.anchor),
                mapTextToSource(m, s.head),
              );
            }
          }),
        ],
      }),
    });
  }
  private commit(): void {
    if (this.updating || this.composing) return;
    const text = this.view.state.doc.toString();
    if (text === this.baseline) return;
    const range = this.options.range();
    const diff = minimalPatch(this.baseline, text);
    const from = mapTextToSource(range.mapping, diff.from),
      to = mapTextToSource(range.mapping, diff.to, "before");
    const insert = diff.insert.replace(
      /\n/g,
      /[\r\n]/.test(this.options.source())
        ? newlineAt(this.options.source(), from)
        : this.defaultEnding,
    );
    const newSource =
      this.options.source().slice(0, from) +
      insert +
      this.options.source().slice(to);
    const delta = insert.length - (to - from);
    const start = range.mapping.from;
    const newRange = mapText(
      newSource.slice(start, range.mapping.to + delta),
      start,
    );
    const sel = this.view.state.selection.main;
    try {
      this.baseline = text;
      this.notifying = true;
      this.options.change(
        { from, to, insert },
        mapTextToSource(newRange.mapping, sel.anchor),
        mapTextToSource(newRange.mapping, sel.head),
      );
    } catch (error) {
      this.options.failure(text, error);
    } finally {
      this.notifying = false;
    }
  }
  refresh(anchor?: number, head = anchor): void {
    if (this.composing || this.disposed) return;
    if (this.notifying) {
      queueMicrotask(() => this.refresh(anchor, head));
      return;
    }
    const range = this.options.range();
    this.updating = true;
    try {
      if (range.text !== this.view.state.doc.toString())
        this.view.dispatch({
          changes: {
            from: 0,
            to: this.view.state.doc.length,
            insert: range.text,
          },
        });
      this.baseline = range.text;
      if (anchor !== undefined && head !== undefined)
        this.view.dispatch({
          selection: EditorSelection.single(
            mapSourceToText(range.mapping, anchor),
            mapSourceToText(range.mapping, head),
          ),
        });
    } finally {
      this.updating = false;
    }
  }
  focus(): void {
    this.view.focus();
  }
  destroy(): void {
    this.disposed = true;
    this.view.destroy();
  }
}
