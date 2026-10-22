import { it, expect } from "vitest";
import { DocumentSession } from "../../editor/core/document";
import { logical } from "../../editor/surfaces/editing";
import { indentIntent, literalPatch } from "../../editor/surfaces/commands";
import { RichProjection } from "../../editor/surfaces/projection";
import { recoverProseSource } from "../../editor/surfaces/recovery";
import { schema } from "../../editor/surfaces/projection";
function apply(source: string, intent: any) {
  const d = new DocumentSession(source);
  d.apply(intent.patches, intent.selection);
  return d.source;
}
it("keeps unchanged literal identity through edits before it and maps split paragraph replacement identities", () => {
  const before = new RichProjection("AlphaBeta\n\n~~~\nx\n~~~");
  const code = [...before.records.values()].find(
    (r) => r.node.type === "code",
  )!;
  const after = new RichProjection("Alpha\n\nBeta\n\n~~~\nx\n~~~", before, {
    from: 5,
    to: 5,
    insert: "\n\n",
  });
  expect(
    [...after.records.values()].find((r) => r.node.type === "code")!.id,
  ).toBe(code.id);
  const paragraph = [...before.records.values()].find(
    (r) => r.node.type === "paragraph",
  )!;
  expect(after.replacements.get(paragraph.id)?.length).toBe(2);
});
it("recovers an unsupported PM structure change as a local explicit source proposal", () => {
  const original = "\uFEFF# keep\r\n\r\nold\r\n\r\n<!-- untouched -->";
  const projection = new RichProjection(original);
  const children = [];
  projection.doc.forEach((n) => children.push(n));
  const next = schema.nodes.doc!.create(null, [
    projection.doc.child(0),
    schema.nodes.blockquote!.create(
      null,
      schema.nodes.paragraph!.create(null, schema.text("new")),
    ),
    projection.doc.child(2),
  ]);
  expect(recoverProseSource(projection, next)).toBe(
    "\uFEFF# keep\r\n\r\n> new\r\n\r\n<!-- untouched -->",
  );
});
it("does not select an ancestor item when only descendant text is selected", () => {
  const source = "* A\n  * B\n  * C";
  const intent = indentIntent(source, logical(14, 15), 1)!;
  expect(apply(source, intent)).toBe("* A\n  * B\n    * C");
});
it("owns terminal LF in indented code and preserves original indentation when editing it", () => {
  const source = "    x\n\nnext";
  const projection = new RichProjection(source);
  const code = [...projection.records.values()].find(
    (r) => r.node.type === "code",
  )!.node;
  expect(code.text).toBe("x\n");
  expect(
    apply(
      source,
      literalPatch(source, code, "x\ny\n", 3, 3, {
        kind: "code",
        nodeId: "code",
      }),
    ),
  ).toBe("    x\n    y\n\nnext");
});
it("preserves different old quote prefixes outside a local multiline literal edit", () => {
  const source = "> ~~~\n> a\n>b\n> ~~~";
  const projection = new RichProjection(source);
  const code = [...projection.records.values()].find(
    (r) => r.node.type === "code",
  )!.node;
  expect(
    apply(
      source,
      literalPatch(source, code, "A\nb\n", 1, 1, {
        kind: "code",
        nodeId: "code",
      }),
    ),
  ).toBe("> ~~~\n> A\n>b\n> ~~~");
});
it("preserves literal identity when inserting a paragraph exactly at its starting offset", () => {
  const before = new RichProjection("~~~\nx\n~~~");
  const code = [...before.records.values()].find(
    (r) => r.node.type === "code",
  )!;
  const after = new RichProjection("new\n\n~~~\nx\n~~~", before, {
    from: 0,
    to: 0,
    insert: "new\n\n",
  });
  expect(
    [...after.records.values()].find((r) => r.node.type === "code")!.id,
  ).toBe(code.id);
});
it("empty raw document has a valid source mapping at its BOM-aware insertion point", () => {
  const p = new RichProjection("\uFEFF");
  expect(p.sourceAt(1)).toBe(1);
});
it("deletes displayed entities and escapes as whole semantic graphemes", () => {
  const p = new RichProjection("A&amp;中\\*");
  expect(p.deletionRange(1, false)).toEqual({ from: 1, to: 6 });
  expect(p.deletionRange(6, true)).toEqual({ from: 1, to: 6 });
  expect(p.deletionRange(9, true)).toEqual({ from: 7, to: 9 });
});
