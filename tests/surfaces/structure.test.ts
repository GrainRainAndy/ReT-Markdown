import { it, expect } from "vitest";
import { DocumentSession } from "../../editor/core/document";
import { logical } from "../../editor/surfaces/editing";
import {
  headingIntent,
  indentIntent,
  tableIntent,
  tableClipboard,
  markIntent,
  clipboardRange,
  literalPatch,
} from "../../editor/surfaces/commands";
import { buildProjection } from "../../editor/syntax/projection";
const apply = (source: string, intent: any) => {
  const session = new DocumentSession(source);
  if (intent) session.apply(intent.patches, intent.selection);
  return session.source;
};
it("preserves Setext spacing/length for H2 and removes underline only when converting to ATX", () => {
  const source = "Title\r\n=====  \r\n\r\nkeep";
  expect(apply(source, headingIntent(source, logical(2), 2))).toBe(
    "Title\r\n-----  \r\n\r\nkeep",
  );
  expect(apply(source, headingIntent(source, logical(2), 3))).toBe(
    "### Title\r\n\r\nkeep",
  );
});
it("moves a list subtree under the previous sibling and restores it by outdent", () => {
  const source = "* A\n* B\n  * C\n\nkeep";
  expect(apply(source, indentIntent(source, logical(7), 1))).toBe(
    "* A\n  * B\n    * C\n\nkeep",
  );
  expect(
    apply(
      "* A\n  * B\n    * C\n\nkeep",
      indentIntent("* A\n  * B\n    * C\n\nkeep", logical(9), -1),
    ),
  ).toBe(source);
  expect(indentIntent(source, logical(2), 1)).toBeNull();
});
it("indents a reversed multi-item range once per subtree", () => {
  const source = "* A\n* B\n  * C\n* D";
  const intent = indentIntent(source, logical(source.length, 6), 1)!;
  expect(apply(source, intent)).toBe("* A\n  * B\n    * C\n  * D");
  expect(intent.selection.anchor.offset).toBeGreaterThan(
    intent.selection.head.offset,
  );
});
it("changes only the selected table and handles destructive row and column edges", () => {
  const source = "before\n\n| H | J |\n|---|:---:|\n| a | b |\n\nafter";
  const at = source.indexOf("a |");
  expect(apply(source, tableIntent(source, logical(at), "deleteRow"))).toBe(
    "before\n\n| H | J |\n| --- | :---: |\n\nafter",
  );
  const one = "| H |\n|---|";
  expect(apply(one, tableIntent(one, logical(2), "deleteColumn"))).toBe("");
  const promoted = apply(
    "| H |\n|---|\n| a |",
    tableIntent("| H |\n|---|\n| a |", logical(2), "deleteRow"),
  );
  expect(promoted).toBe("| a |\n| --- |");
});
it("copies body-only rectangles with a generated empty header and independent TSV", () => {
  const source = "| H | J |\n|---|---|\n| a | x |\n| b | y |";
  const result = tableClipboard(
    source,
    { fromRow: 1, toRow: 2, fromColumn: 0, toColumn: 0 },
    2,
  )!;
  expect(result.markdown).toBe("|  |\n| --- |\n| a |\n| b |");
  expect(result.text).toBe("a\nb");
});
it("expands only full strong selection for structural clipboard and toggles marks without duplicates", () => {
  const source = "**bold**";
  expect(clipboardRange(source, logical(2, 6))).toEqual({ from: 0, to: 8 });
  expect(clipboardRange(source, logical(3, 5))).toEqual({ from: 3, to: 5 });
  expect(apply(source, markIntent(source, logical(2, 6), "strong"))).toBe(
    "bold",
  );
});
it("preserves nested literal prefixes and literal payload when inserting lines", () => {
  const source = "> ~~~\n> x\n> ~~~";
  const node = buildProjection(source).blocks[0]!.children[0]!;
  const intent = literalPatch(source, node, "x\ny\n", 2, 2, {
    kind: "code",
    nodeId: "stable",
  })!;
  expect(apply(source, intent)).toBe("> ~~~\n> x\n> y\n> ~~~");
});
it("preserves reversed range and all untouched bytes for mixed ordered-task subtree indent", () => {
  const source = "9. [x] A\r\n10. B\r\n    * C\r\n11. D\r\n\r\nkeep";
  const s = logical(source.indexOf("D") + 1, source.indexOf("B"));
  const intent = indentIntent(source, s, 1)!;
  expect(apply(source, intent)).toBe(
    "9. [x] A\r\n\r\n   10. B\r\n       * C\r\n   11. D\r\n\r\nkeep",
  );
  expect(intent.selection.anchor.offset).toBeGreaterThan(
    intent.selection.head.offset,
  );
});
