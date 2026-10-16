# Renderer review fixes

Date: 2026-10-15. Addresses R1/P1, R2/P2 and R3/P2 in
[renderer-review.md](reviews/renderer-review.md), which was read before implementation.
Used systematic debugging and TDD: reproduced the listed triggers in regression
tests before changing production code, then fixed and verified each cause.

## R1: exact table source mapping

The old row-wide substring search could match a later cell boundary after an
escaped pipe changed the inline content. Its subsequent character search could
walk beyond the row, producing `undefined`/`NaN` offsets.

The table block rule now records each cell's normalized-source character indices
while enclosing list/blockquote prefixes are still represented by `bMarks` and
`tShift`. Cell splitting follows the installed markdown-it 15.0.2 rule: an
unescaped pipe separates cells; an immediately preceding backslash is removed
from an escaped pipe, including in runs of backslashes. Each UTF-16 code unit
retains its own index. Edge pipes, whitespace trimming, empty cells, padded short
rows and ignored excess columns follow the parser's behavior.

The inline pass consumes those cell-specific maps directly and translates through
the original CRLF offset map. It does not search other cells or substitute guessed
numeric positions. Mapping/content invariants and range checks reject inconsistent
maps instead of emitting non-finite ranges; remaining non-table alignment also
checks its known source bound. This relies on the pinned parser's table semantics;
the regression matrix protects that assumption when dependencies change.

The review's exact formula ranges are now `[32,39)` and `[42,49)`; image ranges are
`[32,43)` and `[46,57)`. Both formula error spans visibly preserve `$\oops$`, also
in rich clipboard HTML. Tests assert original source slices, safe integer bounds,
Unicode/CRLF coordinates, and container/header/body variants. The four container
tests additionally exercise 64 table fixtures, including escaped pipes inside
formulas and image destinations.

## R2: display-math container boundary

The scanner previously used the supplied `endLine` as the list-item boundary even
though markdown-it can supply a later document boundary. It now stops before a
nonempty line with `sCount < blkIndent`, matching the container boundary used by
the installed fenced-code rule. An unclosed block ends at the last consumed line;
the outdented line remains available to the enclosing parser.

For the review input, `Outside` remains a separate paragraph and the two unclosed
formula ranges are `[2,9)` and `[19,21)`. The first slice is `$$\n  x\n`, excluding
`Outside`. Tests also cover sibling list items, nested lists/quotes, immediate
outdented math, UTF-16/CRLF, and correctly indented aligned math with blank lines.

## R3: remote URL identity

Remote classification now examines the parsed destination before local path
decoding. The placeholder preserves `a%2Fb%3Fq%3D1%23f.png` in both rendering and
rich clipboard HTML, including protocol-relative destinations. Tests assert no
`<img>`, no resolver call and no blocking issue for those references. Existing
Chinese/space-path tests still verify decoded local destinations reach the resolver.

## RED / GREEN evidence

All commands ran against installed dependencies without network access.

| Stage / command | Result |
| --- | --- |
| RED: `npm exec -- vitest run web/test/render.test.ts`, before production edits | 8 failed, 22 passed. Four R1 cases returned later-cell ranges plus `undefined`/`NaN`; two R2 cases consumed paragraphs/siblings; two R3 cases decoded reserved URL characters. The properly indented math control passed. |
| GREEN after the three fixes, same initial test command | 30 passed. |
| Final expanded renderer tests | 37 passed, including 16 review regression cases. |
| `npm run test:render` | 39 passed across renderer and build test files. |
| `npm run typecheck:render` | Exit 0, no diagnostics. |
| `npm run typecheck` | Exit 0, no diagnostics. |
| `npm test` | 9 files passed; 148 tests passed, 1 skipped. |

The skipped test is `checks real browser fonts, image decode, print wrapping and
formula overflow`, gated by `RET_EXPORT_BROWSER=1`. Native/browser visual and
export acceptance remain separate integration checks. Root configuration was not
changed; its current typecheck passed.

## Changed paths and scope

- `web/src/render/positions.ts` — cell-bounded source maps and invariant checks.
- `web/src/render/math.ts` — stop display math at enclosing outdents.
- `web/src/render/markdown.ts` — preserve remote destinations before local decoding.
- `web/test/render.test.ts` — review triggers and boundary regression coverage.
- `docs/testing/renderer-fix-report.md` — this report.

No other source/config/style files were edited. No Git commands, subagents or
remote requests were used. Build tests supplied a temporary `/private/tmp` outdir
and cleaned it afterward; shared `build/web` was not written or published. Source
text remains authoritative, with no source mutation or product-scope additions.
