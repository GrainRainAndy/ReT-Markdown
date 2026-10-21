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
