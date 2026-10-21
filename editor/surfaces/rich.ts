import {
  EditorState,
  TextSelection,
  NodeSelection,
  type Transaction,
} from "prosemirror-state";
import { EditorView, type NodeView } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import type { DocumentSession } from "../core/document";
import type { LogicalSelection, Patch, Owner } from "../core/types";
import { mapText, mapTextToSource } from "../syntax/mapping";
import { RichProjection, schema } from "./projection";
import { LiteralEditor } from "./literal";
import {
  logical,
  enterIntent,
  backspaceIntent,
  replaceIntent,
  newlineAt,
  type Intent,
} from "./editing";
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
}
export class RichSurface {
  readonly view: EditorView;
  projection: RichProjection;
  private composing = false;
  private rendering = false;
  private pointerDown = false;
  private deferred = false;
  private literals = new Map<string, LiteralEditor>();
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
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        this.replace(text);
        return true;
      },
      handleDOMEvents: {
        compositionstart: () => {
          this.composing = true;
          options.composition(true);
          return false;
        },
        compositionend: () => {
          this.composing = false;
          queueMicrotask(() => {
            this.commitView();
            options.composition(false);
          });
          return false;
        },
        mousedown: () => {
          this.pointerDown = true;
          return false;
        },
        mouseup: () => {
          this.pointerDown = false;
          queueMicrotask(() => {
            if (this.deferred) {
              this.deferred = false;
              this.refresh();
            }
          });
          return false;
        },
      },
      nodeViews: { literal: (node) => this.literalView(node) },
    });
    this.refresh();
  }
  private dispatch(tr: Transaction): void {
    this.view.updateState(this.view.state.apply(tr));
    if (this.rendering || this.composing) return;
    if (tr.docChanged) this.commitView();
    else if (tr.selectionSet) {
      const s = this.view.state.selection;
      this.options.session.setSelection(
        logical(
          this.projection.sourceAt(s.anchor),
          this.projection.sourceAt(s.head),
        ),
      );
    }
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
      const from = this.projection.sourceAt(start),
        to = this.projection.sourceAt(oldEnd, "before");
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
      this.options.apply(replaceIntent(from, to, insert), "typing");
    } catch (error) {
      this.options.recover(
        JSON.stringify(next.toJSON()),
        "prosemirror-json",
        String(error),
      );
    }
  }
  private literalView(initial: PMNode): NodeView {
    let node = initial;
    const id = String(node.attrs.id);
    const dom = document.createElement("section");
    dom.className = "literal";
    dom.contentEditable = "false";
    const label = document.createElement("div");
    label.className = "literal-label";
    label.textContent =
      node.attrs.kind === "math"
        ? "公式源码"
        : node.attrs.kind === "raw"
          ? "原始 Markdown"
          : String(node.attrs.language || "代码");
    dom.append(label);
    const getRecord = () => this.projection.records.get(String(node.attrs.id));
    const owner = (): Owner => ({
      kind: node.attrs.kind === "math" ? "math" : "code",
      nodeId: String(node.attrs.id),
    });
    const editor = new LiteralEditor(dom, {
      label: node.attrs.kind === "math" ? "公式源码" : "代码源码",
      source: () => this.options.session.source,
      range: () => {
        const r = getRecord();
        return r
          ? { text: r.node.text ?? r.node.raw, mapping: r.node.mapping }
          : mapText("", 0);
      },
      change: (patch, anchor, head) => {
        const r = getRecord();
        if (
          r?.node.attributes.closed &&
          patch.to === r.node.mapping.to &&
          !/[\r\n]$/.test(patch.insert)
        ) {
          patch = {
            ...patch,
            insert:
              patch.insert + newlineAt(this.options.session.source, patch.from),
          };
        }
        this.options.apply(
          { patches: [patch], selection: logical(anchor, head, owner()) },
          /[\r\n]/.test(patch.insert) ? undefined : "literal-typing",
        );
      },
      select: (anchor, head) =>
        this.options.session.setSelection(logical(anchor, head, owner())),
      command: this.options.command,
      composition: (active) => {
        this.composing = active;
        this.options.composition(active);
      },
      failure: (text, error) =>
        this.options.recover(text, "text", String(error)),
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
          !editor.view.state.doc.length
        ) {
          event.preventDefault();
          this.options.apply(replaceIntent(r.node.from, r.node.to, ""));
          this.focus();
          return true;
        }
        return false;
      },
    });
    this.literals.set(id, editor);
    return {
      dom,
      stopEvent: () => true,
      ignoreMutation: () => true,
      update: (next) => {
        if (next.type !== node.type || next.attrs.id !== node.attrs.id)
          return false;
        node = next;
        editor.refresh();
        return true;
      },
      destroy: () => {
        this.literals.delete(id);
        editor.destroy();
      },
      selectNode: () => {
        editor.focus();
      },
    };
  }
  private syncSelection(): void {
    const dom = window.getSelection();
    if (
      !dom?.anchorNode ||
      !dom.focusNode ||
      !this.view.dom.contains(dom.anchorNode) ||
      !this.view.dom.contains(dom.focusNode)
    )
      return;
    const anchor = this.view.posAtDOM(dom.anchorNode, dom.anchorOffset),
      head = this.view.posAtDOM(dom.focusNode, dom.focusOffset),
      current = this.options.session.selection;
    if (
      this.projection.positionAt(current.anchor.offset) === anchor &&
      this.projection.positionAt(current.head.offset) === head
    )
      return;
    this.options.session.setSelection(
      logical(this.projection.sourceAt(anchor), this.projection.sourceAt(head)),
    );
  }
  private key(event: KeyboardEvent): boolean {
    if (event.isComposing || this.composing) return false;
    this.syncSelection();
    const mod = event.metaKey || event.ctrlKey;
    if (mod) {
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        this.options.command(event.shiftKey ? "redo" : "undo");
        return true;
      }
      if (key === "b" || key === "i") {
        event.preventDefault();
        this.options.command(key === "b" ? "bold" : "italic");
        return true;
      }
      if (key === "a") return false;
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
    return false;
  }
  replace(text: string): void {
    const s = this.options.session.selection;
    this.options.apply(
      replaceIntent(
        Math.min(s.anchor.offset, s.head.offset),
        Math.max(s.anchor.offset, s.head.offset),
        text,
      ),
    );
  }
  refresh(patch?: Patch): void {
    if (this.composing) return;
    if (this.pointerDown) {
      this.deferred = true;
      return;
    }
    this.rendering = true;
    try {
      const previous = this.projection;
      this.projection = new RichProjection(
        this.options.session.source,
        previous,
        patch,
      );
      const s = this.options.session.selection;
      const literal = this.projection.literalAt(
        s.head.offset,
        s.owner.kind === "math"
          ? "math"
          : s.owner.kind === "code"
            ? "code"
            : undefined,
      );
      let selection;
      if ((s.owner.kind === "code" || s.owner.kind === "math") && literal)
        selection = NodeSelection.create(this.projection.doc, literal.pos);
      else
        selection = TextSelection.create(
          this.projection.doc,
          this.projection.positionAt(s.anchor.offset),
          this.projection.positionAt(s.head.offset),
        );
      this.view.updateState(
        EditorState.create({ schema, doc: this.projection.doc, selection }),
      );
      if (literal && (s.owner.kind === "code" || s.owner.kind === "math"))
        this.literals.get(literal.id)?.refresh(s.anchor.offset, s.head.offset);
    } finally {
      this.rendering = false;
    }
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
    this.view.destroy();
  }
}
