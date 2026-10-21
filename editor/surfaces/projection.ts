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
import type { Patch } from "../core/types";
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
    strong: { toDOM: () => ["strong", 0] },
    em: { toDOM: () => ["em", 0] },
    strike: { toDOM: () => ["s", 0] },
    code: { toDOM: () => ["code", 0] },
    link: {
      attrs: { url: {} },
      toDOM: (n) => ["a", { "data-url": n.attrs.url }, 0],
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
}
let nextID = 1;
export class RichProjection {
  readonly projection: DocumentProjection;
  readonly doc: PMNode;
  readonly runs: Run[] = [];
  readonly records = new Map<string, BlockRecord>();
  constructor(
    readonly source: string,
    previous?: RichProjection,
    patch?: Patch,
  ) {
    this.projection = buildProjection(source);
    const used = new Set<string>();
    const mapped = (at: number) =>
      !patch || at <= patch.from
        ? at
        : at >= patch.to
          ? at + patch.insert.length - (patch.to - patch.from)
          : patch.from;
    const idFor = (node: ProjectionNode): string => {
      const old =
        previous &&
        [...previous.records.values()].find(
          (r) =>
            !used.has(r.id) &&
            r.node.type === node.type &&
            mapped(r.node.from) === node.from &&
            (r.node.raw === node.raw ||
              (patch && r.node.from <= patch.from && r.node.to >= patch.to)),
        );
      const id = old?.id ?? `view-${nextID++}`;
      used.add(id);
      return id;
    };
    const inline = (
      nodes: ProjectionNode[],
      pos: number,
      marks: readonly Mark[] = [],
    ): PMNode[] => {
      const result: PMNode[] = [];
      for (const n of nodes) {
        const start = pos;
        let made: PMNode[] = [];
        if (n.type === "text" || n.type === "raw" || n.type === "inlineCode") {
          const text = n.text ?? n.raw;
          if (text) {
            const ms =
              n.type === "inlineCode"
                ? [...marks, schema.marks.code!.create()]
                : marks;
            made = [schema.text(text, ms)];
            this.runs.push({
              pos,
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
          made = inline(n.children, pos, [
            ...marks,
            schema.marks[name]!.create({ url: n.attributes.url ?? "" }),
          ]);
        } else if (n.type === "break") {
          made = [schema.nodes.hard_break!.create()];
          this.runs.push({ pos, length: 1, mapping: n.mapping, node: n });
        } else if (
          n.type === "inlineMath" ||
          n.type === "image" ||
          n.type === "imageReference"
        ) {
          const id = idFor(n);
          this.records.set(id, { id, pos, node: n });
          made = [
            schema.nodes[
              n.type === "inlineMath" ? "inline_math" : "image"
            ]!.create({
              id,
              text: n.text ?? n.raw,
              url: n.attributes.url ?? "",
              alt: n.attributes.alt ?? "",
            }),
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
    ): PMNode => {
      const id = idFor(n);
      this.records.set(id, { id, pos, node: n });
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
        const content = inline(n.children, pos + 1);
        if (!content.length)
          this.runs.push({
            pos: pos + 1,
            length: 0,
            mapping: { from: n.from, to: n.from, textLength: 0, segments: [] },
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
            n.type === "table" && index === 0,
            n.type === "tableRow"
              ? align instanceof Array
                ? align[index]
                : null
              : n.attributes.align,
          );
          p += b.nodeSize;
          return b;
        });
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
  positionAt(offset: number): number {
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
        (!kind || r.node.type === kind),
    );
  }
}
