import {
  EditorState,
  TextSelection,
  NodeSelection,
  type Transaction,
} from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { DocumentSession } from "../core/document";
import type {
  LogicalSelection,
  Patch,
  Owner,
  SourceRange,
} from "../core/types";
import { collectRevealRanges } from "./inline-presentation";
import { buildProjection } from "../syntax/projection";
import { mapText, mapTextToSource } from "../syntax/mapping";
import { RichProjection, schema } from "./projection";
import { LiteralEditor } from "./literal";
import {
  logical,
  minimalPatch,
  enterIntent,
  backspaceIntent,
  replaceIntent,
  newlineAt,
  type Intent,
} from "./editing";
import {
  expandLiteralSelection,
  indentIntent,
  clipboardRange,
  tableClipboard,
  tableContext,
  cellOffset,
  literalPatch,
  virtualCellIntent,
  mapOffset,
} from "./commands";
import { plainMarkdown, clipboardHTML } from "./clipboard";
import { assetURL } from "../render/document";
import { LiveMath } from "../render/live";
import { recoverProseSource } from "./recovery";
export interface SurfaceOptions {
  session: DocumentSession;
  apply: (intent: Intent, group?: string) => void;
  command: (id: string) => void;
  composition: (active: boolean) => void;
  recover: (
    content: string,
    format: "text" | "prosemirror-json",
    reason: string,
    recoverySource?: string,
  ) => void;
  notice: (text: string) => void;
  image?: (file: File) => void;
}
export class RichSurface {
  readonly view: EditorView;
  projection: RichProjection;
  private composing = false;
  private committingComposition = false;
  private rendering = false;
  private pointerDown = false;
  private deferred = false;
  private releasePointer = (): void => {
    if (!this.pointerDown) return;
    this.pointerDown = false;
    queueMicrotask(() => {
      this.captureSelection();
      if (this.deferred) {
        this.deferred = false;
        this.refresh();
      }
      this.updatePresentation();
    });
  };
  private literals = new Map<string, LiteralEditor>();
  private copyMode: "markdown" | "plain" | "rich" = "markdown";
  private pasting = false;
  private mathBookmarks = new Map<string, { anchor: number; head: number }>();
  constructor(
    parent: HTMLElement,
    readonly options: SurfaceOptions,
  ) {
    this.projection = new RichProjection(options.session.source);
    this.view = new EditorView(parent, {
      state: EditorState.create({ schema, doc: this.projection.doc }),
      attributes: {
        "aria-label": "正文编辑器",
        role: "textbox",
        "aria-multiline": "true",
      },
      dispatchTransaction: (tr) => this.dispatch(tr),
      handleKeyDown: (_, e) => this.key(e),
      handlePaste: (_, event) => {
        this.captureSelection();
        const data = event.clipboardData;
        if (!data) return false;
        const text =
          data.getData("text/markdown") || data.getData("text/plain");
        if (text) {
          event.preventDefault();
          this.pasting = true;
          try {
            this.replace(text);
          } finally {
            this.pasting = false;
          }
          return true;
        }
        const file = [...data.files].find((f) => f.type.startsWith("image/"));
        if (file) {
          event.preventDefault();
          this.options.image?.(file);
          return true;
        }
        return false;
      },
      handleDrop: (view, event) => {
        if (this.composing) return false;
        const file = [...(event.dataTransfer?.files ?? [])].find((f) =>
          f.type.startsWith("image/"),
        );
        if (!file || !this.options.image) return false;
        event.preventDefault();
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        if (position !== undefined) {
          const offset = this.projection.sourceAt(position);
          this.options.session.setSelection(logical(offset));
        } else this.captureSelection();
        this.options.image(file);
        return true;
      },
      handleDOMEvents: {
        focus: () => {
          queueMicrotask(() => this.updatePresentation());
          return false;
        },
        blur: () => {
          queueMicrotask(() => this.updatePresentation());
          return false;
        },
        copy: (_, event) => this.clipboard(event as ClipboardEvent, false),
        cut: (_, event) => this.clipboard(event as ClipboardEvent, true),
        compositionstart: () => {
          this.composing = true;
          options.composition(true);
          return false;
        },
        compositionend: () => {
          this.composing = false;
          queueMicrotask(() => {
            this.committingComposition = true;
            this.commitView();
            this.committingComposition = false;
            options.composition(false);
            this.updatePresentation();
          });
          return false;
        },
        mousedown: () => {
          if (this.options.session.selection.kind === "cells") {
            const s = this.options.session.selection;
            this.options.session.setSelection(
              logical(s.anchor.offset, s.head.offset, s.owner),
            );
            this.paintCells();
          }
          this.pointerDown = true;
          return false;
        },
      },
      nodeViews: {
        literal: (node) => this.literalView(node),
        inline_math: (node) => this.inlineMathView(node),
        image: (node) => this.imageView(node),
      },
    });
    document.addEventListener("mouseup", this.releasePointer);
    window.addEventListener("blur", this.releasePointer);
    this.refresh();
  }
  private dispatch(tr: Transaction): void {
    this.view.updateState(this.view.state.apply(tr));
    if (this.rendering || this.composing) return;
    if (tr.docChanged) this.commitView();
    else if (tr.selectionSet) {
      const s = this.view.state.selection;
      if (s instanceof NodeSelection) {
        const record = [...this.projection.records.values()].find(
          (r) => r.pos === s.from,
        );
        if (record)
          this.options.session.setSelection({
            ...logical(record.node.from, record.node.to),
            kind: "node",
          });
      } else {
        const anchor = this.projection.sourceAt(s.anchor),
          head = this.projection.sourceAt(s.head),
          safe = this.selectionAt(anchor, head, s.head);
        this.options.session.setSelection(safe);
        if (safe.anchor.offset !== anchor || safe.head.offset !== head)
          this.refresh();
        else this.updatePresentation();
      }
    }
  }
  private updatePresentation(): void {
    if (this.composing || this.rendering || this.view.isDestroyed) return;
    const ranges = this.view.hasFocus()
      ? collectRevealRanges(
          this.projection.projection,
          this.options.session.selection,
        )
      : [];
    if (
      JSON.stringify(ranges) !== JSON.stringify(this.projection.revealRanges) ||
      (!this.view.hasFocus() &&
        [...this.projection.records.values()].some(
          (r) => r.node.attributes.pendingHeading,
        ))
    )
      this.refresh();
  }
  private selectionRange(selection: LogicalSelection): SourceRange {
    const from = Math.min(selection.anchor.offset, selection.head.offset),
      to = Math.max(selection.anchor.offset, selection.head.offset);
    if (this.projection.markerRanges.some((r) => from < r.to && to > r.from))
      return { from, to };
    return clipboardRange(this.options.session.source, selection);
  }
  private commitView(): void {
    if (this.composing || this.rendering) return;
    const old = this.projection.doc,
      next = this.view.state.doc,
      start = old.content.findDiffStart(next.content);
    if (start === null) return;
    const end = old.content.findDiffEnd(next.content);
    if (!end) return;
    let oldEnd = end.a,
      newEnd = end.b;
    if (oldEnd < start) {
      const shift = start - oldEnd;
      oldEnd += shift;
      newEnd += shift;
    }
    try {
      const $a = old.resolve(start),
        $b = old.resolve(oldEnd);
      if (!$a.sameParent($b) || !$a.parent.isTextblock)
        throw Error("该结构变化需要源码恢复");
      const slice = next.slice(start, newEnd);
      let insert = "";
      slice.content.forEach((n) => {
        if (!n.isText) throw Error("尚未注册的结构输入");
        insert += n.text ?? "";
      });
      let from = this.projection.sourceAt(start),
        to = this.projection.sourceAt(oldEnd, "before");
      const bookmark = this.options.session.selection;
      if (
        start === oldEnd &&
        bookmark.anchor.offset === bookmark.head.offset &&
        this.projection.positionAt(bookmark.head.offset) === start
      )
        from = to = bookmark.head.offset;
      const record = [...this.projection.records.values()].find(
        (r) => r.pos === start - $a.parentOffset - 1,
      );
      if (record?.node.type === "tableCell")
        insert = insert
          .replace(/\\/g, "\\\\")
          .replace(/\|/g, "\\|")
          .replace(/[\r\n\t]+/g, " ");
      insert = insert.replace(
        /\n/g,
        newlineAt(this.options.session.source, from),
      );
      const intent = replaceIntent(
        from,
        to,
        insert,
        this.selectionAt(from).owner,
      );
      this.options.apply(
        record?.node.attributes.virtual
          ? virtualCellIntent(record.node, insert, this.cellOwner(record.node))
          : intent,
        this.committingComposition ? undefined : "typing",
      );
    } catch (error) {
      this.options.recover(
        JSON.stringify(next.toJSON()),
        "prosemirror-json",
        String(error),
        recoverProseSource(this.projection, next),
      );
    }
  }
  private literalView(initial: PMNode): NodeView {
    let node = initial;
    const id = String(node.attrs.id);
    const dom = document.createElement("section");
    dom.className = "literal";
    dom.dataset.kind = String(node.attrs.kind);
    dom.contentEditable = "false";
    const label = document.createElement("div");
    label.className = "literal-label";
    const updateLabel = () => {
      label.textContent =
        node.attrs.kind === "math"
          ? "公式源码"
          : node.attrs.kind === "raw"
            ? "原始 Markdown"
            : String(node.attrs.language || "代码");
      label.title =
        node.attrs.kind === "code"
          ? "修改代码语言"
          : node.attrs.kind === "math"
            ? "编辑公式源码"
            : "编辑原始 Markdown";
    };
    updateLabel();
    dom.append(label);
    label.tabIndex = 0;
    label.setAttribute("role", "button");
    const preview = document.createElement("button");
    preview.className = "math-preview";
    preview.type = "button";
    preview.setAttribute("aria-label", "编辑公式源码");
    if (node.attrs.kind === "math") {
      dom.append(preview);
    }
    // Folding is presentation state only. The CodeMirror instance and its mapped
    // selection survive blur, render completion and re-entry.
    let editingMath = false;
    let disposed = false;
    const showMathSource = () => {
      editingMath = true;
      editor.view.dom.hidden = false;
      label.hidden = false;
    };
    const syncMathSource = () => {
      if (!math || disposed || this.composing) return;
      const valid =
        Boolean(getRecord()?.node.attributes.closed) &&
        String(node.attrs.text).trim().length > 0 &&
        preview.dataset.renderState === "ready" &&
        !preview.querySelector(".math-error");
      const hide = valid && !editingMath;
      if (editor.view.dom.hidden === hide) return;
      // Preserve the visible reading anchor when content above it contracts.
      const selectionNode = window.getSelection()?.focusNode;
      const selectedElement =
        selectionNode?.nodeType === 1
          ? (selectionNode as Element)
          : selectionNode?.parentElement;
      const anchor =
        selectedElement?.closest("p,h1,h2,h3,h4,h5,h6,li,td,th") ?? preview;
      const top = anchor.getBoundingClientRect().top;
      const wasVisible = top >= 0 && top < window.innerHeight;
      editor.view.dom.hidden = hide;
      label.hidden = hide;
      if (wasVisible && window.scrollY > 0)
        window.scrollBy(0, anchor.getBoundingClientRect().top - top);
    };
    const getRecord = () => this.projection.records.get(String(node.attrs.id));
    const math =
      node.attrs.kind === "math"
        ? new LiveMath(
            preview,
            () => {
              const r = getRecord();
              return r
                ? {
                    key: r.id,
                    text: String(node.attrs.text),
                    revision: this.options.session.revision,
                  }
                : null;
            },
            true,
            syncMathSource,
          )
        : undefined;
    const owner = (): Owner => ({
      kind: node.attrs.kind === "math" ? "math" : "code",
      nodeId: String(node.attrs.id),
    });
    const editor = new LiteralEditor(dom, {
      label: node.attrs.kind === "math" ? "公式源码" : "代码源码",
      language: () =>
        node.attrs.kind === "code" ? String(node.attrs.language ?? "") : "",
      activate: () => {
        if (math) showMathSource();
      },
      source: () => this.options.session.source,
      range: () => {
        const r = getRecord();
        return r
          ? { text: r.node.text ?? r.node.raw, mapping: r.node.mapping }
          : mapText("", 0);
      },
      change: () => {},
      editText: (text, anchor, head, origin) => {
        const r = getRecord();
        if (!r) return;
        const intent = literalPatch(
          this.options.session.source,
          r.node,
          text,
          anchor,
          head,
          owner(),
        );
        this.options.apply(
          intent,
          origin === "typing" ? "literal-typing" : undefined,
        );
      },
      select: (anchor, head) => {
        this.mathBookmarks.set(id, { anchor, head });
        this.options.session.setSelection(logical(anchor, head, owner()));
      },
      command: this.options.command,
      composition: (active) => {
        this.composing = active;
        if (!active) this.refresh();
        this.options.composition(active);
        if (!active) syncMathSource();
      },
      failure: (text, error) => {
        const r = getRecord();
        const candidate = r
          ? this.options.session.source.slice(0, r.node.mapping.from) +
            text +
            this.options.session.source.slice(r.node.mapping.to)
          : this.options.session.source;
        this.options.recover(text, "text", String(error), candidate);
      },
      key: (event) => {
        if (event.isComposing || this.composing) return false;
        const r = getRecord();
        if (!r) return false;
        const s = editor.view.state.selection.main;
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          if (!s.empty || s.head !== editor.view.state.doc.length) return true;
          if (!r.node.attributes.closed) {
            this.options.notice("请先在源码模式闭合围栏");
            return true;
          }
          const eol = newlineAt(this.options.session.source, r.node.to);
          this.options.apply(replaceIntent(r.node.to, r.node.to, eol + eol));
          this.focus();
          return true;
        }
        if (
          event.key === "Backspace" &&
          s.empty &&
          s.head === 0 &&
          /^\n?$/.test(editor.view.state.doc.toString())
        ) {
          event.preventDefault();
          this.options.apply(replaceIntent(r.node.from, r.node.to, ""));
          this.focus();
          return true;
        }
        if (
          ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
            event.key,
          )
        ) {
          const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
          if (
            s.empty &&
            s.head === (backward ? 0 : editor.view.state.doc.length)
          ) {
            event.preventDefault();
            this.leaveLiteral(
              r.pos,
              r.node.from,
              r.node.to,
              backward,
              event.shiftKey,
            );
            return true;
          }
        }
        return false;
      },
    });
    if (math) {
      // Put the stable preview before the collapsible editing controls.
      dom.insertBefore(preview, label);
      dom.addEventListener("focusin", (event) => {
        if (editor.view.dom.contains(event.target as globalThis.Node))
          showMathSource();
      });
      dom.addEventListener("focusout", () => {
        // Pointer default handling installs the destination selection after
        // focusout. Wait one frame so contraction anchors that destination.
        requestAnimationFrame(() => {
          if (disposed) return;
          editingMath = dom.contains(document.activeElement);
          syncMathSource();
        });
      });
    }
    preview.onclick = () => {
      const r = getRecord();
      if (!r) return;
      const saved = this.mathBookmarks.get(id);
      const at = saved?.head ?? mapTextToSource(r.node.mapping, 0);
      this.options.session.setSelection(
        logical(saved?.anchor ?? at, at, owner()),
      );
      showMathSource();
      editor.refresh(saved?.anchor ?? at, at);
      editor.focus();
    };
    label.onpointerdown = (e) => e.preventDefault();
    label.onclick = () => {
      const r = getRecord();
      if (!r) return;
      const s = editor.view.state.selection.main;
      this.options.session.setSelection(
        logical(
          mapTextToSource(r.node.mapping, s.anchor),
          mapTextToSource(r.node.mapping, s.head),
          owner(),
        ),
      );
      if (node.attrs.kind === "code") this.options.command("codeLanguage");
      else editor.focus();
    };
    label.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        label.click();
      }
    };
    this.literals.set(id, editor);
    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update: (next) => {
        if (next.type !== node.type || next.attrs.id !== node.attrs.id)
          return false;
        node = next;
        updateLabel();
        math?.update();
        editor.refresh();
        syncMathSource();
        return true;
      },
      destroy: () => {
        disposed = true;
        math?.destroy();
        this.literals.delete(id);
        editor.destroy();
      },
      selectNode: () => {
        editor.focus();
      },
    };
  }
  captureSelection(): void {
    if (this.options.session.selection.kind === "cells") return;
    const dom = window.getSelection();
    if (
      !dom?.anchorNode ||
      !dom.focusNode ||
      !this.view.dom.contains(dom.anchorNode) ||
      !this.view.dom.contains(dom.focusNode)
    )
      return;
    const literalDOM = (node: globalThis.Node): Element | null =>
      (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest(
        ".literal",
      ) ?? null;
    const aLiteral = literalDOM(dom.anchorNode),
      hLiteral = literalDOM(dom.focusNode);
    if (aLiteral && aLiteral === hLiteral) return;
    if (aLiteral || hLiteral) {
      const a = this.view.posAtDOM(dom.anchorNode, dom.anchorOffset),
        h = this.view.posAtDOM(dom.focusNode, dom.focusOffset),
        forward = a < h;
      const record = (element: Element | null) =>
        [...this.projection.records.values()].find(
          (r) => element && this.view.nodeDOM(r.pos) === element,
        );
      const ar = record(aLiteral),
        hr = record(hLiteral);
      this.options.session.setSelection(
        this.selectionAt(
          ar
            ? forward
              ? ar.node.from
              : ar.node.to
            : this.projection.sourceAt(a),
          hr
            ? forward
              ? hr.node.to
              : hr.node.from
            : this.projection.sourceAt(h),
        ),
      );
      this.refresh();
      this.view.focus();
      return;
    }
    const anchor = this.view.posAtDOM(dom.anchorNode, dom.anchorOffset),
      head = this.view.posAtDOM(dom.focusNode, dom.focusOffset),
      current = this.options.session.selection;
    if (
      (current.owner.kind === "cell"
        ? this.selectionPosition(current.anchor.offset, current.owner)
        : this.projection.positionAt(
            current.anchor.offset,
            current.anchor.offset < current.head.offset
              ? "before"
              : current.anchor.offset > current.head.offset
                ? "after"
                : undefined,
          )) === anchor &&
      (current.owner.kind === "cell"
        ? this.selectionPosition(current.head.offset, current.owner)
        : this.projection.positionAt(
            current.head.offset,
            current.anchor.offset < current.head.offset
              ? "after"
              : current.anchor.offset > current.head.offset
                ? "before"
                : undefined,
          )) === head
    )
      return;
    this.options.session.setSelection(
      this.selectionAt(
        mapOffset(
          this.projection.sourceAt(anchor),
          this.projection.source === this.options.session.source
            ? []
            : [
                minimalPatch(
                  this.projection.source,
                  this.options.session.source,
                ),
              ],
        ),
        mapOffset(
          this.projection.sourceAt(head),
          this.projection.source === this.options.session.source
            ? []
            : [
                minimalPatch(
                  this.projection.source,
                  this.options.session.source,
                ),
              ],
        ),
        head,
      ),
    );
  }
  private key(event: KeyboardEvent): boolean {
    if (event.isComposing || this.composing) return false;
    this.captureSelection();
    const selection = this.options.session.selection;
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      selection.anchor.offset === selection.head.offset &&
      selection.owner.kind === "cell" &&
      tableContext(
        this.options.session.source,
        selection.head.offset,
        selection.owner,
      )?.cell.attributes.virtual
    ) {
      event.preventDefault();
      return true;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
      !event.shiftKey &&
      selection.anchor.offset !== selection.head.offset
    ) {
      event.preventDefault();
      const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp",
        at = backwards
          ? Math.min(selection.anchor.offset, selection.head.offset)
          : Math.max(selection.anchor.offset, selection.head.offset),
        literal = this.projection.literalAt(at);
      this.options.session.setSelection(
        logical(
          at,
          at,
          literal
            ? {
                kind: literal.node.type === "math" ? "math" : "code",
                nodeId: literal.id,
              }
            : { kind: "prose" },
        ),
      );
      this.refresh();
      this.focus();
      return true;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
      selection.anchor.offset === selection.head.offset
    ) {
      const backwards = event.key === "ArrowLeft" || event.key === "ArrowUp",
        position = this.projection.positionAt(selection.head.offset);
      const literal = [...this.projection.records.values()].find(
        (r) =>
          ["code", "math", "raw"].includes(r.node.type) &&
          (backwards ? r.pos + 2 === position : r.pos === position + 1),
      );
      if (literal) {
        event.preventDefault();
        const at = backwards
          ? literal.node.mapping.to
          : literal.node.mapping.from;
        this.options.session.setSelection(
          event.shiftKey
            ? logical(selection.anchor.offset, at)
            : logical(at, at, {
                kind: literal.node.type === "math" ? "math" : "code",
                nodeId: literal.id,
              }),
        );
        this.refresh();
        this.focus();
        return true;
      }
    }

    if (
      selection.kind === "cells" &&
      event.shiftKey &&
      event.key.startsWith("Arrow")
    ) {
      event.preventDefault();
      this.extendCells(event.key);
      return true;
    }
    if (event.key === "Tab" || event.key === "Enter") {
      if (
        tableContext(
          this.options.session.source,
          selection.head.offset,
          selection.owner,
        )
      ) {
        event.preventDefault();
        if (event.key === "Enter" && event.shiftKey) {
          this.options.notice("单元格不支持换行");
          return true;
        }
        this.moveCell(event.key === "Tab" ? (event.shiftKey ? -1 : 1) : 0);
        return true;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const intent = indentIntent(
          this.options.session.source,
          selection,
          event.shiftKey ? -1 : 1,
        );
        if (intent) this.options.apply(intent);
        else this.options.notice("当前位置没有合法的列表缩进目标");
        return true;
      }
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      selection.anchor.offset !== selection.head.offset
    ) {
      event.preventDefault();
      const range = this.selectionRange(selection);
      this.options.apply(replaceIntent(range.from, range.to, ""));
      return true;
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      (event.altKey || event.metaKey)
    ) {
      event.preventDefault();
      const s = this.options.session.selection;
      const range = this.projection.deletionRange(
        s.head.offset,
        event.key === "Backspace",
        event.metaKey ? "line" : "word",
      );
      const safe = this.selectionRange(logical(range.from, range.to, s.owner));
      this.options.apply(replaceIntent(safe.from, safe.to, "", s.owner));
      return true;
    }
    if (
      event.key === "Enter" &&
      selection.anchor.offset === selection.head.offset
    ) {
      const opening = this.projection.literalAt(selection.head.offset);
      if (opening?.node.attributes.pendingOpening) {
        event.preventDefault();
        this.options.apply(
          replaceIntent(
            selection.head.offset,
            selection.head.offset,
            newlineAt(this.options.session.source, selection.head.offset),
            {
              kind: opening.node.type === "math" ? "math" : "code",
              nodeId: opening.id,
            },
          ),
        );
        this.focus();
        return true;
      }
    }
    if (event.key === "Enter" || event.key === "Backspace") {
      const s = this.options.session.selection;
      const intent =
        event.key === "Enter"
          ? enterIntent(
              this.options.session.source,
              s,
              this.projection.projection,
              event.shiftKey,
            )
          : backspaceIntent(
              this.options.session.source,
              s,
              this.projection.projection,
            );
      if (intent) {
        event.preventDefault();
        this.options.apply(intent);
        return true;
      }
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      const s = this.options.session.selection;
      const range = this.selectionRange(s);
      if (range.from !== range.to)
        this.options.apply(replaceIntent(range.from, range.to, ""));
      else {
        const range = this.projection.deletionRange(
          s.head.offset,
          event.key === "Backspace",
        );
        this.options.apply(replaceIntent(range.from, range.to, "", s.owner));
      }
      return true;
    }
    return false;
  }
  replace(text: string): void {
    this.captureSelection();
    const s = this.options.session.selection;
    const cell = tableContext(
      this.options.session.source,
      s.head.offset,
      s.owner,
    );
    if (
      cell &&
      tableContext(this.options.session.source, s.anchor.offset, s.owner)?.cell
        .from === cell.cell.from
    ) {
      text = text
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\\/g, "\\\\")
        .replace(/\|/g, "\\|");
      this.options.notice(
        "单元格粘贴按单行文本插入；原始 Markdown 请使用源码模式",
      );
    }
    const range = this.selectionRange(s);
    if (cell?.cell.attributes.virtual) {
      this.options.apply(virtualCellIntent(cell.cell, text, s.owner));
      return;
    }
    this.options.apply(
      replaceIntent(
        range.from,
        range.to,
        text,
        cell ? this.selectionAt(s.head.offset).owner : s.owner,
      ),
    );
  }
  private cellOwner(
    node: import("../syntax/projection").ProjectionNode,
  ): Owner {
    const row = [...this.projection.records.values()].find(
      (r) => r.node.type === "tableRow" && r.node.children.includes(node),
    );
    return {
      kind: "cell",
      tableId: row?.parentId ?? "",
      row: Number(node.attributes.row),
      column: Number(node.attributes.column),
    };
  }
  private selectionPosition(offset: number, owner: Owner): number {
    if (owner.kind === "cell") {
      const cell = [...this.projection.records.values()].find(
        (r) =>
          r.node.type === "tableCell" &&
          r.node.attributes.virtual &&
          r.node.attributes.row === owner.row &&
          r.node.attributes.column === owner.column &&
          this.projection.records.get(r.parentId)?.parentId === owner.tableId,
      );
      if (cell) return cell.pos + 1;
    }
    return this.projection.positionAt(offset);
  }
  private selectionAt(
    anchor: number,
    head = anchor,
    position?: number,
  ): LogicalSelection {
    if (position !== undefined) {
      const cell = [...this.projection.records.values()].find(
        (r) =>
          r.node.type === "tableCell" &&
          r.pos < position &&
          r.pos + this.projection.doc.nodeAt(r.pos)!.nodeSize > position,
      );
      if (cell?.node.attributes.virtual && anchor === head)
        return logical(anchor, head, this.cellOwner(cell.node));
    }
    const c = tableContext(this.options.session.source, head),
      a = tableContext(this.options.session.source, anchor);
    if (c && a?.table.from === c.table.from && a.cell.from === c.cell.from) {
      const table = [...this.projection.records.values()].find(
        (r) => r.node.type === "table" && r.node.from === c.table.from,
      );
      return logical(anchor, head, {
        kind: "cell",
        tableId: table?.id ?? "",
        row: c.row,
        column: c.column,
      });
    }
    return expandLiteralSelection(
      this.options.session.source,
      logical(anchor, head),
    );
  }
  private clipboard(event: ClipboardEvent, cut: boolean): boolean {
    if (this.composing || !event.clipboardData) return false;
    this.captureSelection();
    const s = this.options.session.selection;
    const range = this.selectionRange(s);
    const cells =
      s.kind === "cells" && s.cellRange
        ? tableClipboard(
            this.options.session.source,
            s.cellRange,
            s.head.offset,
          )
        : null;
    const markdown =
      cells?.markdown ??
      this.options.session.source.slice(range.from, range.to);
    if (!markdown && !cells) return false;
    const plain =
      cells?.text ?? plainMarkdown(markdown, this.options.session.source);
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      this.copyMode === "plain" || cells ? plain : markdown,
    );
    event.clipboardData.setData("text/markdown", markdown);
    if (this.copyMode === "rich")
      event.clipboardData.setData(
        "text/html",
        clipboardHTML(markdown, this.options.session.source),
      );
    this.copyMode = "markdown";
    if (cut) {
      if (cells && s.cellRange) {
        const c = tableContext(
          this.options.session.source,
          s.head.offset,
          s.owner,
        )!;
        const patches: Patch[] = [];
        for (
          let row = Math.min(s.cellRange.fromRow, s.cellRange.toRow);
          row <= Math.max(s.cellRange.fromRow, s.cellRange.toRow);
          row++
        )
          for (
            let col = Math.min(s.cellRange.fromColumn, s.cellRange.toColumn);
            col <= Math.max(s.cellRange.fromColumn, s.cellRange.toColumn);
            col++
          ) {
            const cell = c.table.children[row]?.children[col];
            if (cell) {
              const a = cell.children[0]?.from ?? cellOffset(cell),
                b = cell.children.at(-1)?.to ?? a;
              if (a !== b) patches.push({ from: a, to: b, insert: "" });
            }
          }
        this.options.apply({
          patches,
          selection: logical(
            Math.min(...patches.map((p) => p.from), s.head.offset),
          ),
        });
      } else this.options.apply(replaceIntent(range.from, range.to, ""));
    }
    return true;
  }
  copy(mode: "plain" | "rich" | "markdown"): void {
    const s = this.options.session.selection;
    if (s.owner.kind === "code" || s.owner.kind === "math") {
      const r = this.projection.literalAt(s.head.offset, s.owner.kind);
      if (r && !this.literals.get(r.id)?.copy(mode))
        this.options.notice("拷贝未完成，请使用系统拷贝快捷键");
      return;
    }
    this.copyMode = mode;
    this.view.focus();
    if (!document.execCommand("copy")) {
      this.copyMode = "markdown";
      this.options.notice("拷贝未完成，请使用系统拷贝快捷键");
    }
  }
  selectCells(): void {
    this.captureSelection();
    const s = this.options.session.selection,
      c = tableContext(this.options.session.source, s.head.offset, s.owner);
    if (!c) return;
    this.options.session.setSelection({
      ...logical(
        cellOffset(c.cell),
        cellOffset(c.cell),
        s.owner.kind === "cell"
          ? s.owner
          : this.selectionAt(cellOffset(c.cell)).owner,
      ),
      kind: "cells",
      cellRange: {
        fromRow: c.row,
        toRow: c.row,
        fromColumn: c.column,
        toColumn: c.column,
      },
    });
    this.paintCells();
    this.view.focus();
  }
  private extendCells(key: string): void {
    const s = this.options.session.selection,
      c = tableContext(this.options.session.source, s.head.offset, s.owner);
    if (!s.cellRange || !c) return;
    const range = { ...s.cellRange };
    if (key === "ArrowDown")
      range.toRow = Math.min(c.table.children.length - 1, range.toRow + 1);
    if (key === "ArrowUp") range.toRow = Math.max(0, range.toRow - 1);
    if (key === "ArrowRight")
      range.toColumn = Math.min(
        c.table.children[0]!.children.length - 1,
        range.toColumn + 1,
      );
    if (key === "ArrowLeft") range.toColumn = Math.max(0, range.toColumn - 1);
    this.options.session.setSelection({ ...s, cellRange: range });
    this.paintCells();
  }
  private paintCells(): void {
    this.view.dom
      .querySelectorAll(".selected-cell")
      .forEach((e) => e.classList.remove("selected-cell"));
    const s = this.options.session.selection;
    if (!s.cellRange) return;
    const c = tableContext(this.options.session.source, s.head.offset, s.owner);
    if (!c) return;
    const record = [...this.projection.records.values()].find(
      (r) => r.node.type === "table" && r.node.from === c.table.from,
    );
    const dom = record ? (this.view.nodeDOM(record.pos) as HTMLElement) : null;
    dom?.querySelectorAll("tr").forEach((row, r) =>
      row.querySelectorAll("th,td").forEach((cell, col) => {
        if (
          r >= Math.min(s.cellRange!.fromRow, s.cellRange!.toRow) &&
          r <= Math.max(s.cellRange!.fromRow, s.cellRange!.toRow) &&
          col >= Math.min(s.cellRange!.fromColumn, s.cellRange!.toColumn) &&
          col <= Math.max(s.cellRange!.fromColumn, s.cellRange!.toColumn)
        )
          cell.classList.add("selected-cell");
      }),
    );
  }
  private moveCell(delta: number): void {
    const s = this.options.session.selection,
      c = tableContext(this.options.session.source, s.head.offset, s.owner);
    if (!c) return;
    const columns = c.table.children[0]!.children.length,
      index = c.row * columns + c.column + (delta || columns),
      row = Math.floor(index / columns),
      column = (index + columns) % columns;
    const cell = c.table.children[row]?.children[column];
    if (cell) {
      this.options.session.setSelection(
        logical(cellOffset(cell), cellOffset(cell), {
          kind: "cell",
          tableId: s.owner.kind === "cell" ? s.owner.tableId : "",
          row,
          column,
        }),
      );
      this.refresh();
      this.view.focus();
      return;
    }
    const before = index < 0;
    const blocks = this.projection.projection.blocks;
    const i = blocks.findIndex(
      (b) => b.type === "table" && b.from === c.table.from,
    );
    const adjacent = blocks[i + (before ? -1 : 1)];
    if (adjacent && ["paragraph", "heading", "gap"].includes(adjacent.type)) {
      const at = before ? adjacent.to : adjacent.from;
      this.options.session.setSelection(logical(at));
      this.refresh();
      this.focus();
    } else {
      const at = before ? c.table.from : c.table.to,
        eol = newlineAt(this.options.session.source, at);
      const intent = replaceIntent(at, at, eol + eol);
      if (before) intent.selection = logical(at);
      this.options.apply(intent);
      this.focus();
    }
  }
  private leaveLiteral(
    pos: number,
    from: number,
    to: number,
    backward: boolean,
    extend: boolean,
  ): void {
    if (backward ? pos === 0 : pos + 1 === this.projection.doc.content.size)
      return;
    const target = backward
      ? Math.max(0, pos - 1)
      : Math.min(this.projection.doc.content.size, pos + 1);
    const neighbor = [...this.projection.records.values()].find(
      (r) => ["code", "math", "raw"].includes(r.node.type) && r.pos === target,
    );
    const at = neighbor
      ? backward
        ? neighbor.node.mapping.to
        : neighbor.node.mapping.from
      : this.projection.sourceAt(target, backward ? "before" : "after");
    const anchor = extend ? (backward ? to : from) : at;
    this.options.session.setSelection(
      logical(
        anchor,
        at,
        !extend && neighbor
          ? {
              kind: neighbor.node.type === "math" ? "math" : "code",
              nodeId: neighbor.id,
            }
          : { kind: "prose" },
      ),
    );
    this.refresh();
    this.focus();
  }
  private inlineMathView(initial: PMNode): NodeView {
    let node = initial;
    const dom = document.createElement("span");
    dom.className = "inline-math";
    dom.contentEditable = "false";
    dom.tabIndex = 0;
    dom.setAttribute("role", "button");
    dom.setAttribute("aria-label", "编辑行内公式");
    const math = new LiveMath(dom, () => {
      const r = this.projection.records.get(String(node.attrs.id));
      return r
        ? {
            key: r.id,
            text: String(node.attrs.text),
            revision: this.options.session.revision,
          }
        : null;
    });
    const open = () => {
      const r = this.projection.records.get(String(node.attrs.id));
      if (r) {
        this.options.session.setSelection(
          logical(r.node.mapping.from, r.node.mapping.to),
        );
        this.options.command("inlineMathSource");
      }
    };
    dom.onclick = open;
    dom.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        open();
      }
    };
    return {
      dom,
      destroy: () => math.destroy(),
      stopEvent: () => true,
      ignoreMutation: () => true,
      update: (next) => {
        if (next.type !== node.type || next.attrs.id !== node.attrs.id)
          return false;
        node = next;
        math.update();
        return true;
      },
    };
  }
  private imageView(node: PMNode): NodeView {
    const dom = document.createElement("span"),
      url = assetURL(String(node.attrs.url));
    dom.className = "image-object";
    dom.contentEditable = "false";
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = String(node.attrs.alt);
      img.onerror = () => {
        dom.textContent = "[图片不可用：" + node.attrs.url + "]";
      };
      dom.append(img);
    } else dom.textContent = "[图片：" + node.attrs.url + "]";
    return { dom, ignoreMutation: () => true };
  }
  refresh(patch?: Patch | readonly Patch[]): void {
    if (this.composing) return;
    if (this.pointerDown) {
      this.deferred = true;
      return;
    }
    this.rendering = true;
    try {
      const previous = this.projection;
      if (previous.source !== this.options.session.source) {
        const changes: readonly Patch[] = patch
          ? Array.isArray(patch)
            ? patch
            : [patch as Patch]
          : [minimalPatch(previous.source, this.options.session.source)];
        for (const bookmark of this.mathBookmarks.values()) {
          bookmark.anchor = mapOffset(bookmark.anchor, changes);
          bookmark.head = mapOffset(bookmark.head, changes);
        }
      }
      this.projection = new RichProjection(
        this.options.session.source,
        previous,
        patch,
        !this.pasting &&
          this.view.hasFocus() &&
          this.options.session.selection.owner.kind === "prose"
          ? this.options.session.selection.head.offset
          : undefined,
        this.view.hasFocus()
          ? collectRevealRanges(
              // Patches can move, create or remove formatted spans.
              previous.source === this.options.session.source
                ? previous.projection
                : buildProjection(this.options.session.source),
              this.options.session.selection,
            )
          : [],
      );
      let s = this.options.session.selection;
      const literal = this.projection.literalAt(
        s.head.offset,
        s.owner.kind === "math"
          ? "math"
          : s.owner.kind === "code"
            ? "code"
            : undefined,
      );
      if (
        literal &&
        s.owner.kind === "source" &&
        this.projection.literalAt(s.anchor.offset)?.id === literal.id
      ) {
        s = {
          ...s,
          owner: {
            kind: literal.node.type === "math" ? "math" : "code",
            nodeId: literal.id,
          },
        };
        this.options.session.setSelection(s);
      }
      if (s.owner.kind === "source") s = { ...s, owner: { kind: "prose" } };
      const safe = expandLiteralSelection(this.options.session.source, s);
      if (safe !== this.options.session.selection) {
        s = safe;
        this.options.session.setSelection(s);
      }
      if (
        literal &&
        (s.owner.kind === "code" || s.owner.kind === "math") &&
        s.owner.nodeId !== literal.id
      ) {
        s = { ...s, owner: { ...s.owner, nodeId: literal.id } };
        this.options.session.setSelection(s);
      }
      if (literal && (s.owner.kind === "code" || s.owner.kind === "math")) {
        const clamp = (offset: number) =>
          Math.max(
            literal.node.mapping.from,
            Math.min(literal.node.mapping.to, offset),
          );
        if (
          clamp(s.anchor.offset) !== s.anchor.offset ||
          clamp(s.head.offset) !== s.head.offset
        ) {
          s = {
            ...s,
            anchor: { ...s.anchor, offset: clamp(s.anchor.offset) },
            head: { ...s.head, offset: clamp(s.head.offset) },
          };
          this.options.session.setSelection(s);
        }
      }
      if (s.owner.kind === "cell") {
        const context = tableContext(
          this.options.session.source,
          s.head.offset,
          s.owner,
        );
        const table = [...this.projection.records.values()].find(
          (r) => r.node.type === "table" && r.node.from === context?.table.from,
        );
        const current =
          context && table
            ? { ...s, owner: { ...s.owner, tableId: table.id } }
            : this.selectionAt(s.anchor.offset, s.head.offset);
        if (
          current.owner.kind === "cell" &&
          current.owner.tableId !== s.owner.tableId
        ) {
          s = { ...s, owner: current.owner };
          this.options.session.setSelection(s);
        }
      }
      let selection;
      if ((s.owner.kind === "code" || s.owner.kind === "math") && literal)
        selection = NodeSelection.create(this.projection.doc, literal.pos);
      else
        selection = TextSelection.create(
          this.projection.doc,
          s.owner.kind === "cell"
            ? this.selectionPosition(s.anchor.offset, s.owner)
            : this.projection.positionAt(
                s.anchor.offset,
                s.anchor.offset < s.head.offset
                  ? "before"
                  : s.anchor.offset > s.head.offset
                    ? "after"
                    : undefined,
              ),
          s.owner.kind === "cell"
            ? this.selectionPosition(s.head.offset, s.owner)
            : this.projection.positionAt(
                s.head.offset,
                s.anchor.offset < s.head.offset
                  ? "after"
                  : s.anchor.offset > s.head.offset
                    ? "before"
                    : undefined,
              ),
        );
      this.view.updateState(
        EditorState.create({ schema, doc: this.projection.doc, selection }),
      );
      if (literal && (s.owner.kind === "code" || s.owner.kind === "math"))
        this.literals.get(literal.id)?.refresh(s.anchor.offset, s.head.offset);
      const a = Math.min(s.anchor.offset, s.head.offset),
        b = Math.max(s.anchor.offset, s.head.offset);
      for (const r of this.projection.records.values())
        if (["code", "math"].includes(r.node.type))
          (this.view.nodeDOM(r.pos) as HTMLElement | null)?.classList.toggle(
            "selected-literal",
            s.owner.kind === "prose" &&
              a !== b &&
              a <= r.node.from &&
              b >= r.node.to,
          );
    } finally {
      this.rendering = false;
    }
  }
  viewportBookmark(): { offset: number; top: number } | null {
    const box = this.view.dom.getBoundingClientRect();
    const hit = this.view.posAtCoords({
      left: box.left + Math.min(30, box.width / 2),
      top: Math.max(box.top + 2, 8),
    });
    if (!hit) return null;
    const record = [...this.projection.records.values()].find(
      (r) =>
        ["code", "math", "raw"].includes(r.node.type) &&
        r.pos <= hit.pos &&
        r.pos + 1 >= hit.pos,
    );
    const offset = record
      ? record.node.mapping.from
      : this.projection.sourceAt(hit.pos);
    return { offset, top: this.coordinatesAt(offset)?.top ?? 0 };
  }
  coordinatesAt(offset: number): { top: number } | null {
    const record = this.projection.literalAt(offset);
    if (record)
      return this.literals.get(record.id)?.coordinatesAt(offset) ?? null;
    return this.view.coordsAtPos(this.projection.positionAt(offset));
  }
  focus(): void {
    const s = this.options.session.selection;
    if (s.owner.kind === "code" || s.owner.kind === "math") {
      const record = this.projection.literalAt(s.head.offset, s.owner.kind);
      if (record) {
        const literal = this.literals.get(record.id);
        literal?.refresh(s.anchor.offset, s.head.offset);
        literal?.focus();
        return;
      }
    }
    this.view.focus();
  }
  destroy(): void {
    document.removeEventListener("mouseup", this.releasePointer);
    window.removeEventListener("blur", this.releasePointer);
    this.view.destroy();
  }
}
