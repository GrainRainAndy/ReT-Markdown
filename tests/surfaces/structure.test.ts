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
  blockIntent,
} from "../../editor/surfaces/commands";
import { RichProjection } from "../../editor/surfaces/projection";
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

it("grows literal fences to preserve all intended body text and container ownership", () => {
  for (const eol of ["\n", "\r\n"])
    for (const prefix of ["", "> ", ">   "]) {
      const source = [
        prefix + "~~~js",
        prefix + "a",
        prefix + "b",
        prefix + "~~~",
      ].join(eol);
      const find = (nodes: any[]): any =>
        nodes.find((n) => n.type === "code") ??
        nodes.map((n) => find(n.children)).find(Boolean);
      const node = find(buildProjection(source).blocks);
      const body = "a\n~~~\n~~~~~~\nb\n";
      const intent = literalPatch(
        source,
        node,
        body,
        body.length - 2,
        body.length - 2,
        { kind: "code", id: "code" } as any,
      );
      const next = apply(source, intent);
      expect(find(buildProjection(next).blocks).text).toBe(body);
      const session = new DocumentSession(source);
      session.apply(intent.patches, intent.selection);
      expect(session.undo()).toBe(true);
      expect(session.source).toBe(source);
      expect(next).toContain("~~~~~~~js");
      expect(next.includes("\r\n")).toBe(eol === "\r\n");
    }
});
it("code insertion chooses a fence that cannot close inside selected content", () => {
  const source = "a\n```\n`````\nb";
  const intent = blockIntent(source, logical(0, source.length), "codeBlock")!;
  const next = apply(source, intent);
  const code = buildProjection(next).blocks.find((n) => n.type === "code")!;
  expect(code.text).toBe(source + "\n");
});
it("math collision refuses rather than silently truncating the literal body", () => {
  const source = "$$\na\nb\n$$",
    node = buildProjection(source).blocks[0]!;
  expect(() =>
    literalPatch(source, node, "a\n$$\nb\n", 2, 2, {
      kind: "math",
      id: "m",
    } as any),
  ).toThrow();
  expect(blockIntent("a\n$$\nb", logical(0, 7), "mathBlock")).toBeNull();
});
it("refuses longer math closing runs and CRLF math creation collisions", () => {
  for (const source of ["a\n$$$\nb", "a\r\n$$\r\nb", "a\r\n$$$$ \r\nb"])
    expect(
      blockIntent(source, logical(0, source.length), "mathBlock"),
    ).toBeNull();
});
it("preserves a fenced literal inside nested list and quote containers", () => {
  const source =
    "- item\r\n  > ~~~lang\r\n  > a\r\n  > b\r\n  > ~~~\r\n\r\nend";
  const projection = new RichProjection(source);
  const code = [...projection.records.values()].find(
    (r) => r.node.type === "code",
  )!.node;
  const intent = literalPatch(source, code, "a\n~~~~\nb\n", 7, 7, {
    kind: "code",
    nodeId: "nested",
  });
  const next = apply(source, intent);
  const after = new RichProjection(next);
  expect(
    [...after.records.values()].find((r) => r.node.type === "code")!.node.text,
  ).toBe("a\n~~~~\nb\n");
  expect(after.doc.firstChild?.type.name).toBe("bullet_list");
  expect(next.endsWith("\r\n\r\nend")).toBe(true);
});
