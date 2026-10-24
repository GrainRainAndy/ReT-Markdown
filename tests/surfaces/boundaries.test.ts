import { it, expect } from "vitest";
import { DocumentSession } from "../../editor/core/document";
import { logical } from "../../editor/surfaces/editing";
import {
  indentIntent,
  literalPatch,
  expandLiteralSelection,
} from "../../editor/surfaces/commands";
import { RichProjection } from "../../editor/surfaces/projection";
import { recoverProseSource } from "../../editor/surfaces/recovery";
import { schema } from "../../editor/surfaces/projection";
it("keeps a typed bare ATX marker editable until a separator is present", () => {
  const before = new RichProjection("");
  const pending = new RichProjection(
    "#",
    before,
    { from: 0, to: 0, insert: "#" },
    1,
  );
  expect(pending.doc.firstChild!.type.name).toBe("paragraph");
  expect(pending.doc.textContent).toBe("#");
  expect(pending.sourceAt(pending.positionAt(1))).toBe(1);
  const title = new RichProjection(
    "# ",
    pending,
    { from: 1, to: 1, insert: " " },
    2,
  );
  expect(title.doc.firstChild!.type.name).toBe("heading");
  expect(title.sourceAt(title.positionAt(2))).toBe(2);
  expect(new RichProjection("#").doc.firstChild!.type.name).toBe("heading");
});
it.each(["A ", "A   ", "**A** ", "* A ", "> A ", "   ", "A\r\n\r\n   "])(
  "retains editable trailing spaces: %j",
  (source) => {
    const p = new RichProjection(source);
    const count = / +$/.exec(source)![0].length;
    expect(p.doc.textContent.endsWith(" ".repeat(count))).toBe(true);
    const positions = [];
    for (let at = source.length - count; at <= source.length; at++) {
      positions.push(p.positionAt(at));
      expect(p.sourceAt(p.positionAt(at))).toBe(at);
    }
    expect(new Set(positions).size).toBe(count + 1);
  },
);
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
it("expands rich cross-literal selections in both directions but leaves literal/source ranges exact", () => {
  const source = "before\n\n~~~\nx\n~~~\n\nafter";
  expect(expandLiteralSelection(source, logical(14, 19))).toEqual(
    logical(8, 19),
  );
  expect(expandLiteralSelection(source, logical(12, 6))).toEqual(
    logical(17, 6),
  );
  expect(
    expandLiteralSelection(source, logical(12, 14, { kind: "source" })),
  ).toEqual(logical(12, 14, { kind: "source" }));
  expect(
    expandLiteralSelection(
      source,
      logical(12, 14, { kind: "code", nodeId: "c" }),
    ),
  ).toEqual(logical(12, 14, { kind: "code", nodeId: "c" }));
});
it("maps word and line deletion through semantic text rather than one grapheme", () => {
  const source = "hello world\nsecond line",
    p = new RichProjection(source);
  expect(p.deletionRange(11, true, "word")).toEqual({ from: 6, to: 11 });
  expect(p.deletionRange(11, true, "line")).toEqual({ from: 0, to: 11 });
  expect(p.deletionRange(source.length, true, "line")).toEqual({
    from: 12,
    to: source.length,
  });
  expect(p.deletionRange(0, false, "word")).toEqual({ from: 0, to: 5 });
});
it.each(["* item  \n  ", "9. item  \r\n   ", "> * item  \n>   "])(
  "empty hard-break continuation has its own mapped position: %s",
  (source) => {
    const p = new RichProjection(source);
    expect(p.doc.textBetween(0, p.doc.content.size, "\n", "\n")).toContain(
      "item\n",
    );
    expect(p.sourceAt(p.positionAt(source.length))).toBe(source.length);
  },
);
