import { describe, it, expect } from "vitest";
import {
  minimalPatch,
  newlineAt,
  logical,
  enterIntent,
  backspaceIntent,
} from "../../editor/surfaces/editing";
import { DocumentSession } from "../../editor/core/document";
import { buildProjection } from "../../editor/syntax/projection";
function run(
  source: string,
  at: number,
  command: "enter" | "backspace",
  shift = false,
) {
  const session = new DocumentSession(source);
  session.setSelection(logical(at));
  const result =
    command === "enter"
      ? enterIntent(source, session.selection, buildProjection(source), shift)
      : backspaceIntent(source, session.selection, buildProjection(source));
  if (result) session.apply(result.patches, result.selection);
  return session;
}
describe("source intents", () => {
  it("splits and immediately rejoins a paragraph at one structure boundary", () => {
    expect(run("AlphaBeta\n\nkeep", 5, "enter").source).toBe(
      "Alpha\n\nBeta\n\nkeep",
    );
    expect(run("Alpha\n\nBeta\n\nkeep", 7, "backspace").source).toBe(
      "AlphaBeta\n\nkeep",
    );
  });
  it("uses block CRLF for new paragraph and hard break", () => {
    expect(run("AlphaBeta\r\n\r\nkeep", 5, "enter").source).toBe(
      "Alpha\r\n\r\nBeta\r\n\r\nkeep",
    );
    expect(run("AlphaBeta\r\n", 5, "enter", true).source).toBe(
      "Alpha  \r\nBeta\r\n",
    );
  });
  it("adds one newline per existing empty gap", () => {
    expect(run("A\n\n", 3, "enter").source).toBe("A\n\n\n");
  });
  it("expands a minimal changed range to whole graphemes", () => {
    expect(minimalPatch("é!", "è!")).toEqual({ from: 0, to: 2, insert: "è" });
    expect(minimalPatch("👨‍👩‍👧‍👦!", "x!")).toEqual({ from: 0, to: 11, insert: "x" });
  });
  it("keeps title split remainder ordinary and list continuation style", () => {
    expect(run("# AlphaBeta", 7, "enter").source).toBe("# Alpha\n\nBeta");
    expect(run("* item", 6, "enter").source).toBe("* item\n* ");
    expect(run("3. [x] item", 11, "enter").source).toBe("3. [x] item\n4. [ ] ");
  });
});
it("splits Setext heading into heading then ordinary paragraph without moving the original underline style", () => {
  expect(run("AlphaBeta\n=====  ", 5, "enter").source).toBe(
    "Alpha\n=====  \n\nBeta",
  );
});
it("empty nested item Enter and Backspace remove exactly the parent marker indentation", () => {
  const source = "10. A\r\n    * ";
  const p = buildProjection(source),
    s = logical(source.length);
  expect(enterIntent(source, s, p)!.patches).toEqual([
    { from: 7, to: 13, insert: "* " },
  ]);
  expect(backspaceIntent(source, s, p)!.patches).toEqual([
    { from: 7, to: 13, insert: "* " },
  ]);
});

it.each([
  ["* item", "* item  \n  ", "* item  \n  next\n* "],
  ["9. item", "9. item  \n   ", "9. item  \n   next\n10. "],
  ["* [x] item", "* [x] item  \n  ", "* [x] item  \n  next\n* [ ] "],
  ["> * item", "> * item  \n>   ", "> * item  \n>   next\n> * "],
  ["* A\n  * item", "* A\n  * item  \n    ", "* A\n  * item  \n    next\n  * "],
])(
  "hard break and subsequent Enter preserve the owning list: %s",
  (before, broken, continued) => {
    expect(run(before, before.length, "enter", true).source).toBe(broken);
    const source = broken + "next";
    const session = run(source, source.length, "enter");
    expect(session.source).toBe(continued);
    session.undo();
    expect(session.source).toBe(source);
    session.redo();
    expect(session.source).toBe(continued);
  },
);
it("list continuation uses CRLF and preserves an untouched following block", () => {
  const source = "* item\r\n\r\nkeep  ";
  expect(run(source, 6, "enter", true).source).toBe(
    "* item  \r\n  \r\n\r\nkeep  ",
  );
  const continued = "* item  \r\n  next\r\n\r\nkeep  ";
  expect(run(continued, 16, "enter").source).toBe(
    "* item  \r\n  next\r\n* \r\n\r\nkeep  ",
  );
});
it.each([
  ["* > item", "* > item  \n  > "],
  ["* A\n  > item", "* A\n  > item  \n  > "],
])("hard break retains quote nested inside list: %s", (before, after) => {
  expect(run(before, before.length, "enter", true).source).toBe(after);
});
