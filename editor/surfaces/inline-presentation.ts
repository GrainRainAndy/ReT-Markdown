import type { LogicalSelection, SourceRange } from "../core/types";
import type { DocumentProjection, ProjectionNode } from "../syntax/projection";

const formats = new Set([
  "strong",
  "emphasis",
  "delete",
  "inlineCode",
  "link",
  "linkReference",
]);

/** Presentation-only ranges. Never normalize or serialize source from these. */
export function collectRevealRanges(
  projection: DocumentProjection,
  selection: LogicalSelection,
): SourceRange[] {
  if (
    selection.kind !== "text" ||
    !["prose", "cell"].includes(selection.owner.kind)
  )
    return [];
  const { offset, affinity } = selection.head;
  const ranges: SourceRange[] = [];
  const walk = (nodes: ProjectionNode[]): void => {
    for (const n of nodes) {
      const inside =
        (n.from < offset && offset < n.to) ||
        (offset === n.from && affinity === "after") ||
        (offset === n.to && affinity === "before");
      if (!inside) continue;
      if (formats.has(n.type)) ranges.push({ from: n.from, to: n.to });
      walk(n.children);
    }
  };
  walk(projection.blocks);
  return ranges;
}
