# Final assets fix — FR-3

2026-10-15. Implemented the continued-reference-definition correction from
`docs/testing/reviews/final-review.md`. Focused native and grammar evidence is
recorded below; this is not whole-product or native GUI acceptance.

## Changed files and behavior

- `Sources/ReTMarkdown/Storage/AssetStore.swift`: changes are confined to
  `AssetReferences`. The scanner parses complete reference-definition blocks
  instead of requiring a destination on the colon's line. It lazily reads
  container-stripped continuation lines while retaining their original UTF-16
  offsets. Angle delimiters, whitespace, list/quote prefixes, titles and line
  breaks are excluded from destination ranges.
- `Tests/ReTMarkdownTests/AssetsTests.swift`: three new tests cover a 29-case
  grammar matrix, real image capability/frozen recovery/Save As warning behavior,
  and managed migration patches with exact mixed-EOL byte preservation.
- `docs/testing/final-assets-fix-report.md`: this report.

No other production/test files were edited by this task. No subagents, Git,
shared build output, app launch or publishing was used. The live FR-1/2/4 and
renderer-helper owner has no file overlap with these changes.

Plain, blockquote, list, nested-list and list/blockquote combinations now find
`[pic]:` followed by a destination on the next line. Four-space continuation is
accepted when it belongs to a valid definition; genuine code blocks remain
excluded. Definitions cannot interrupt a paragraph. Destination balancing,
escaped punctuation, angle destinations and same-line/continued titles are
validated before a definition reserves its label. The first valid definition
wins, including empty destinations; an empty destination blocks later duplicates
but grants no native image capability. Invalid definitions remain paragraph text.
Speculative title lookahead falls back to a valid destination-only definition
when markdown-it does, and does not consume the following paragraph. Definition
titles are excluded from inline image scanning. Label case normalization also
matches markdown-it's Unicode case expansion.

All downstream consumers continue to use the same scanner API. Native
authorization can therefore freeze the real continued-reference image; draft
recovery retains it; cross-directory Save As reports the unmanaged reference;
managed migration changes only the original destination span. Storage ordering,
recovery namespaces/epochs, asset lineage, wire identities, manifests, native
adapter finalization and scheme-handler behavior were not changed. A direct
comparison confirmed all AssetStore content before `AssetReferences` is byte
identical to its pre-fix capture. All 38 existing AssetsTests remain included.

## Actual RED / GREEN evidence

Artifacts and isolated package: `/private/tmp/ret-final-assets-fix/`.

| Evidence | Actual result |
| --- | --- |
| `red.log` | Before production edits: 3 new tests, 13 failures. Continued destinations were omitted, malformed/duplicate definitions selected incorrectly, capability was absent and the managed migration patch was missing. |
| `green-first.log` | Parser matrix and all existing R5 tests passed; one new integration fixture failed `invalidSource` because its test Snapshot omitted newline metadata. The fixture now uses SourceCodec.decode. This was a test construction error, not a product regression. |
| `red-combined-container.log` | Added valid compound list/blockquote boundary case: 1 failure before its prefix handling was added. |
| `red-container-code.log` | Added genuine indented code inside that container: 1 failure before preserving the quote's code indentation. |
| `red-final-coverage.log` | Final tests against the unchanged pre-fix AssetStore capture, only in scratch: 3 tests, 21 failures. The capability assertion now does not short-circuit, explicitly exposing the missing Save As warning and missing frozen draft bytes as well as the missing managed patch. No workspace product code was reverted. |
| `green-final.log` | All 41 AssetsTests passed, zero failures, 0.212 s test runtime. |
| `green-current-dependencies.log` | Refreshed current native dependencies: **41 tests, zero failures**, exit 0, 0.210 s test runtime, completed 23:13:45 +0800. |

The final run with refreshed current native dependencies is recorded separately
in `green-current-dependencies.log`. The controller
owner changed MarkdownDocument's class declaration while this work ran; this
task did not edit that file. The final dependency refresh avoids attributing a
stale dependency snapshot to the latest run.

New test entry points:

```text
testFinalContinuedDefinitionsMatchGrammarAndOriginalUTF16Ranges
testFinalContinuedLocalImagesAuthorizeFreezeAndWarnForSaveAs
testFinalManagedContinuedDefinitionsPatchOnlyDestinationBytes
```

The native integration test uses an actual safe SVG on disk, authorizes and
serves its frozen bytes, checks `unmanagedBrokenReferences`, and persists/reopens
a complete draft generation. The managed test checks the exact UTF-16 patch
range and encoded candidate bytes, preserving the surrounding angle delimiters,
title, non-ASCII text, CRLF/CR metadata and unrelated source.

## Grammar and export resource preflight probes

`Scanner.swift` is extracted from the unchanged current production scanner and
AssetReference type, not a reimplementation. `grammar-cases.json` comes from
the native test matrix. The probe verifies source slices at every returned
UTF-16 range. `grammar-parity.mjs` compares those destinations with installed
markdown-it 15.0.2 configured with the application's HTML/task-list/scheme policy,
and also bundles the actual production renderer in memory (`write:false`).

**29/29 cases agree.** Cases include plain/quoted/list/nested/compound containers,
four-space continuation, angle/escaped destinations, continued titles,
full/collapsed/shortcut images, first-valid duplicates, invalid destinations and
titles, forbidden schemes, Unicode labels, blank-line boundaries, paragraph
non-interruption and real indented/fenced code. Native-discovered capability keys
remove the production renderer's missing-image preflight issue for valid local
references; an empty-map control produces the issue. A deliberately empty first
definition remains unresolved and is not claimed to have an image capability.

Probe data: `scanner.json`, `scanner-compile.log`, `grammar-parity.json`, and the
retained scripts. Initial probe map normalization was corrected to account for
the renderer's decoded resolver keys; no production renderer change was made.

## Reproduction and limits

```sh
python3 /private/tmp/ret-final-assets-fix/run.py verification AssetsTests
python3 /private/tmp/ret-final-assets-fix/refresh-probes.py
swift -module-cache-path /private/tmp/ret-final-assets-fix/scanner-modules \
  /private/tmp/ret-final-assets-fix/Scanner.swift \
  /private/tmp/ret-final-assets-fix/grammar-cases.json \
  > /private/tmp/ret-final-assets-fix/scanner.json
node /private/tmp/ret-final-assets-fix/grammar-parity.mjs
```

The runner bounds build+test process groups to 120 seconds and kills the group
on timeout; all actual runs completed normally. The extracted scanner probe was
bounded to 45 seconds. Package, scratch, cache and module cache are isolated
under the private directory; native sources are copied, AppMain is omitted and
a packaging-only Bundle.module shim is used. Only inaccessible SwiftPM user-cache
warnings remain. `source-hashes-before.json` and `source-hashes-final.json` retain
the dependency/source captures. A post-run comparison found no changes to the
captured workspace sources, and both owned source files match the tested copies.

This establishes native resource discovery, frozen capability/draft handling,
migration/warning data and the shared renderer's resource-preflight behavior.
It does not operate the native Save As warning sheet, print a PDF, launch the
packaged app, or certify the separate live/IME/Release acceptance gates. Grammar
parity covers the listed cases; this scanner is not a replacement CommonMark
parser for every extension.
