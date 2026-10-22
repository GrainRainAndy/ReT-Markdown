import { expect, it } from "vitest";
import { RichProjection } from "../../editor/surfaces/projection";
import { literalPatch } from "../../editor/surfaces/commands";
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
