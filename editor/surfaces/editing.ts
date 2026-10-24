import type { LogicalSelection, Owner, Patch } from "../core/types";
import type { DocumentProjection, ProjectionNode } from "../syntax/projection";
export const logical = (
  anchor: number,
  head = anchor,
  owner: Owner = { kind: "prose" },
): LogicalSelection => ({
  anchor: { offset: anchor, affinity: "after" },
  head: { offset: head, affinity: "after" },
  owner,
  kind: "text",
});
export function newlineAt(source: string, at: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const next = /\r\n|\r|\n/.exec(source.slice(start));
  if (next) return next[0];
  const all = source.match(/\r\n|\r|\n/g) ?? [];
  return all.filter((e) => e === "\r\n").length > all.length / 2
    ? "\r\n"
    : "\n";
}
export function minimalPatch(before: string, after: string): Patch {
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before[from] === after[from]
  )
    from++;
  const boundaries = (text: string) =>
    new Set(
      [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ]
        .map((s) => s.index)
        .concat(text.length),
    );
  const a = boundaries(before),
    b = boundaries(after);
  while (from > 0 && (!a.has(from) || !b.has(from))) from--;
  let to = before.length,
    end = after.length;
  while (to > from && end > from && before[to - 1] === after[end - 1]) {
    to--;
    end--;
  }
  while (!a.has(to) || !b.has(end)) {
    to++;
    end++;
  }
  return { from, to, insert: after.slice(from, end) };
}
export interface Intent {
  patches: Patch[];
  selection: LogicalSelection;
}
export function replaceIntent(
  from: number,
  to: number,
  insert: string,
  owner: Owner = { kind: "prose" },
): Intent {
  return {
    patches: [{ from, to, insert }],
    selection: logical(from + insert.length, from + insert.length, owner),
  };
}
export function flatten(nodes: ProjectionNode[]): ProjectionNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}
/** Continue parser-confirmed opening containers, without repeating list markers. */
export function containerContinuation(
  source: string,
  bodyFrom: number,
): string {
  const start = source.lastIndexOf("\n", Math.max(0, bodyFrom - 1)) + 1;
  return source
    .slice(start, bodyFrom)
    .replace(/(?:[-+*]|\d+[.)])[ \t]+/g, (marker) => " ".repeat(marker.length))
    .replace(/\[[ xX]\][ \t]+$/, "");
}
function listExitPrefix(
  source: string,
  projection: DocumentProjection,
  at: number,
  container: string,
  marker: string,
  eol: string,
  start: number,
): string {
  let parent: ProjectionNode | undefined,
    containingItem: ProjectionNode | undefined;
  const walk = (nodes: ProjectionNode[], ancestor?: ProjectionNode): void => {
    for (const n of nodes) {
      if (n.from > at || n.to < at) continue;
      if (n.type === "listItem") {
        containingItem = n;
        parent = ancestor;
        walk(n.children, n);
      } else walk(n.children, ancestor);
    }
  };
  walk(projection.blocks);
  if (!parent && containingItem && containingItem.from < start) {
    const oldLine =
      source.lastIndexOf("\n", Math.max(0, containingItem.from - 1)) + 1;
    const column = /^[ \t>]*/.exec(source.slice(start, at))![0].length;
    if (column > containingItem.from - oldLine) parent = containingItem;
  }
  if (parent) {
    const line = source.lastIndexOf("\n", Math.max(0, parent.from - 1)) + 1;
    return source.slice(line, parent.from) + marker;
  }
  return container || (start > 0 ? eol : "");
}
export function enterIntent(
  source: string,
  selection: LogicalSelection,
  projection: DocumentProjection,
  shift = false,
): Intent | null {
  const from = Math.min(selection.anchor.offset, selection.head.offset),
    to = Math.max(selection.anchor.offset, selection.head.offset),
    eol = newlineAt(source, from);
  const lineStart = source.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const line = source.slice(lineStart, from);
  const listPattern =
    /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?(.*)$/;
  // A continuation line has no marker of its own. Resolve the innermost
  // source container before applying line-local editing rules.
  const item = flatten(projection.blocks)
    .filter((n) => {
      if (n.type !== "listItem" || n.from > from) return false;
      if (n.to >= to) return true;
      const tail = source.slice(n.to, to);
      return (
        /^(?:[ \t]*|[ \t]*(?:\r\n|\n)[ \t>]*)$/.test(tail) &&
        source.slice(lineStart, from).length > 0
      );
    })
    .at(-1);
  const itemStart = item
    ? source.lastIndexOf("\n", Math.max(0, item.from - 1)) + 1
    : lineStart;
  const itemLineEnd = source.indexOf("\n", itemStart);
  const itemPrefix =
    item &&
    listPattern.exec(
      source
        .slice(itemStart, itemLineEnd < 0 ? source.length : itemLineEnd)
        .replace(/\r$/, ""),
    );
  const paragraph = flatten(projection.blocks).find(
    (n) => n.type === "paragraph" && n.from <= from && n.to >= to,
  );
  const continuation =
    paragraph &&
    (item ||
      flatten(projection.blocks).some(
        (n) => n.type === "blockquote" && n.from <= from && n.to >= to,
      ))
      ? containerContinuation(source, paragraph.from)
      : itemPrefix
        ? itemPrefix[1]! +
          itemPrefix[2]! +
          " ".repeat(itemPrefix[3]!.length + itemPrefix[4]!.length)
        : (/^(?:[ \t]*>[ \t]?)+/.exec(line)?.[0] ?? "");
  if (shift) return replaceIntent(from, to, "  " + eol + continuation);
  const heading = flatten(projection.blocks).find(
    (n) => n.type === "heading" && n.from <= from && n.to >= to,
  );
  if (heading) {
    const underline = /(\r\n|\n|\r)([ \t]*[=-]+[ \t]*)$/.exec(heading.raw);
    if (underline) {
      const oldStart = heading.from + underline.index;
      const insert = eol + underline[2] + eol + eol;
      if (to === oldStart) return replaceIntent(from, heading.to, insert);
      return {
        patches: [
          { from, to, insert },
          { from: oldStart, to: heading.to, insert: "" },
        ],
        selection: logical(from + insert.length),
      };
    }
  }
  const gap = projection.blocks.find(
    (n) => n.type === "gap" && n.from === from,
  );
  if (gap) return replaceIntent(from, to, eol);
  const currentList = listPattern.exec(line);
  const list = currentList ?? (itemStart < lineStart ? itemPrefix : null);
  if (list) {
    const [
      ,
      container = "",
      indent = "",
      marker = "",
      space = "",
      task = "",
      body = "",
    ] = list;
    if (!body && currentList)
      return replaceIntent(
        lineStart,
        from,
        listExitPrefix(
          source,
          projection,
          from,
          container,
          marker + space + task,
          eol,
          lineStart,
        ),
      );
    const next = /^\d/.test(marker)
      ? String(parseInt(marker) + 1) + marker.slice(-1)
      : marker;
    return replaceIntent(
      from,
      to,
      eol + container + indent + next + space + (task ? "[ ] " : ""),
    );
  }
  const quote = /^(\s*(?:>\s?)+)(.*)$/.exec(line);
  if (quote) {
    if (!quote[2]) {
      const prefix = quote[1]!.replace(/>\s?$/, "");
      return replaceIntent(
        lineStart,
        from,
        !prefix.trim() && lineStart > 0 ? eol : prefix,
      );
    }
    return replaceIntent(from, to, eol + quote[1]);
  }
  return replaceIntent(from, to, eol + eol);
}
export function backspaceIntent(
  source: string,
  selection: LogicalSelection,
  projection: DocumentProjection,
): Intent | null {
  const at = selection.head.offset;
  if (selection.anchor.offset !== at)
    return replaceIntent(
      Math.min(at, selection.anchor.offset),
      Math.max(at, selection.anchor.offset),
      "",
    );
  const blocks = projection.blocks;
  const index = blocks.findIndex((n) => n.from === at);
  if (index > 0) {
    const previous = blocks[index - 1]!;
    if (["paragraph", "heading", "gap"].includes(previous.type)) {
      const gap = source.slice(previous.to, at);
      if (/^\s*$/.test(gap)) return replaceIntent(previous.to, at, "");
    }
  }
  const start = source.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const prefix = source.slice(start, at);
  const list =
    /^((?:[ \t]*>[ \t]?)*)([ \t]*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?$/.exec(
      prefix,
    );
  if (list)
    return replaceIntent(
      start,
      at,
      listExitPrefix(
        source,
        projection,
        at,
        list[1]!,
        list[3]! + list[4]! + (list[5] ?? ""),
        newlineAt(source, start),
        start,
      ),
    );
  return null;
}
