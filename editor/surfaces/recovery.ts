import type { Node as PMNode } from "prosemirror-model";
import type { RichProjection } from "./projection";
import { newlineAt } from "./editing";
function serialize(node: PMNode, eol: string): string {
  if (node.isText) {
    let text = node.text ?? "";
    for (const m of [...node.marks].reverse()) {
      const d = (
        { strong: "**", em: "*", strike: "~~", code: "`" } as Record<
          string,
          string
        >
      )[m.type.name];
      if (d) text = d + text + d;
      else if (m.type.name === "link")
        text =
          "[" +
          text +
          "](" +
          String(m.attrs.url).replace(/[()]/g, "\\$&") +
          ")";
    }
    return text;
  }
  const children: PMNode[] = [];
  node.forEach((n) => children.push(n));
  const inline = () => children.map((n) => serialize(n, eol)).join("");
  switch (node.type.name) {
    case "paragraph":
    case "table_cell":
      return inline();
    case "heading":
      return "#".repeat(node.attrs.depth) + " " + inline();
    case "hard_break":
      return "  " + eol;
    case "literal": {
      const fence = node.attrs.kind === "math" ? "$$" : "```";
      return node.attrs.kind === "raw"
        ? node.attrs.text
        : fence +
            (node.attrs.kind === "code" ? node.attrs.language : "") +
            eol +
            node.attrs.text +
            (String(node.attrs.text).endsWith("\n") ? "" : eol) +
            fence;
    }
    case "inline_math":
      return "$" + node.attrs.text + "$";
    case "image":
      return "![" + node.attrs.alt + "](" + node.attrs.url + ")";
    case "rule":
      return "---";
    case "blockquote":
      return children
        .map((n) => serialize(n, eol))
        .join(eol + eol)
        .split(eol)
        .map((l) => "> " + l)
        .join(eol);
    case "bullet_list":
    case "ordered_list":
      return children
        .map((n, i) => {
          const marker =
            node.type.name === "ordered_list"
              ? String((node.attrs.start ?? 1) + i) + ". "
              : "- ";
          return serialize(n, eol)
            .split(eol)
            .map(
              (line, index) =>
                (index ? " ".repeat(marker.length) : marker) + line,
            )
            .join(eol);
        })
        .join(eol);
    case "table_row":
      return "| " + children.map((n) => serialize(n, eol)).join(" | ") + " |";
    case "table":
      return children
        .map(
          (n, i) =>
            serialize(n, eol) +
            (i === 0
              ? eol +
                "| " +
                Array.from({ length: n.childCount }, () => "---").join(" | ") +
                " |"
              : ""),
        )
        .join(eol);
    default:
      return children.map((n) => serialize(n, eol)).join(eol + eol);
  }
}
/** Recovery is an explicit user-reviewed source proposal, never an automatic stringify commit. */
export function recoverProseSource(
  projection: RichProjection,
  next: PMNode,
): string {
  const before = projection.doc;
  let left = 0;
  while (
    left < before.childCount &&
    left < next.childCount &&
    before.child(left).eq(next.child(left))
  )
    left++;
  let oldRight = before.childCount,
    newRight = next.childCount;
  while (
    oldRight > left &&
    newRight > left &&
    before.child(oldRight - 1).eq(next.child(newRight - 1))
  ) {
    oldRight--;
    newRight--;
  }
  if (left === oldRight && left === newRight) return projection.source;
  const oldBlocks = projection.projection.blocks;
  const from = oldBlocks[left]?.from ?? projection.source.length,
    to = oldBlocks[oldRight - 1]?.to ?? from,
    eol = newlineAt(projection.source, from);
  const changed = [];
  for (let i = left; i < newRight; i++)
    changed.push(serialize(next.child(i), eol));
  let insert = changed.join(eol + eol);
  if (left === oldRight && insert) {
    if (from > 0) insert = eol + eol + insert;
    if (from < projection.source.length) insert += eol + eol;
  }
  return (
    projection.source.slice(0, from) + insert + projection.source.slice(to)
  );
}
