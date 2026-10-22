import { expect, it } from "vitest";
import { RichProjection } from "../../editor/surfaces/projection";
import {
  literalPatch,
  virtualCellIntent,
} from "../../editor/surfaces/commands";
import { DocumentSession } from "../../editor/core/document";
import { renderDocument } from "../../editor/render/document";

for (const eol of ["\n", "\r\n"])
  for (const [opening, prefix] of [
    ["", ""],
    ["> ", "> "],
    ["- ", "  "],
    ["- > ", "  > "],
  ])
    for (const fence of ["```js", "~~~js", "$$"])
      for (const ending of [
        "",
        eol,
        eol + prefix + (fence === "$$" ? "$$" : fence.slice(0, 3)),
      ]) {
        const source = opening + fence + ending;
        it(`edits empty literal with valid anchors ${JSON.stringify(source)}`, () => {
          const projection = new RichProjection(source);
          const node = [...projection.records.values()].find((r) =>
            ["code", "math"].includes(r.node.type),
          )!.node;
          const owner = {
            kind: node.type === "math" ? "math" : "code",
            nodeId: "literal",
          } as const;
          const session = new DocumentSession(source);
          const intent = literalPatch(source, node, "x", 1, 1, owner);
          session.apply(intent.patches, intent.selection);
          // A source with no existing line ending uses the document's LF default.
          const actualEol = ending ? eol : "\n";
          const closed = Boolean(node.attributes.closed);
          const expected =
            opening +
            fence +
            actualEol +
            prefix +
            "x" +
            (closed
              ? actualEol + prefix + (fence === "$$" ? "$$" : fence.slice(0, 3))
              : "");
          expect(session.source).toBe(expected);
          const next = [
            ...new RichProjection(session.source).records.values(),
          ].find((r) => r.node.type === node.type)!.node;
          expect(next.text).toBe(closed ? "x\n" : "x");
          expect(next.attributes.closed).toBe(closed);
          expect(session.selection.head.offset).toBe(expected.indexOf("x") + 1);
          session.undo();
          expect(session.source).toBe(source);
          session.redo();
          expect(session.source).toBe(expected);
          const enter = literalPatch(
            expected,
            next,
            closed ? "x\n\ny\n" : "x\n\ny",
            4,
            4,
            owner,
          );
          session.apply(enter.patches, enter.selection);
          expect(session.source).toBe(
            opening +
              fence +
              actualEol +
              prefix +
              "x" +
              actualEol +
              prefix +
              actualEol +
              prefix +
              "y" +
              (closed
                ? actualEol +
                  prefix +
                  (fence === "$$" ? "$$" : fence.slice(0, 3))
                : ""),
          );
        });
      }
for (const row of ["| one |", "| one | two | three | extra |"])
  it(`projects and exports header width for ${row}`, () => {
    const source = "| A | B | C |\n|---|---|---|\n" + row;
    const p = new RichProjection(source);
    expect(p.doc.firstChild!.child(1).childCount).toBe(3);
    expect(p.doc.firstChild!.child(1).textContent).not.toContain("extra");
    const html = renderDocument(source);
    expect(html.match(/<td>/g)).toHaveLength(3);
    expect(html).not.toContain("extra");
    expect(p.source).toBe(source);
  });
it("retains marks on linked images and strong inline math", () => {
  const p = new RichProjection(
    "[![logo](logo.png)](https://example.com) **$x$**",
  );
  expect(p.doc.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual([
    "link",
  ]);
  expect(p.doc.firstChild!.lastChild!.marks.map((m) => m.type.name)).toEqual([
    "strong",
  ]);
});
it("distinguishes same-line indentation from leading blank lines", () => {
  for (const source of ["  text", "  # title", "  > quote"])
    expect(
      new RichProjection(source).projection.blocks.map((n) => n.type),
    ).not.toContain("gap");
  expect(
    new RichProjection("  \n  text").projection.blocks.map((n) => n.type),
  ).toEqual(["gap", "paragraph"]);
});

for (const eol of ["\n", "\r\n"])
  for (const [opening, prefix] of [
    ["> ", "> "],
    ["> > ", "> > "],
    ["- > ", "  > "],
    ["- ", "  "],
  ])
    for (const fence of ["```", "~~~js", "$$"])
      it(`edits empty unclosed literal before outside block ${JSON.stringify([opening, fence, eol])}`, () => {
        const source = opening + fence + eol + "outside";
        const code = [...new RichProjection(source).records.values()].find(
          (r) => ["code", "math"].includes(r.node.type),
        )!.node;
        const owner = {
          kind: code.type === "math" ? "math" : "code",
          nodeId: "boundary",
        } as const;
        const session = new DocumentSession(source);
        const intent = literalPatch(source, code, "x", 1, 1, owner);
        session.apply(intent.patches, intent.selection);
        const expected = opening + fence + eol + prefix + "x" + eol + "outside";
        expect(session.source).toBe(expected);
        const next = [...new RichProjection(expected).records.values()].find(
          (r) => r.node.type === code.type,
        )!.node;
        expect(next.attributes.closed).toBe(false);
        expect(next.text).toBe("x");
        expect(session.selection.head.offset).toBe(expected.indexOf("x") + 1);
        const continued = literalPatch(expected, next, "x\n\ny", 4, 4, owner);
        session.apply(continued.patches, continued.selection);
        expect(session.source).toBe(
          opening +
            fence +
            eol +
            prefix +
            "x" +
            eol +
            prefix +
            eol +
            prefix +
            "y" +
            eol +
            "outside",
        );
        session.undo();
        expect(session.source).toBe(expected);
        session.undo();
        expect(session.source).toBe(source);
      });
for (const slashes of [1, 2, 3, 4])
  for (const column of [1, 2])
    it(`materializes column ${column} after ${slashes} trailing backslashes`, () => {
      const source =
        "| A | B | C |\n|---|---|---|\n| one " + "\\".repeat(slashes) + "|";
      const before = new RichProjection(source);
      const cell = before.projection.blocks[0]!.children[1]!.children[column]!;
      const session = new DocumentSession(source);
      const intent = virtualCellIntent(cell, "X", {
        kind: "cell",
        tableId: "table",
        row: 1,
        column,
      });
      session.apply(intent.patches, intent.selection);
      expect(session.source).toBe(
        source + (slashes % 2 ? " |" : "") + "  |".repeat(column - 1) + " X |",
      );
      const row = new RichProjection(session.source).doc.firstChild!.child(1);
      expect(row.childCount).toBe(3);
      expect(row.child(column).textContent).toBe("X");
      expect(row.child(0).textContent).toBe(
        before.doc.firstChild!.child(1).child(0).textContent,
      );
      session.undo();
      expect(session.source).toBe(source);
      session.redo();
      expect(
        new RichProjection(session.source).doc
          .firstChild!.child(1)
          .child(column).textContent,
      ).toBe("X");
    });
for (const eol of ["\n", "\r\n"])
  for (const [opening, prefix] of [
    ["> ", "> "],
    ["- > ", "  > "],
  ])
    it(`preserves an existing empty body prefix before the following block ${JSON.stringify([opening, eol])}`, () => {
      const source = opening + "```" + eol + prefix + eol + "outside";
      const node = [...new RichProjection(source).records.values()].find(
        (r) => r.node.type === "code",
      )!.node;
      const session = new DocumentSession(source);
      const intent = literalPatch(source, node, "x", 1, 1, {
        kind: "code",
        nodeId: "empty-line",
      });
      session.apply(intent.patches, intent.selection);
      expect(session.source).toBe(
        opening + "```" + eol + prefix + "x" + eol + "outside",
      );
      session.undo();
      expect(session.source).toBe(source);
    });
