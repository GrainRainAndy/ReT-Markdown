import { defaultKeymap } from "@codemirror/commands";
import {
  EditorState,
  EditorSelection,
  Prec,
  Transaction,
  Compartment,
} from "@codemirror/state";
import { codeLanguage, codeHighlighting } from "./highlighting";
import { EditorView, keymap } from "@codemirror/view";
import {
  mapText,
  mapTextToSource,
  mapSourceToText,
  type TextMapping,
} from "../syntax/mapping";
import { minimalPatch, newlineAt } from "./editing";
import { plainMarkdown, clipboardHTML } from "./clipboard";
import { escapeHTML } from "../render/document";
import type { Patch } from "../core/types";
export type LiteralOrigin = "typing" | "composition" | "paste";
export interface LiteralOptions {
  source: () => string;
  range: () => { text: string; mapping: TextMapping };
  change: (
    patch: Patch,
    anchor: number,
    head: number,
    origin: LiteralOrigin,
  ) => void;
  editText?: (
    text: string,
    anchor: number,
    head: number,
    origin: LiteralOrigin,
  ) => void;
  select: (anchor: number, head: number) => void;
  command: (id: string) => void;
  key?: (event: KeyboardEvent) => boolean;
  composition: (active: boolean) => void;
  failure: (text: string, error: unknown) => void;
  label: string;
  markdown?: boolean;
  language?: () => string;
  activate?: () => void;
  image?: (file: File) => void;
}
export class LiteralEditor {
  readonly view: EditorView;
  private updating = false;
  private language = new Compartment();
  private languageName = "";
  private clipboardFailed = false;
  private copyMode: "markdown" | "plain" | "rich" | null = null;
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
    this.languageName = options.language?.() ?? "";
    this.defaultEnding = newlineAt(options.source(), 0);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.baseline,
        extensions: [
          this.language.of(codeLanguage(this.languageName)),
          codeHighlighting,
          EditorView.contentAttributes.of({ "aria-label": options.label }),
          EditorView.lineWrapping,
          keymap.of([
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
              drop: (event, view) => {
                if (this.composing || !options.markdown || !options.image)
                  return false;
                const file = [...(event.dataTransfer?.files ?? [])].find((f) =>
                  f.type.startsWith("image/"),
                );
                if (!file) return false;
                event.preventDefault();
                const at =
                  view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                  view.state.selection.main.head;
                view.dispatch({ selection: { anchor: at } });
                const sourceAt = mapTextToSource(options.range().mapping, at);
                options.select(sourceAt, sourceAt);
                options.image(file);
                return true;
              },
              paste: (event, view) => {
                if (this.composing) return false;
                const data = event.clipboardData;
                if (!data) return false;
                const markdown = data.getData("text/markdown");
                if (markdown) {
                  event.preventDefault();
                  view.dispatch({
                    ...view.state.replaceSelection(markdown),
                    annotations: Transaction.userEvent.of("input.paste"),
                  });
                  return true;
                }
                if (!data.getData("text/plain") && options.image) {
                  const image = [...data.files].find((f) =>
                    f.type.startsWith("image/"),
                  );
                  if (image) {
                    event.preventDefault();
                    options.image(image);
                    return true;
                  }
                }
                return false;
              },
              copy: (event, view) => {
                if (!this.copyMode || !event.clipboardData) return false;
                const mode = this.copyMode;
                this.copyMode = null;
                const s = view.state.selection.main,
                  text = view.state.sliceDoc(s.from, s.to);
                if (!text) return false;
                event.preventDefault();
                try {
                  event.clipboardData.setData(
                    "text/plain",
                    mode === "plain" && options.markdown
                      ? plainMarkdown(text, options.source())
                      : text,
                  );
                  event.clipboardData.setData("text/markdown", text);
                  if (mode === "rich")
                    event.clipboardData.setData(
                      "text/html",
                      options.markdown
                        ? clipboardHTML(text, options.source())
                        : "<pre><code>" + escapeHTML(text) + "</code></pre>",
                    );
                } catch {
                  this.clipboardFailed = true;
                }
                return true;
              },
              compositionstart: () => {
                this.composing = true;
                options.composition(true);
                return false;
              },
              compositionend: () => {
                this.composing = false;
                queueMicrotask(() => {
                  this.commit("composition");
                  options.composition(false);
                });
                return false;
              },
            }),
          ),
          EditorView.updateListener.of((update) => {
            if (this.updating) return;
            if (update.docChanged && !this.composing)
              this.commit(
                update.transactions.some((t) => t.isUserEvent("input.paste"))
                  ? "paste"
                  : "typing",
              );
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
  private commit(origin: LiteralOrigin = "typing"): void {
    if (this.updating || this.composing) return;
    const text = this.view.state.doc.toString();
    if (text === this.baseline) return;
    if (this.options.editText) {
      const selection = this.view.state.selection.main;
      try {
        this.notifying = true;
        this.options.editText(text, selection.anchor, selection.head, origin);
        this.baseline = text;
      } catch (error) {
        this.options.failure(text, error);
      } finally {
        this.notifying = false;
      }
      return;
    }
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
        origin,
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
      const languageName = this.options.language?.() ?? "";
      if (languageName !== this.languageName) {
        this.view.dispatch({
          effects: this.language.reconfigure(codeLanguage(languageName)),
        });
        this.languageName = languageName;
      }
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
  viewportBookmark(): { offset: number; top: number } | null {
    const box = this.view.contentDOM.getBoundingClientRect();
    const at = this.view.posAtCoords(
      { x: box.left + 10, y: Math.max(box.top + 2, 8) },
      false,
    );
    if (at === null) return null;
    const coords = this.view.coordsAtPos(at);
    return coords
      ? {
          offset: mapTextToSource(this.options.range().mapping, at),
          top: coords.top,
        }
      : null;
  }
  coordinatesAt(offset: number): { top: number } | null {
    return this.view.coordsAtPos(
      mapSourceToText(this.options.range().mapping, offset),
    );
  }
  revealOffset(offset: number): void {
    this.view.dispatch({
      effects: EditorView.scrollIntoView(
        mapSourceToText(this.options.range().mapping, offset),
        { y: "start", yMargin: 0 },
      ),
    });
  }
  copy(mode: "markdown" | "plain" | "rich"): boolean {
    this.copyMode = mode;
    this.clipboardFailed = false;
    this.focus();
    const copied = document.execCommand("copy");
    this.copyMode = null;
    return copied && !this.clipboardFailed;
  }
  focus(): void {
    this.options.activate?.();
    this.view.focus();
  }
  destroy(): void {
    this.disposed = true;
    this.view.destroy();
  }
}
