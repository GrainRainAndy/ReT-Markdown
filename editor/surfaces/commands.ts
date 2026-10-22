import type {
  LogicalSelection,
  Owner,
  Patch,
  SourceRange,
} from "../core/types";
import { buildProjection, type ProjectionNode } from "../syntax/projection";
import { mapText, mapTextToSource } from "../syntax/mapping";
import {
  logical,
  flatten,
  minimalPatch,
  newlineAt,
  replaceIntent,
  type Intent,
} from "./editing";
export function mapOffset(
  offset: number,
  patches: readonly Patch[],
  after = true,
): number {
  let delta = 0;
  for (const p of [...patches].sort((a, b) => a.from - b.from)) {
    if (offset < p.from || (offset === p.from && !after)) break;
    if (offset <= p.to) return p.from + delta + (after ? p.insert.length : 0);
    delta += p.insert.length - (p.to - p.from);
  }
  return offset + delta;
}
export function patched(source: string, patches: readonly Patch[]): string {
  for (const p of [...patches].sort((a, b) => b.from - a.from))
    source = source.slice(0, p.from) + p.insert + source.slice(p.to);
  return source;
}
function intentWithSelection(
  patches: Patch[],
  selection: LogicalSelection,
): Intent {
  return {
    patches,
    selection: {
      ...selection,
      anchor: {
        ...selection.anchor,
        offset: mapOffset(selection.anchor.offset, patches),
      },
      head: {
        ...selection.head,
        offset: mapOffset(selection.head.offset, patches),
      },
    },
  };
}
export function containing(
  source: string,
  offset: number,
  type: string,
): ProjectionNode | undefined {
  return flatten(buildProjection(source).blocks)
    .filter((n) => n.type === type && n.from <= offset && n.to >= offset)
    .at(-1);
}
export function headingIntent(
  source: string,
  s: LogicalSelection,
  depth: number,
): Intent | null {
  const nodes = flatten(buildProjection(source).blocks);
  const node = nodes.find(
    (n) =>
      ["heading", "paragraph", "gap"].includes(n.type) &&
      n.from <= s.head.offset &&
      n.to >= s.head.offset,
  );
  if (!node) return null;
  const raw = node.raw,
    eol = newlineAt(source, node.from),
    setext = /(\r\n|\n|\r)([ \t]*)([=-]+)([ \t]*)$/.exec(raw);
  if (setext) {
    const begin = node.from + setext.index;
    if (depth <= 2) {
      const from = begin + setext[1]!.length + setext[2]!.length;
      return intentWithSelection(
        [
          {
            from,
            to: from + setext[3]!.length,
            insert: (depth === 1 ? "=" : "-").repeat(setext[3]!.length),
          },
        ],
        s,
      );
    }
    return intentWithSelection(
      [
        { from: node.from, to: node.from, insert: "#".repeat(depth) + " " },
        { from: begin, to: node.to, insert: "" },
      ],
      s,
    );
  }
  const marker = /^#{1,6}[ \t]+/.exec(raw);
  const prefix = depth ? "#".repeat(depth) + " " : "";
  return intentWithSelection(
    [
      {
        from: node.from,
        to: node.from + (marker?.[0].length ?? 0),
        insert: prefix,
      },
    ],
    s,
  );
}
interface ItemInfo {
  node: ProjectionNode;
  list: ProjectionNode;
  parent: ProjectionNode | undefined;
  depth: number;
}
function itemsOf(nodes: ProjectionNode[]): ItemInfo[] {
  const out: ItemInfo[] = [];
  function walk(
    nodes: ProjectionNode[],
    parent: ProjectionNode | undefined,
    depth: number,
  ) {
    for (const n of nodes) {
      if (n.type === "list") {
        for (const item of n.children) {
          out.push({ node: item, list: n, parent, depth });
          walk(item.children, item, depth + 1);
        }
      } else walk(n.children, parent, depth);
    }
  }
  walk(nodes, undefined, 0);
  return out;
}
export function indentIntent(
  source: string,
  s: LogicalSelection,
  direction: 1 | -1,
): Intent | null {
  const items = itemsOf(buildProjection(source).blocks),
    a = Math.min(s.anchor.offset, s.head.offset),
    b = Math.max(s.anchor.offset, s.head.offset);
  let selected: ItemInfo[];
  if (a === b) {
    const one = items.filter((i) => i.node.from <= a && i.node.to >= a).at(-1);
    selected = one ? [one] : [];
  } else {
    selected = items.filter(
      (i) =>
        i.node.from < b &&
        (i.node.children.find((n) => n.type === "list")?.from ?? i.node.to) > a,
    );
    selected = selected.filter(
      (i) =>
        !selected.some(
          (p) =>
            p !== i && p.node.from <= i.node.from && p.node.to >= i.node.to,
        ),
    );
  }
  if (!selected.length) return null;
  const list = selected[0]!.list;
  if (selected.some((i) => i.list !== list)) return null;
  const siblings = list.children,
    first = siblings.indexOf(selected[0]!.node),
    parent = selected[0]!.parent;
  if (direction === 1 && first === 0) return null;
  if (direction === -1 && !parent) return null;
  const lineStart = (at: number) =>
    source.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const target = direction === 1 ? siblings[first - 1]! : parent!;
  const start = lineStart(target.from);
  const prefix = /^(\s*)(?:[-+*]|\d+[.)])[ \t]+/.exec(
    source.slice(start, target.to),
  );
  const width =
    direction === 1
      ? (prefix?.[0].length ?? 2) - (prefix?.[1]?.length ?? 0)
      : selected[0]!.node.from -
        lineStart(selected[0]!.node.from) -
        (parent!.from - lineStart(parent!.from));
  if (width <= 0) return null;
  const patches: Patch[] = [];
  for (const item of selected) {
    let at = lineStart(item.node.from);
    while (at <= item.node.to) {
      const end = source.indexOf("\n", at);
      const limit = end < 0 ? source.length : end;
      const line = source.slice(at, limit);
      if (line.trim()) {
        if (direction === 1)
          patches.push({ from: at, to: at, insert: " ".repeat(width) });
        else {
          const whitespace = /^[ \t]*/.exec(line)![0];
          if (
            whitespace.length < width ||
            whitespace.slice(0, width).includes("\t")
          )
            return null;
          patches.push({ from: at, to: at + width, insert: "" });
        }
      }
      if (end < 0 || end >= item.node.to) break;
      at = end + 1;
    }
  }
  const validates = (): boolean => {
    const next = itemsOf(buildProjection(patched(source, patches)).blocks);
    if (next.length !== items.length) return false;
    for (const item of items) {
      const moved = next.find(
        (i) => i.node.from === mapOffset(item.node.from, patches),
      );
      if (!moved) return false;
      let expectedParent = item.parent;
      if (selected.includes(item))
        expectedParent =
          direction === 1
            ? target
            : items.find((i) => i.node === parent)?.parent;
      if (
        moved.parent?.from !==
        (expectedParent ? mapOffset(expectedParent.from, patches) : undefined)
      )
        return false;
    }
    return true;
  };
  if (!validates()) {
    // A nested ordered list beginning above 1 cannot interrupt a paragraph.
    // Add only the required separator, then verify the whole intended tree.
    const at = lineStart(selected[0]!.node.from),
      prefix = patches.find((p) => p.from === at && p.to === at);
    if (direction !== 1 || !prefix) return null;
    prefix.insert = newlineAt(source, at) + prefix.insert;
    if (!validates()) return null;
  }
  return intentWithSelection(patches, s);
}
function safeFence(body: string, current = "```"): string {
  const char = current[0]!;
  const runs = body
    .split(/\r\n|\r|\n/)
    .map(
      (line) =>
        new RegExp("^ {0,3}(" + (char === "`" ? "`" : "~") + "+)[ \t]*$").exec(
          line,
        )?.[1]?.length ?? 0,
    );
  return char.repeat(
    runs.reduce(
      (length, n) => Math.max(length, n + 1),
      Math.max(current.length, 3),
    ),
  );
}
export function blockIntent(
  source: string,
  s: LogicalSelection,
  kind: string,
): Intent | null {
  const a = Math.min(s.anchor.offset, s.head.offset),
    b = Math.max(s.anchor.offset, s.head.offset),
    eol = newlineAt(source, a);
  if (kind === "codeBlock" || kind === "mathBlock" || kind === "table") {
    const selected = source.slice(a, b);
    if (
      kind === "mathBlock" &&
      selected
        .split(/\r\n|\r|\n/)
        .some((line) => /^ {0,3}\${2,}[ \t]*$/.test(line))
    )
      return null;
    const fence = safeFence(selected);
    let insert =
      kind === "table"
        ? `| 列 1 | 列 2 |${eol}| --- | --- |${eol}|  |  |`
        : kind === "codeBlock"
          ? `${fence}${eol}${selected}${selected.endsWith(eol) ? "" : eol}${fence}`
          : `$$${eol}${selected}${selected.endsWith(eol) ? "" : eol}$$`;
    const before =
      a > 0 && !source.slice(0, a).endsWith(eol + eol) ? eol + eol : "";
    const after =
      b < source.length && !source.slice(b).startsWith(eol + eol)
        ? eol + eol
        : "";
    return replaceIntent(a, b, before + insert + after);
  }
  const from = source.lastIndexOf("\n", Math.max(0, a - 1)) + 1;
  const end = source.indexOf("\n", b);
  const to = end < 0 ? source.length : end;
  const lines = source.slice(from, to).split(/\r\n|\r|\n/);
  const marker =
    kind === "quote" ? "> " : kind === "orderedList" ? "1. " : "- ";
  return intentWithSelection(
    [
      {
        from,
        to,
        insert: lines
          .map((line, index) => {
            const match =
              kind === "quote"
                ? /^> ?/.exec(line)
                : /^(?:[-+*]|\d+[.)])\s+/.exec(line);
            return match
              ? line.slice(match[0].length)
              : (kind === "orderedList" ? `${index + 1}. ` : marker) + line;
          })
          .join(eol),
      },
    ],
    s,
  );
}
/** Rich boundary selections visibly treat code/math as whole objects. */
export function expandLiteralSelection(
  source: string,
  s: LogicalSelection,
): LogicalSelection {
  if (s.owner.kind !== "prose" || s.anchor.offset === s.head.offset) return s;
  let from = Math.min(s.anchor.offset, s.head.offset),
    to = Math.max(s.anchor.offset, s.head.offset);
  for (const node of flatten(buildProjection(source).blocks))
    if (
      ["code", "math"].includes(node.type) &&
      from < node.to &&
      to > node.from
    ) {
      from = Math.min(from, node.from);
      to = Math.max(to, node.to);
    }
  const forward = s.anchor.offset < s.head.offset;
  return {
    ...s,
    anchor: { ...s.anchor, offset: forward ? from : to },
    head: { ...s.head, offset: forward ? to : from },
  };
}
export function clipboardRange(
  source: string,
  s: LogicalSelection,
): SourceRange {
  let from = Math.min(s.anchor.offset, s.head.offset),
    to = Math.max(s.anchor.offset, s.head.offset);
  if (
    from === to ||
    s.owner.kind === "source" ||
    s.owner.kind === "code" ||
    s.owner.kind === "math"
  )
    return { from, to };
  for (const n of flatten(buildProjection(source).blocks).reverse()) {
    if (
      ![
        "strong",
        "emphasis",
        "delete",
        "link",
        "inlineCode",
        "inlineMath",
        "image",
        "imageReference",
      ].includes(n.type)
    )
      continue;
    const leaves = flatten(n.children).filter((c) => c.text !== undefined);
    const innerFrom = leaves[0]?.mapping.from ?? n.mapping.from,
      innerTo = leaves.at(-1)?.mapping.to ?? n.mapping.to;
    if (from <= innerFrom && to >= innerTo && from >= n.from && to <= n.to) {
      from = Math.min(from, n.from);
      to = Math.max(to, n.to);
    }
  }
  return { from, to };
}
export function markIntent(
  source: string,
  s: LogicalSelection,
  kind: "strong" | "emphasis" | "delete" | "inlineCode",
): Intent {
  const delimiter = {
    strong: "**",
    emphasis: "*",
    delete: "~~",
    inlineCode: "`",
  }[kind];
  const from = Math.min(s.anchor.offset, s.head.offset),
    to = Math.max(s.anchor.offset, s.head.offset);
  const node = flatten(buildProjection(source).blocks).find(
    (n) => n.type === kind && n.from <= from && n.to >= to,
  );
  if (node) {
    const leaves = flatten(node.children).filter((n) => n.text !== undefined);
    const a = leaves[0]?.mapping.from ?? node.mapping.from,
      b = leaves.at(-1)?.mapping.to ?? node.mapping.to;
    return intentWithSelection(
      [
        { from: node.from, to: a, insert: "" },
        { from: b, to: node.to, insert: "" },
      ],
      s,
    );
  }
  return {
    patches: [
      { from, to, insert: delimiter + source.slice(from, to) + delimiter },
    ],
    selection: logical(from + delimiter.length, to + delimiter.length, s.owner),
  };
}
export interface TableContext {
  table: ProjectionNode;
  row: number;
  column: number;
  cell: ProjectionNode;
}
export function tableContext(
  source: string,
  offset: number,
  owner?: Owner,
): TableContext | null {
  const table = containing(source, offset, "table");
  if (!table) return null;
  if (owner?.kind === "cell") {
    const cell = table.children[owner.row]?.children[owner.column];
    if (cell) return { table, row: owner.row, column: owner.column, cell };
  }
  for (let row = 0; row < table.children.length; row++) {
    const cells = table.children[row]!.children;
    for (let column = 0; column < cells.length; column++) {
      const cell = cells[column]!;
      if (cell.from <= offset && cell.to >= offset)
        return { table, row, column, cell };
    }
  }
  return { table, row: 0, column: 0, cell: table.children[0]!.children[0]! };
}
/** Virtual cells share the row-end anchor; the existing cell owner carries identity. */
export function virtualCellIntent(
  cell: ProjectionNode,
  text: string,
  owner: Owner,
): Intent {
  const prefix =
    (cell.attributes.needsSeparator ? " |" : "") +
    "  |".repeat(Number(cell.attributes.missingBefore)) +
    " ";
  return {
    patches: [{ from: cell.from, to: cell.to, insert: prefix + text + " |" }],
    selection: logical(
      cell.from + prefix.length + text.length,
      cell.from + prefix.length + text.length,
      owner,
    ),
  };
}
export function cellOffset(cell: ProjectionNode): number {
  return (
    flatten(cell.children).find((n) => n.text !== undefined)?.mapping.from ??
    cell.from + Math.min(cell.raw.search(/\S|$/), cell.raw.length)
  );
}
export function tableText(table: ProjectionNode): string[][] {
  return table.children.map((row) =>
    row.children.map((cell) =>
      cell.raw
        .replace(/^\s*\|/, "")
        .replace(/(?<!\\)\|\s*$/, "")
        .trim(),
    ),
  );
}
function tableMarkdown(
  rows: string[][],
  align: unknown[],
  eol: string,
): string {
  if (!rows.length || !rows[0]?.length) return "";
  const line = (r: string[]) => "| " + r.join(" | ") + " |";
  return [
    line(rows[0]!),
    line(
      align.map((a) =>
        a === "left"
          ? ":---"
          : a === "right"
            ? "---:"
            : a === "center"
              ? ":---:"
              : "---",
      ),
    ),
    ...rows.slice(1).map(line),
  ].join(eol);
}
export function tableIntent(
  source: string,
  s: LogicalSelection,
  operation: string,
): Intent | null {
  const context = tableContext(source, s.head.offset, s.owner);
  if (!context) return null;
  const { table, row, column } = context;
  const rows = tableText(table),
    align = [
      ...((table.attributes.align as unknown[]) ?? rows[0]!.map(() => null)),
    ];
  let targetRow = row,
    targetColumn = column;
  if (operation === "addRow") {
    rows.splice(
      row + 1,
      0,
      rows[0]!.map(() => ""),
    );
    targetRow++;
  } else if (operation === "deleteRow") {
    rows.splice(row, 1);
    targetRow = Math.min(row, rows.length - 1);
  } else if (operation === "addColumn") {
    rows.forEach((r) => r.splice(column + 1, 0, ""));
    align.splice(column + 1, 0, null);
    targetColumn++;
  } else if (operation === "deleteColumn") {
    rows.forEach((r) => r.splice(column, 1));
    align.splice(column, 1);
    targetColumn = Math.min(column, align.length - 1);
  } else if (operation.startsWith("align"))
    align[column] = operation.slice(5).toLowerCase();
  else return null;
  const insert = tableMarkdown(rows, align, newlineAt(source, table.from));
  const patch = { from: table.from, to: table.to, insert };
  const next = containing(patched(source, [patch]), table.from, "table");
  const cell =
    next?.children[Math.max(0, targetRow)]?.children[Math.max(0, targetColumn)];
  return {
    patches: [patch],
    selection: logical(cell ? cellOffset(cell) : table.from),
  };
}
export function tableClipboard(
  source: string,
  range: NonNullable<LogicalSelection["cellRange"]>,
  at: number,
): { markdown: string; text: string } | null {
  const context = tableContext(source, at);
  if (!context) return null;
  const r0 = Math.min(range.fromRow, range.toRow),
    r1 = Math.max(range.fromRow, range.toRow),
    c0 = Math.min(range.fromColumn, range.toColumn),
    c1 = Math.max(range.fromColumn, range.toColumn);
  const rows = tableText(context.table)
    .slice(r0, r1 + 1)
    .map((r) => r.slice(c0, c1 + 1));
  if (!rows.length) return null;
  const text = rows
    .map((r) => r.map((c) => c.replace(/\\([\\|])/g, "$1")).join("\t"))
    .join("\n");
  const header = r0 === 0 ? rows : [rows[0]!.map(() => ""), ...rows];
  return {
    markdown: tableMarkdown(
      header,
      header[0]!.map(() => null),
      "\n",
    ),
    text,
  };
}
export function literalPatch(
  source: string,
  node: ProjectionNode,
  text: string,
  anchor: number,
  head: number,
  owner: Owner,
): Intent {
  const original = node.text ?? node.raw;
  if (node.type === "raw") {
    const diff = minimalPatch(original, text),
      from = mapTextToSource(node.mapping, diff.from),
      to = mapTextToSource(node.mapping, diff.to, "before"),
      insert = diff.insert.replace(/\n/g, newlineAt(source, from));
    const next = mapText(
      source.slice(node.from, from) + insert + source.slice(to, node.to),
      node.from,
    );
    return {
      patches: [{ from, to, insert }],
      selection: logical(
        mapTextToSource(next.mapping, anchor),
        mapTextToSource(next.mapping, head),
        owner,
      ),
    };
  }
  let proposed = text;
  const eol = newlineAt(source, node.from);
  if (node.attributes.closed && proposed && !proposed.endsWith("\n"))
    proposed += "\n";
  const diff = minimalPatch(original, proposed);
  const from = mapTextToSource(node.mapping, diff.from),
    to =
      diff.from === diff.to
        ? from
        : mapTextToSource(node.mapping, diff.to, "before");
  const first = node.mapping.segments.find((s) => s.textTo > s.textFrom);
  const lineStart = first ? source.lastIndexOf("\n", first.from - 1) + 1 : from;
  // Empty bodies have no text segment. Derive their continuation prefix from
  // the parsed opening boundary, replacing list markers with indentation.
  const openingStart = source.lastIndexOf("\n", Math.max(0, node.from - 1)) + 1;
  const continuation = source
    .slice(openingStart, node.from)
    .replace(/(?:[-+*]|\d+[.)])[ \t]+/g, (marker) => " ".repeat(marker.length));
  const prefix = first ? source.slice(lineStart, first.from) : continuation;
  const safePrefix = /^[\s>]*$/.test(prefix) ? prefix : "";
  let insert = diff.insert.split("\n").join(eol + safePrefix);
  if (
    insert.endsWith(eol + safePrefix) &&
    safePrefix &&
    (source.slice(to).startsWith(safePrefix) || to === node.mapping.to)
  )
    insert = insert.slice(0, -safePrefix.length);
  if (
    safePrefix &&
    from === source.lastIndexOf("\n", Math.max(0, from - 1)) + 1 &&
    insert
  )
    insert = safePrefix + insert;
  // A bare opening fence still needs its line ending before the first body
  // character. Never supply a closing fence for an unclosed source block.
  if (node.attributes.fence && !/[\r\n]/.test(node.raw) && insert)
    insert = eol + safePrefix + insert;
  const patch = { from, to, insert };
  const patches = [patch];
  if (node.type === "code" && node.attributes.fence) {
    const old = String(node.attributes.fence),
      fence = safeFence(proposed, old);
    if (fence !== old) {
      const opening = node.raw.indexOf(old);
      patches.push({
        from: node.from + opening,
        to: node.from + opening + old.length,
        insert: fence,
      });
      if (node.attributes.closed) {
        const endingStart =
          Math.max(node.raw.lastIndexOf("\n"), node.raw.lastIndexOf("\r")) + 1;
        const closing = node.raw.indexOf(old, endingStart);
        const length = new RegExp("^" + old[0] + "+").exec(
          node.raw.slice(closing),
        )![0].length;
        patches.push({
          from: node.from + closing,
          to: node.from + closing + length,
          insert: fence,
        });
      }
    }
  }
  const nextSource = patched(source, patches);
  const candidates = flatten(buildProjection(nextSource).blocks).filter(
    (n) => n.type === node.type && n.from <= node.from + 1 && n.to >= node.from,
  );
  let next = candidates.at(-1);
  if (
    next &&
    node.type === "code" &&
    !node.attributes.fence &&
    node.text?.endsWith("\n")
  ) {
    const ending = /^(\r\n|\r|\n)/.exec(nextSource.slice(next.to));
    if (ending) {
      next = {
        ...next,
        mapping: {
          ...next.mapping,
          to: next.to + ending[0].length,
          textLength: next.mapping.textLength + 1,
          segments: [
            ...next.mapping.segments,
            {
              from: next.to,
              to: next.to + ending[0].length,
              textFrom: next.mapping.textLength,
              textTo: next.mapping.textLength + 1,
            },
          ],
        },
      };
    }
  }
  if (
    !next ||
    (node.attributes.fence &&
      (next.text !== proposed || next.to !== mapOffset(node.to, patches, true)))
  )
    throw Error("字面内容无法安全表示；请恢复输入或在源码模式调整分隔符");
  return {
    patches,
    selection: logical(
      mapTextToSource(next.mapping, Math.min(anchor, next.mapping.textLength)),
      mapTextToSource(next.mapping, Math.min(head, next.mapping.textLength)),
      owner,
    ),
  };
}
