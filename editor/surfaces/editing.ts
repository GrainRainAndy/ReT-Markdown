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
  if (shift) return replaceIntent(from, to, "  " + eol);
  const gap = projection.blocks.find(
    (n) => n.type === "gap" && n.from === from,
  );
  if (gap) return replaceIntent(from, to, eol);
  const list = /^(\s*)([-+*]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/.exec(line);
  if (list) {
    const [, indent = "", marker = "", space = "", task = "", body = ""] = list;
    if (!body)
      return replaceIntent(
        lineStart,
        from,
        indent.length >= 2 ? indent.slice(2) + marker + space : "",
      );
    const next = /^\d/.test(marker)
      ? String(parseInt(marker) + 1) + marker.slice(-1)
      : marker;
    return replaceIntent(
      from,
      to,
      eol + indent + next + space + (task ? "[ ] " : ""),
    );
  }
  const quote = /^(\s*(?:>\s?)+)(.*)$/.exec(line);
  if (quote) {
    if (!quote[2])
      return replaceIntent(lineStart, from, quote[1]!.replace(/>\s?$/, ""));
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
  if (/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?$/.test(prefix))
    return replaceIntent(
      start,
      at,
      prefix.startsWith("  ") ? prefix.slice(2) : "",
    );
  return null;
}
