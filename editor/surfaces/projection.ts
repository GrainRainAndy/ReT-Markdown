import { Schema, type Node as PMNode, type Mark } from "prosemirror-model";
import {
  buildProjection,
  type ProjectionNode,
  type DocumentProjection,
} from "../syntax/projection";
import {
  mapSourceToText,
  mapTextToSource,
  mapText,
  type TextMapping,
} from "../syntax/mapping";
import { minimalPatch, containerContinuation } from "./editing";
import { mapOffset } from "./commands";
import type { Patch, SourceRange } from "../core/types";
export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: "" } },
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: "" }, depth: { default: 1 } },
      toDOM: (n) => ["h" + n.attrs.depth, 0],
    },
    blockquote: {
      group: "block",
      content: "block+",
      attrs: { id: { default: "" } },
      toDOM: () => ["blockquote", 0],
    },
    bullet_list: {
      group: "block",
      content: "list_item+",
      attrs: { id: { default: "" } },
      toDOM: () => ["ul", 0],
    },
    ordered_list: {
      group: "block",
      content: "list_item+",
      attrs: { id: { default: "" }, start: { default: 1 } },
      toDOM: (n) => ["ol", { start: n.attrs.start }, 0],
    },
    list_item: {
      content: "block+",
      attrs: { id: { default: "" }, checked: { default: null } },
      toDOM: (n) => ["li", { "data-checked": n.attrs.checked }, 0],
    },
    table: {
      group: "block",
      content: "table_row+",
      attrs: { id: { default: "" } },
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "table_cell+",
      attrs: { id: { default: "" } },
      toDOM: () => ["tr", 0],
    },
    table_cell: {
      content: "inline*",
      attrs: {
        id: { default: "" },
        header: { default: false },
        align: { default: null },
      },
      toDOM: (n) => [
        n.attrs.header ? "th" : "td",
        { style: n.attrs.align ? "text-align:" + n.attrs.align : "" },
        0,
      ],
    },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      toDOM: () => ["br"],
    },
    literal: {
      group: "block",
      atom: true,
      isolating: true,
      attrs: {
        id: { default: "" },
        kind: { default: "code" },
        text: { default: "" },
        language: { default: "" },
      },
      toDOM: (n) => [
        "pre",
        { "data-kind": n.attrs.kind },
        ["code", n.attrs.text],
      ],
    },
    inline_math: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: { id: { default: "" }, text: { default: "" } },
      toDOM: (n) => ["span", { class: "inline-math" }, n.attrs.text],
    },
    image: {
      inline: true,
      group: "inline",
      atom: true,
      attrs: {
        id: { default: "" },
        url: { default: "" },
        alt: { default: "" },
      },
      toDOM: (n) => [
        "span",
        { class: "image-placeholder" },
        "图片：" + n.attrs.alt,
      ],
    },
    rule: {
      group: "block",
      atom: true,
      attrs: { id: { default: "" } },
      toDOM: () => ["hr"],
    },
  },
  marks: {
    syntax: {
      inclusive: false,
      toDOM: () => ["span", { class: "syntax-marker" }, 0],
    },
    strong: {
      attrs: { revealed: { default: false } },
      toDOM: () => ["strong", 0],
    },
    em: { attrs: { revealed: { default: false } }, toDOM: () => ["em", 0] },
    strike: { attrs: { revealed: { default: false } }, toDOM: () => ["s", 0] },
    code: { attrs: { revealed: { default: false } }, toDOM: () => ["code", 0] },
    link: {
      attrs: { url: {}, revealed: { default: false } },
      toDOM: (n) => [
        "a",
        { "data-url": n.attrs.url, title: "⌘单击打开链接；单击编辑" },
        0,
      ],
    },
  },
});
interface Run {
  pos: number;
  length: number;
  mapping: TextMapping;
  node: ProjectionNode;
}
export interface BlockRecord {
  pos: number;
  node: ProjectionNode;
  id: string;
  parentId: string;
}
let nextID = 1;
export class RichProjection {
  readonly projection: DocumentProjection;
  readonly doc: PMNode;
  readonly runs: Run[] = [];
  readonly records = new Map<string, BlockRecord>();
  readonly replacements = new Map<string, string[]>();
  readonly markerRanges: SourceRange[] = [];
  constructor(
    readonly source: string,
    previous?: RichProjection,
    change?: Patch | readonly Patch[],
    proseOffset?: number,
    readonly revealRanges: readonly SourceRange[] = [],
  ) {
    this.projection = buildProjection(source);
    const used = new Set<string>();
    const patches: readonly Patch[] = change
      ? Array.isArray(change)
        ? change
        : [change as Patch]
      : previous
        ? [minimalPatch(previous.source, source)]
        : [];
    const mapped = (at: number, after = false) => mapOffset(at, patches, after);
    const idFor = (node: ProjectionNode, parentId: string): string => {
      const old =
        previous &&
        [...previous.records.values()].find(
          (r) =>
            !used.has(r.id) &&
            r.node.type === node.type &&
            r.parentId === parentId &&
            (mapped(r.node.from) === node.from ||
              (r.node.raw === node.raw &&
                mapped(r.node.from, true) === node.from)) &&
            (r.node.raw === node.raw ||
              patches.some((p) => r.node.from <= p.from && r.node.to >= p.to)),
        );
      const id = old?.id ?? `view-${nextID++}`;
      used.add(id);
      return id;
    };
    const inline = (
      nodes: ProjectionNode[],
      pos: number,
      marks: readonly Mark[] = [],
      parentId = "root",
    ): PMNode[] => {
      const result: PMNode[] = [];
      for (const n of nodes) {
        const start = pos;
        let made: PMNode[] = [];
        const revealed = revealRanges.some(
          (range) => range.from === n.from && range.to === n.to,
        );
        const marker = (from: number, to: number, at: number): PMNode[] => {
          if (from === to) return [];
          const raw = source.slice(from, to),
            mapped = mapText(raw, from);
          this.markerRanges.push({ from, to });
          this.runs.push({
            pos: at,
            length: mapped.text.length,
            mapping: mapped.mapping,
            node: { ...n, type: "syntax", text: mapped.text },
          });
          return [schema.text(mapped.text, [schema.marks.syntax!.create()])];
        };
        if (n.type === "text" || n.type === "raw" || n.type === "inlineCode") {
          const text = n.text ?? n.raw;
          if (text) {
            const ms =
              n.type === "inlineCode"
                ? [...marks, schema.marks.code!.create({ revealed })]
                : marks;
            const prefix =
              revealed && n.type === "inlineCode"
                ? marker(n.from, n.mapping.from, pos)
                : [];
            const prefixLength = prefix.reduce(
              (size, node) => size + node.nodeSize,
              0,
            );
            made = [
              ...prefix,
              schema.text(text, ms),
              ...(revealed && n.type === "inlineCode"
                ? marker(n.mapping.to, n.to, pos + prefixLength + text.length)
                : []),
            ];
            this.runs.push({
              pos: pos + prefixLength,
              length: text.length,
              mapping: n.mapping,
              node: n,
            });
          }
        } else if (
          ["strong", "emphasis", "delete", "link", "linkReference"].includes(
            n.type,
          )
        ) {
          const name = (
            {
              strong: "strong",
              emphasis: "em",
              delete: "strike",
              link: "link",
              linkReference: "link",
            } as Record<string, string>
          )[n.type]!;
          const prefix = revealed
            ? marker(n.from, n.children[0]?.from ?? n.to, pos)
            : [];
          const prefixLength = prefix.reduce(
            (size, node) => size + node.nodeSize,
            0,
          );
          const content = inline(n.children, pos + prefixLength, [
            ...marks,
            schema.marks[name]!.create({
              url: n.attributes.url ?? "",
              revealed,
            }),
          ]);
          made = [
            ...prefix,
            ...content,
            ...(revealed
              ? marker(
                  n.children.at(-1)?.to ?? n.to,
                  n.to,
                  pos +
                    prefixLength +
                    content.reduce((size, node) => size + node.nodeSize, 0),
                )
              : []),
          ];
        } else if (n.type === "break") {
          made = [schema.nodes.hard_break!.create()];
          this.runs.push({ pos, length: 1, mapping: n.mapping, node: n });
        } else if (
          n.type === "inlineMath" ||
          n.type === "image" ||
          n.type === "imageReference"
        ) {
          const id = idFor(n, parentId);
          this.records.set(id, { id, pos, node: n, parentId });
          made = [
            schema.nodes[
              n.type === "inlineMath" ? "inline_math" : "image"
            ]!.create(
              {
                id,
                text: n.text ?? n.raw,
                url: n.attributes.url ?? "",
                alt: n.attributes.alt ?? "",
              },
              null,
              marks,
            ),
          ];
          this.runs.push({
            pos,
            length: 1,
            mapping: {
              from: n.from,
              to: n.to,
              textLength: 1,
              segments: [{ from: n.from, to: n.to, textFrom: 0, textTo: 1 }],
            },
            node: n,
          });
        } else made = inline(n.children, pos, marks);
        for (const child of made) {
          result.push(child);
          pos += child.nodeSize;
        }
        if (!made.length && n.raw) {
          made = [schema.text(n.raw, marks)];
          result.push(...made);
          pos = start + n.raw.length;
          this.runs.push({
            pos: start,
            length: n.raw.length,
            mapping: n.mapping,
            node: n,
          });
        }
      }
      return result;
    };
    const block = (
      n: ProjectionNode,
      pos: number,
      header = false,
      align: unknown = null,
      parentId = "root",
    ): PMNode => {
      if (n.type === "code" && !n.attributes.fence) {
        const ending = /^(\r\n|\r|\n)/.exec(source.slice(n.to));
        if (ending) {
          const end = n.to + ending[0].length;
          n = {
            ...n,
            to: end,
            raw: source.slice(n.from, end),
            text: (n.text ?? "") + "\n",
            attributes: { ...n.attributes, closed: true },
            mapping: {
              ...n.mapping,
              to: end,
              textLength: n.mapping.textLength + 1,
              segments: [
                ...n.mapping.segments,
                {
                  from: n.to,
                  to: end,
                  textFrom: n.mapping.textLength,
                  textTo: n.mapping.textLength + 1,
                },
              ],
            },
          };
        }
      }
      const pendingOpening =
        n.attributes.fence &&
        !n.attributes.closed &&
        !/[\r\n]/.test(n.raw) &&
        proseOffset !== undefined &&
        n.from <= proseOffset &&
        n.to >= proseOffset &&
        [...(previous?.records.values() ?? [])].some(
          (r) =>
            r.node.from === n.from &&
            previous?.doc.nodeAt(r.pos)?.type.name === "paragraph",
        );
      if (pendingOpening)
        n = { ...n, attributes: { ...n.attributes, pendingOpening: true } };
      const pendingHeading =
        n.type === "heading" &&
        /^#{1,6}$/.test(n.raw) &&
        proseOffset !== undefined &&
        n.from <= proseOffset &&
        proseOffset <= n.to &&
        previous !== undefined &&
        (previous.source !== source ||
          [...previous.records.values()].some(
            (r) => r.node.from === n.from && r.node.attributes.pendingHeading,
          ));
      if (pendingHeading)
        n = { ...n, attributes: { ...n.attributes, pendingHeading: true } };
      const id = idFor(n, parentId);
      this.records.set(id, { id, pos, node: n, parentId });
      if (pendingOpening || pendingHeading) {
        this.runs.push({
          pos: pos + 1,
          length: n.raw.length,
          mapping: mapText(n.raw, n.from).mapping,
          node: n,
        });
        return schema.nodes.paragraph!.create({ id }, schema.text(n.raw));
      }
      if (n.type === "list" && /^[-+*]$/.test(n.raw)) {
        const mapped = mapText(n.raw, n.from);
        this.runs.push({
          pos: pos + 1,
          length: n.raw.length,
          mapping: mapped.mapping,
          node: n,
        });
        return schema.nodes.paragraph!.create({ id }, schema.text(n.raw));
      }
      if (["paragraph", "heading", "gap", "tableCell"].includes(n.type)) {
        const type =
          n.type === "gap"
            ? "paragraph"
            : n.type === "tableCell"
              ? "table_cell"
              : n.type;
        const content = inline(n.children, pos + 1, [], id);
        // A trailing empty hard-break line is omitted by the semantic parser.
        // Keep its end position inside the same paragraph for caret and deletion.
        const tailFrom = n.children.at(-1)?.to ?? n.from;
        const breakStart =
          n.type === "paragraph"
            ? /^[ \t]{2,}(?:\r\n|\n)/.exec(source.slice(tailFrom))
            : null;
        const continuation = containerContinuation(source, n.from);
        const continuationStart = tailFrom + (breakStart?.[0].length ?? 0);
        const continuationEnd = continuationStart + continuation.length;
        const pendingBreak =
          !!breakStart &&
          source.slice(continuationStart, continuationEnd) === continuation &&
          (continuationEnd === source.length ||
            /^[\r\n]/.test(source.slice(continuationEnd)));
        if (pendingBreak) {
          const at =
            pos + 1 + content.reduce((size, child) => size + child.nodeSize, 0);
          content.push(schema.nodes.hard_break!.create());
          this.runs.push({
            pos: at,
            length: 1,
            node: n,
            mapping: {
              from: tailFrom,
              to: continuationEnd,
              textLength: 1,
              segments: [
                { from: tailFrom, to: continuationEnd, textFrom: 0, textTo: 1 },
              ],
            },
          });
        }
        // The semantic AST deliberately omits trailing whitespace. In an
        // editor it still needs positions, without changing Markdown bytes.
        if (!pendingBreak && ["paragraph", "heading", "gap"].includes(n.type)) {
          const from =
            n.children.at(-1)?.to ??
            n.from +
              (n.type === "heading"
                ? (/^#{1,6}(?:[ \t]+|$)/.exec(n.raw)?.[0].length ?? 0)
                : 0);
          const raw =
            n.type === "gap"
              ? /^[ \t]*/.exec(source.slice(from))![0]
              : source.slice(from, n.to);
          if (/^[ \t]+$/.test(raw)) {
            const mapped = mapText(raw, from);
            this.runs.push({
              pos:
                pos +
                1 +
                content.reduce((size, child) => size + child.nodeSize, 0),
              length: raw.length,
              mapping: mapped.mapping,
              node: { ...n, text: raw },
            });
            content.push(schema.text(raw));
          }
        }
        if (!content.length)
          this.runs.push({
            pos: pos + 1,
            length: 0,
            mapping: {
              from:
                n.from +
                (n.type === "tableCell"
                  ? (/^\s*\|?\s*/.exec(n.raw)?.[0].length ?? 0)
                  : n.type === "heading"
                    ? (/^#{1,6}(?:[ \t]+|$)/.exec(n.raw)?.[0].length ?? 0)
                    : 0),
              to:
                n.from +
                (n.type === "tableCell"
                  ? (/^\s*\|?\s*/.exec(n.raw)?.[0].length ?? 0)
                  : n.type === "heading"
                    ? (/^#{1,6}(?:[ \t]+|$)/.exec(n.raw)?.[0].length ?? 0)
                    : 0),
              textLength: 0,
              segments: [],
            },
            node: n,
          });
        return schema.nodes[type]!.create(
          { id, depth: n.attributes.depth, header, align },
          content,
        );
      }
      if (
        ["list", "listItem", "blockquote", "table", "tableRow"].includes(n.type)
      ) {
        let p = pos + 1;
        const children = n.children.map((child, index) => {
          const b = block(
            child,
            p,
            n.type === "table"
              ? index === 0
              : n.type === "tableRow"
                ? header
                : false,
            n.type === "tableRow"
              ? align instanceof Array
                ? align[index]
                : null
              : n.attributes.align,
            id,
          );
          p += b.nodeSize;
          return b;
        });
        if (
          !children.length &&
          (n.type === "listItem" || n.type === "blockquote")
        ) {
          const at = n.to;
          const synthetic: ProjectionNode = {
            id: "empty",
            type: "gap",
            raw: "",
            from: at,
            to: at,
            attributes: {},
            children: [],
            text: "",
            mapping: mapText("", at).mapping,
          };
          children.push(block(synthetic, pos + 1, false, null, id));
        }
        const type =
          n.type === "list"
            ? n.attributes.ordered
              ? "ordered_list"
              : "bullet_list"
            : ((
                { listItem: "list_item", tableRow: "table_row" } as Record<
                  string,
                  string
                >
              )[n.type] ?? n.type);
        return schema.nodes[type]!.create(
          { id, start: n.attributes.start ?? 1, checked: n.attributes.checked },
          children,
        );
      }
      if (n.type === "thematicBreak") return schema.nodes.rule!.create({ id });
      return schema.nodes.literal!.create({
        id,
        kind: ["code", "math"].includes(n.type) ? n.type : "raw",
        text: n.text ?? n.raw,
        language: n.attributes.lang ?? "",
      });
    };
    let pos = 0;
    const children = this.projection.blocks.map((n) => {
      const b = block(n, pos);
      pos += b.nodeSize;
      return b;
    });
    if (!children.length) children.push(schema.nodes.paragraph!.create());
    this.doc = schema.nodes.doc!.create(null, children);
    if (previous)
      for (const old of previous.records.values()) {
        const from = mapped(old.node.from),
          to = mapped(old.node.to, true);
        this.replacements.set(
          old.id,
          [...this.records.values()]
            .filter(
              (r) =>
                r.node.type === old.node.type &&
                r.parentId === old.parentId &&
                (r.id === old.id || (r.node.from < to && r.node.to > from)),
            )
            .map((r) => r.id),
        );
      }
  }
  deletionRange(
    offset: number,
    backward: boolean,
    unit: "grapheme" | "word" | "line" = "grapheme",
  ): { from: number; to: number } {
    const pos = this.positionAt(offset);
    if (unit !== "grapheme") {
      const resolved = this.doc.resolve(pos);
      if (resolved.parent.isTextblock) {
        const text = resolved.parent.textBetween(
          0,
          resolved.parent.content.size,
          "\n",
          "\ufffc",
        );
        const local = resolved.parentOffset;
        let target: number;
        if (unit === "line")
          target = backward
            ? text.lastIndexOf("\n", local - 1) + 1
            : text.indexOf("\n", local) < 0
              ? text.length
              : text.indexOf("\n", local);
        else {
          const segments = [
            ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
              text,
            ),
          ];
          target = backward
            ? (segments.filter((s) => s.index < local && s.isWordLike).at(-1)
                ?.index ?? 0)
            : (() => {
                const word = segments.find(
                  (s) => s.index + s.segment.length > local && s.isWordLike,
                );
                return word ? word.index + word.segment.length : text.length;
              })();
        }
        return {
          from: this.sourceAt(resolved.start() + Math.min(local, target)),
          to: this.sourceAt(
            resolved.start() + Math.max(local, target),
            "before",
          ),
        };
      }
    }
    const run = this.runs.find((r) =>
      backward
        ? r.pos < pos && r.pos + r.length >= pos
        : r.pos <= pos && r.pos + r.length > pos,
    );
    if (run) {
      if (["inlineMath", "image", "imageReference"].includes(run.node.type))
        return { from: run.node.from, to: run.node.to };
      const local = Math.max(0, Math.min(run.length, pos - run.pos)),
        text = run.node.text ?? run.node.raw;
      const boundaries = [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ]
        .map((s) => s.index)
        .concat(text.length);
      const a = backward
        ? (boundaries.filter((b) => b < local).at(-1) ?? local)
        : local;
      const b = backward ? local : (boundaries.find((b) => b > local) ?? local);
      return {
        from: mapTextToSource(run.mapping, a),
        to: mapTextToSource(run.mapping, b, "before"),
      };
    }
    const boundaries = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        this.source,
      ),
    ]
      .map((s) => s.index)
      .concat(this.source.length);
    return {
      from: backward
        ? (boundaries.filter((b) => b < offset).at(-1) ?? offset)
        : offset,
      to: backward ? offset : (boundaries.find((b) => b > offset) ?? offset),
    };
  }
  sourceAt(pos: number, affinity: "before" | "after" = "after"): number {
    const exact = this.runs.filter(
      (r) => pos >= r.pos && pos <= r.pos + r.length,
    );
    const r =
      (affinity === "after" ? exact.at(-1) : exact[0]) ??
      this.runs.reduce<Run | undefined>(
        (best, r) =>
          !best || Math.abs(r.pos - pos) < Math.abs(best.pos - pos) ? r : best,
        undefined,
      );
    if (!r) return 0;
    return mapTextToSource(
      r.mapping,
      Math.max(0, Math.min(r.length, pos - r.pos)),
      affinity,
    );
  }
  positionAt(offset: number, affinity?: "before" | "after"): number {
    if (affinity) {
      const literal = this.literalAt(offset);
      if (literal) return literal.pos + (affinity === "after" ? 1 : 0);
    }
    let best: Run | undefined,
      distance = Infinity;
    for (const r of this.runs) {
      const d =
        offset < r.mapping.from
          ? r.mapping.from - offset
          : offset > r.mapping.to
            ? offset - r.mapping.to
            : 0;
      if (d < distance) {
        best = r;
        distance = d;
      }
    }
    return best
      ? best.pos +
          Math.min(
            best.length,
            mapSourceToText(
              best.mapping,
              Math.max(best.mapping.from, Math.min(best.mapping.to, offset)),
            ),
          )
      : 1;
  }
  literalAt(offset: number, kind?: string): BlockRecord | undefined {
    return [...this.records.values()].find(
      (r) =>
        ["code", "math", "raw"].includes(r.node.type) &&
        r.node.from <= offset &&
        r.node.to >= offset &&
        (!kind ||
          r.node.type === kind ||
          (kind === "code" && r.node.type === "raw")),
    );
  }
}
