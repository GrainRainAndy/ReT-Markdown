# Scoped renderer R1–R3 fix re-review

Date: 2026-10-15. Scope is **only R1, R2 and R3** from `docs/testing/reviews/renderer-review.md`, using `docs/testing/renderer-fix-report.md`, current renderer files and current regression tests. This reviews the complete current new files directly; the old `renderer.diff` is not treated as the current implementation. The SHA-256 manifest below identifies the inputs. Task 4 findings and Task 3 main integration have separate ownership and do not reopen these renderer fixes.

## Spec verdict: PASS within R1–R3 scope

| Finding | Status | Current implementation and regression evidence |
| --- | --- | --- |
| R1 — escaped-pipe mapping crosses cells / non-finite ranges | **Resolved** | `positions.ts:41–69` splits cell-specific normalized source maps using markdown-it's immediate-preceding-backslash semantics. The wrapped table rule captures maps while list/quote prefix adjustments remain available (`:76–99`); the inline pass consumes the cell map directly (`:114–119`) rather than searching across the row. `inlineRange` checks safe integer bounds (`:28–34`), and remaining non-table alignment is bounded (`:123–142`). `render.test.ts:5–50` asserts the original exact math/image ranges, visible source for both formula errors, Unicode/CRLF coordinates, and a 64-fixture container/header/body/empty/short/excess-cell matrix. This repairs the wrong-cell cause as well as the invalid-number symptom. |
| R2 — unfinished list display math consumes outdented content | **Resolved** | `math.ts:73–95` stops before a nonempty line whose `sCount` is below `blkIndent`, computes an unclosed range through the last consumed line, and leaves the outdent to the enclosing parser. The guard precedes closing-delimiter detection. Blank lines and indented closures remain eligible. `render.test.ts:52–95` checks the exact original trigger, retained `Outside` paragraph and ranges `[2,9)` / `[19,21)`, sibling items, nested list/quote and UTF-16/CRLF boundaries, plus valid aligned math with an internal blank line. |
| R3 — remote placeholder changes encoded destination | **Resolved** | `markdown.ts:106–112` classifies and displays the parsed remote reference before calling `decodedPath`; resolver invocation remains below that branch. `render.test.ts:97–110` verifies HTTP(S) and protocol-relative encoded destinations in render and rich-copy HTML, no image element, no resolver call and no issue. Existing local Chinese/space-path tests continue to require decoding before local resolution. |

## Quality verdict: PASS within R1–R3 scope

The fixes address the reported causes without altering public helper signatures, authoritative source, styles or build configuration. R1 uses per-parse token identity in a WeakMap and validates content agreement instead of guessing a numeric fallback. Its table splitter matches the installed markdown-it 15.0.2 `escapedSplit`, including multiple preceding backslashes, trimming, optional edge pipes, padded short rows and ignored excess columns. CRLF translation still occurs through the original offset map. The broad focused matrix meaningfully protects the parser-version dependency.

R2's outdent check follows the parser's container indentation state and preserves the last actually consumed line for unclosed errors. R3 confines decoding to local resource resolution and retains HTML escaping for remote labels. Existing local URL restrictions, untrusted KaTeX settings and error-source rendering remain in place.

**No new renderer defect was identified within the three fixes and their affected mapping/math/image paths.** This is a bounded source-and-test re-review, not a claim that every possible Markdown input or final product gate has been exercised. The separate Task 4 live parser still differs from the renderer on backslash runs; that is documented as L1 in `task-4-review.md`, not an unresolved renderer R1.

## Verification and limits

The supplied RED/GREEN record covers the original failures and their fixes. Accepted existing verification: **39 renderer-focused tests** (37 renderer tests plus 2 build tests), renderer and full typechecks without diagnostics, and the later full-suite record **149 passed, 1 skipped**. The fix report's earlier full-suite result was 148 passed, 1 skipped. The gated export browser test remains unexecuted in those default suite results. These are recorded owner results, not newly rerun commands.

Read the current renderer implementation and all renderer regression tests; compared the cell-splitting algorithm with the installed parser. No already-recorded renderer suite/typecheck/build was rerun because inspection did not establish a concrete new renderer risk. Task 4's narrowly targeted in-memory probes additionally exercised current table rendering as the semantic control, but do not constitute a fresh R1–R3 regression-suite run.

No product files, shared build output, Git state or native UI were changed, and no subagents were used. Root wiring, full F19 same-viewport comparison, native IME/clipboard/export and performance acceptance remain with main verification. This report closes R1–R3 for the manifested source only.

## Current-file SHA-256 manifest

These are hashes of current files, not commit IDs or hashes attributed to the old captured diff. Inputs were checked again before report delivery.

```text
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
cf4db2faf461f505ec8b361a76cf7ad2af013272d50bd80c380c5387d6e2be72  docs/plans/2026-10-14-rendering.md
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
7d46683839db981ed9fe1d0332b8d234f3bc45c4637947780851e2b670482391  docs/testing/renderer-fix-report.md
59f256d4d266fd0a722775c2a01aaa1524e049209a062a974b9a7b8fe0b2d1a2  docs/testing/reviews/renderer-review.md
11d5aaddbf661d7380232fb603e206d1278e66f76bcca4a04f4dcbc96f6b8394  docs/testing/task-4-report.md
499649c0b497ed031bf21b1f29e5a53b9a49101d6f432eb13e68050ba754f860  node_modules/markdown-it/dist/markdown-it.mjs
ab263c54fb2bedfce5b3cd309b6f9f412d0936bd043ca9eddf10482ad79cd254  package-lock.json
45f1a3500562db03a4e1833bd8a44cc1d0fcd9c4ab79955409f45dea41b3664a  package.json
418757d66c1fce19982c495eed4ccddf8bc1b5b6e29f0914b57d6f4b1310d04f  web/src/render/assets.d.ts
36fcb034f975f93b73af938c27db1c2a5be6f58da8c089ea38bdf9c30234630f  web/src/render/markdown.ts
c1dd964695182497d101a0fff972fee68a45572c3cbfa15fa6f36be114d278f2  web/src/render/math.ts
f9838bedac84f0e76c4942c259f23dfb6f2ef87b98e6195ee22c5d177302076a  web/src/render/positions.ts
0707515fb6eb10004894a68e4fab24cbe54ee4b9fd472f99f457c11f1257a930  web/styles/fonts.css
9ee37568c72d8f4e4a85ad500a96a12b02d6c6c3670257bea8b63893e42c5582  web/styles/palette.css
067a5480e4ad528f3de2bca18284a545da05c2a2712ea1e60b96cedd476d320f  web/styles/print.css
26e03e0b3b16e2d9f9ffe88aa9c42fad982ea3b8218a5a22bc28c3523b7f850b  web/styles/typography.css
b5c849588529119f3aaa4fe6d56677d897525cd4f8a9f406bf0ca48ef759c768  web/test/build.test.ts
87eb9aad4a5c0af71f3bb3765a32348e19fcd0e7979dc8433427c1a3bb39f9c7  web/test/render.test.ts
```
