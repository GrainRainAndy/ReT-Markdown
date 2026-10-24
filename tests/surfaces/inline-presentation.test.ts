import { it, expect } from "vitest";
import { collectRevealRanges } from "../../editor/surfaces/inline-presentation";
import { buildProjection } from "../../editor/syntax/projection";
import { RichProjection } from "../../editor/surfaces/projection";
import { logical } from "../../editor/surfaces/editing";

it("reveals only the head's format and ancestors, respecting boundary affinity", () => {
  const p = buildProjection("**a *b* c** and *d*");
  expect(collectRevealRanges(p, logical(5))).toEqual([
    { from: 0, to: 11 },
    { from: 4, to: 7 },
  ]);
  expect(collectRevealRanges(p, logical(12, 5))).toEqual([
    { from: 0, to: 11 },
    { from: 4, to: 7 },
  ]);
  expect(collectRevealRanges(p, logical(11))).toEqual([]);
  const end = logical(11);
  end.head.affinity = "before";
  expect(collectRevealRanges(p, end)).toEqual([{ from: 0, to: 11 }]);
  expect(collectRevealRanges(p, logical(5, 5, { kind: "source" }))).toEqual([]);
});
it.each([
  ["**bold**", 3],
  ["__bold__", 3],
  ["*em*", 2],
  ["~~gone~~", 3],
  ["``a`b``", 3],
  ["[label](https://example.com)", 3],
  ["[label][ref]\n\n[ref]: /target", 3],
  ["**a *b* c**", 5],
])(
  "keeps revealed markers as exact editable source positions: %s",
  (source, at) => {
    const ranges = collectRevealRanges(buildProjection(source), logical(at));
    const p = new RichProjection(source, undefined, undefined, at, ranges);
    const fragment = source.slice(ranges[0]!.from, ranges[0]!.to);
    expect(p.doc.firstChild!.textContent).toBe(fragment);
    for (let offset = 0; offset <= fragment.length; offset++)
      expect(p.sourceAt(p.positionAt(offset))).toBe(offset);
    expect(p.markerRanges.length).toBeGreaterThan(0);
  },
);

it("keeps link destination escapes/entities and padded code delimiters literal", () => {
  for (const source of ['[标签](a\\(b\\) "&amp;")', "`` a`b ``"]) {
    const at = source.startsWith("[") ? 2 : 4;
    const ranges = collectRevealRanges(buildProjection(source), logical(at));
    const p = new RichProjection(source, undefined, undefined, at, ranges);
    expect(p.doc.firstChild!.textContent).toBe(source);
    for (let offset = 0; offset <= source.length; offset++)
      expect(p.sourceAt(p.positionAt(offset))).toBe(offset);
  }
});
