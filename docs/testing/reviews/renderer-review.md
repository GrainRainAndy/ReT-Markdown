# Independent renderer review

Reviewed 2026-10-15. Scope: the completed renderer captured in `docs/testing/reviews/renderer.diff`, against `docs/plans/2026-10-14-rendering.md`, the architecture's renderer contract, F08/F14/F16/F19/F20 and C19, and the fixed Typora GitHub visual baseline. Read the complete new-file package and `docs/testing/rendering-report.md`.

The current four `web/src/render/*` files and four `web/styles/*` files were compared byte-for-byte with their captured additions: all match. Root configuration/build files are reviewed as captured only; Task3 now owns their integration, and subsequent root changes require final integration review. This is not an application acceptance verdict. No Git, subagents, network requests, product edits, or existing test-suite reruns were used.

**Spec verdict: Changes required.** The captured implementation substantially delivers the requested APIs, offline rendering/resources and independent styles, but R1 violates the finite, exact UTF-16 issue-range contract; R2 violates nested block semantics and unfinished-formula feedback; R3 violates original remote-URL placeholder preservation. These remain renderer defects regardless of later root integration.

**Quality verdict: Changes required.** The renderer is compact, separates rendering/math/position mapping/styles, and uses escaping, explicit image resolution and bounded untrusted KaTeX appropriately. However, the position mapper guesses cell locations using a row-wide substring search without bounds validation, and the custom math block rule ignores its containing list's indentation boundary. Both have confirmed user-visible failures. Fix the underlying mapping and parser boundaries and add the targeted regression cases below before acceptance. No additional style-preference or unproved findings are raised.

## Findings

### R1 — P1: Escaped-pipe table mapping can target a later cell and return undefined/NaN ranges

**Location:** `web/src/render/positions.ts:54–63` (mapping selection); `web/src/render/positions.ts:28–29` (unchecked range construction). Affected consumers: `web/src/render/math.ts:22–24` and `web/src/render/markdown.ts:119–121`.

**Trigger:** This valid three-column GFM table contains an escaped pipe in the first body cell and two invalid formulas:

```markdown
| A | B | C |
| - | - | - |
|x\|$\oops$|x|$\oops$|
```

**Observed:** The expected formula ranges are `[32,39)` and `[42,49)`. The renderer returns `[42,49)` for the first formula and `{from: undefined, to: NaN}` for the second. The second formula's error span has `data-from="undefined" data-to="NaN"` and empty visible source. The first cell's unescaped inline content, `x|$\oops$`, matches across the second/third cell separator later in the raw row. The exact-match branch takes that occurrence and advances the cursor past the subsequent cells; the fallback then walks beyond its row limit. This is not an astral-character counting issue.

The same failure occurs with missing images:

```markdown
| A | B | C |
| - | - | - |
|x\|![a](a.png)|x|![a](a.png)|
```

Expected image ranges are `[32,43)` and `[46,57)`; actual ranges are `[46,57)` and `{from: undefined, to: NaN}`. Error navigation cannot identify both affected source locations, and the public `RenderIssue` numeric contract is broken. For formulas, the fallback also fails to preserve the expression visibly. This conflicts with the plan's exact source offsets and F08/F14/F16 error localization.

**Required action:** Map each inline table cell to its own raw cell span while accounting for escaped pipes; do not permit an exact match to cross cell boundaries. Keep fallback mapping within the known span and prevent non-finite ranges from escaping the renderer. A numeric fallback alone does not repair the wrong-cell mapping.

**Necessary regression:** For both examples, assert both exact `[from,to)` pairs, finite integer bounds within source length, and source slices equal to each complete original formula/image occurrence. Assert that both formula errors visibly retain `$\oops$`. Repeat with a Unicode prefix and CRLF to retain the existing coordinate guarantees. Existing escaped-pipe coverage has no cross-cell exact-match collision and therefore misses this trigger.

### R2 — P2: An unfinished display formula in a list consumes outdented document content

**Location:** `web/src/render/math.ts:73–84`.

**Trigger:**

```markdown
- $$
  x

Outside

$$
```

**Observed:** `renderMarkdown` returns `issues: []`. Its single formula inside the list has TeX annotation `x\n\nOutside`; there is no `<p>Outside</p>`. The closing delimiter outside the list is accepted as the list formula's closing delimiter, silently converting the intervening ordinary paragraph into math. A control with the closing `$$` indented inside the item correctly leaves `Outside` as a separate paragraph.

**Cause and impact:** The block rule scans to `endLine` without checking `state.sCount[line] < state.blkIndent` on nonempty lines. In markdown-it, the containing list also relies on individual block rules to stop at outdents; its `endLine` is not necessarily the end of the item. Consequently an incomplete formula can absorb unrelated document blocks and evade the math-error gate used for export. This violates the CommonMark-based container behavior, F03/F08 unfinished-formula handling and F16 error blocking.

**Required action:** Stop display-math scanning at a nonempty line outside its enclosing block indentation, leave that line for the containing parser, and return an unclosed-math issue restricted to the actual formula block. Preserve blank lines and properly indented multiline/aligned formulas.

**Necessary regression:** Assert that the trigger retains a separate `Outside` paragraph, reports the unclosed formula within the list, and does not include `Outside` in its formula content/range. Also assert that an indented closing delimiter remains valid and that a following sibling list item is not consumed.

### R3 — P2: Remote placeholders decode reserved URL characters and display a different destination

**Location:** `web/src/render/markdown.ts:106–110`.

**Trigger:**

```markdown
![a](https://example.org/a%2Fb%3Fq%3D1%23f.png)
```

**Observed:** Both `renderMarkdown` and `richClipboard` show `Remote image: https://example.org/a/b?q=1#f.png`; neither output contains `https://example.org/a%2Fb%3Fq%3D1%23f.png`. The resolver is correctly never called and the reference remains nonblocking, but decoding `%2F`, `%3F` and `%23` changes path/query/fragment meaning. A PDF derived from this HTML retains the wrong visible URL.

**Cause and impact:** `decodedPath` is applied before deciding whether the destination is remote. Local filesystem-path decoding is required, but it also changes remote URLs that must remain identifiable in placeholders under F14/F16 and the plan.

**Required action:** Classify remote references and emit their preserved destination before applying local path decoding. Keep the existing decoded Chinese/space-path resolver behavior for local images.

**Necessary regression:** For the trigger, assert that render and rich-copy HTML preserve the percent-encoded destination, contain no `<img>`, never call the resolver, and return no blocking image issue. Retain coverage of decoded local Chinese/space paths.

## Requirement and evidence assessment

| Area | Assessment of captured renderer |
| --- | --- |
| Source authority and pure APIs | The required exports/signatures are present. Rendering creates per-call state, derives HTML/text, and contains no file/network access or source-write path. Default source selection/copy and dirty-state handling belong to editor integration, not these helpers. |
| F08 / HTML and resource safety | CommonMark parsing plus selected GFM extensions, known-language highlighting and escaped unknown code are implemented. Raw HTML tokens are escaped; only plugin-generated disabled task checkboxes bypass escaping. KaTeX uses `trust:false`, finite expansion/size limits, and errors preserve source when ranges are valid. Explicit image resolution rejects HTTP(S)/network-file resolver outputs. No execution/request bypass was established in this review. R1/R2 prevent full syntax/error acceptance. |
| F14 / local and remote images | Local images require the supplied resolver; absent/failed resolution produces blocking issues and visible paths. Remote HTTP(S)/protocol-relative images produce nonblocking placeholders without resolver calls. Source ranges and original remote URL display fail for the concrete R1/R3 inputs. Native capability authorization and SVG sanitization remain host responsibilities under the architecture. |
| C19 / plain and rich copy | Helpers derive text and HTML without source mutation; rich output shares typography/palette CSS, uses self-contained MathML and supplies plain fallback. The reported normal list/table/formula cases are supported. R1 affects rich rendering and R3 changes its remote placeholder. Actual destination-application clipboard acceptance is not proven by the supplied checks and was explicitly not claimed by the author. |
| F19 / independent GitHub CSS and offline assets | Captured typography declarations match the fixed baseline's font stack, 16px/1.6 body, container breakpoints/padding, heading geometry, spacing, lists, quotes, tables and code. Palette changes preserve geometry. Captured build code copies four Open Sans faces, KaTeX fonts/CSS and upstream license notices from pinned dependencies. No remote font import appears in authored styles; no Typora implementation import appears in the package. Reported isolated browser checks cover offline resource loading and computed breakpoint geometry. Actual same-viewport Typora visual acceptance remains a final product check, as the baseline itself specifies. |
| F16 / print | Separate print CSS supplies 13px white output, A4 portrait, zero extra container padding, heading/short-code break hints and long-code/table wrapping. Native owns physical 20mm margins and overflow/error gating. Supplied Chromium evidence is appropriate for this renderer scope; exact WKWebView page boxes, searchable Chinese text, native export behavior and measured oversized-content handling remain integration acceptance gates, not renderer test results. |
| F20 / extension boundary | Typography, palette, fonts and print rules are separate. No user theme editor or source-changing style path was introduced. Light/dark palette rules share one file while remaining distinct from layout and print. |

## Verification performed and limits

Accepted the author's recorded **23/23 focused tests**, renderer typecheck, build and isolated Chromium result as existing evidence; none was rerun. The report correctly distinguishes those results from its then-incomplete root suite/typecheck snapshot. Those historic root failures are not new findings against the unchanged captured renderer or conclusions about Task3's later integration.

For the concrete parser/mapping risks, ran only Node assertions against a `write:false` in-memory esbuild bundle of the snapshot-matching renderer, using the installed dependencies and a raw-CSS loader. No build output or product test file was written. Assertions confirmed R1 for both formulas and images, R2's failing input and correctly indented control, and R3 in both render and rich-copy output. The command exited 0 because it asserted the observed defects; this is reproduction evidence, **not** a regression suite passing after fixes. Preliminary focused probes also checked escaped display endings, inline-link math, multiline image labels and inline HTML handling; no additional findings are asserted from those probes.

Only this review document was authored. Renderer/style fixes, regression additions and their verification remain necessary; final root/native/editor integration review remains separate.
