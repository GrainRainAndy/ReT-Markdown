# Task 6 — real paginated PDF

Updated 2026-10-15. Implemented and exercised the production WKWebView printing path on macOS 27.0.1 arm64. Unit tests, browser tests, native printing and sampled visual inspection are reported separately below.

## Changed paths and connections

- `Sources/ReTMarkdown/Export/PDFExporter.swift`
- `Sources/ReTMarkdown/Export/PrintProfile.swift`
- `web/src/export.ts`
- `web/src/export-main.ts`
- `web/test/export.test.ts`
- `Tests/ReTMarkdownTests/PDFTests.swift`
- This report, explicitly requested by the controller.

No Git operations, subagents, renderer stylesheet/config edits or shared build publication. Final proof resources were generated with the existing owner's `buildWeb({outdir:"/private/tmp/ret-task6-final-web"})`; shared `build/web` was read only. Main must publish the updated export bundle/app.

Native contract: `@MainActor PDFExporter.export(snapshot:Snapshot, assets:AssetManifest, to:URL) async throws`. The installer is `PDFExporter.install(on:manifest:webRoot:)`, with `manifest: @escaping @MainActor (Snapshot) async throws -> AssetManifest`. Task 2's AppDelegate connection uses Task 5's `NativeAssetIntegration.authorizedManifest(for:)`.

The separate page exposes `window.retExport.prepareExport(snapshot, assets)` and `window.retExport.validation()`. `export-main.ts` is bundled as a classic IIFE in `export.js`; `export.html` supplies the shared offline styles/fonts and CSP. No container ID is required: preparation creates `main.markdown-body[data-export-root]`. Asset-map URLs remain opaque; only original destination keys are adapted for Markdown escapes/percent encoding. Frozen manifest bytes are served by a separate `AssetSchemeHandler` registered for `ret-resource`.

## Implementation

The retained printing WebView has its own hidden window, nonpersistent data store and no editor bridge. It copies the committed snapshot and capability map, awaits primary fonts, local image decode and settled math layout, and blocks missing-local/math/readiness/overflow failures. Diagnostics retain UTF-16 ranges; the installer reveals a range only while the editor still has the exported revision. Remote images remain normal URL placeholders.

Preflight activates a build-time copy of the owner's print CSS. Native margins are not duplicated. Blocks that fit a page receive `break-inside:avoid-page`; long code/table blocks may fragment. Export-only font selection keeps the existing Latin/named monospace faces and selects the offline system Hiragino Sans GB face before generic CJK fallback, preserving literal Chinese PDF extraction/search.

Printing uses `webView.printOperation(with:)`, a fresh `NSPrintInfo`, `.save` and `.jobSavingURL` pointing to an exclusively created temporary sibling. Requested paper is 595.276 × 841.890 pt, margins 56.693 pt, scale 1; print/progress panels and headers/footers are disabled. AppKit's paper catalog reports 595 × 842 pt, within the specified ±0.5 pt tolerance.

The operation runs through public `runModal(for:delegate:didRun:contextInfo:)` with `canSpawnSeparateThread=true`; its completion callback returns to MainActor. The exporter keeps the WebView alive until completion. PDFKit validates the completed EOF trailer, every page's A4 box, minimum page count and first/last non-math text samples before an atomic POSIX sibling rename. Failure/cancellation removes the temporary file and preserves the old destination.

## RED evidence and corrections

- Initial web run failed because `export.ts` did not exist. Initial Swift runs could not compile while Task 2/5 interfaces were still landing; these are not claimed as executed behavioral tests.
- Encoded manifest-key/reference-image regression failed, then passed after key-only adaptation.
- Real browser preflight failed because local-file stylesheets deny CSSOM access. Importing the shared print CSS at build time removed that dependency.
- Native truncation regression proved PDFKit accepts pages without a final EOF marker. Explicit trailer validation now rejects that output and preserves the old PDF.
- The original native `operation.run()` remained active across the disconnected session for about 20 hours, generated no completed PDF and reached approximately 11 GB footprint. Stack sample: `/private/tmp/ret-task6-hung-sample.txt`. Only owned XCTest PID 5658 and swift-test PID 5522 were terminated; their associated WebContent PID 5662 also exited.
- Sampling showed repeated main-thread page rendering. [WebKit's printing implementation](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/mac/WKPrintingView.mm) returns an unknown/maximum page range on the main-thread preview path while awaiting asynchronous pagination. The public secondary-thread modal route completed actual printing. [AppKit documents that thread spawning requires this modal route](https://developer.apple.com/documentation/appkit/nsprintoperation/canspawnseparatethread).
- The first completed PDF failed strict text validation: PingFang emitted Kangxi radical code points (`中⽂分⻚`), and PDFKit literal searches returned zero. Explicit Hiragino fallback fixed body text; a strengthened native regression then caught the same problem inside code. Both body and code now retain literal Chinese, without normalizing the source or weakening validation.
- Independent temporary resources initially failed WebKit read access: Foundation standardized the entry from `/private/tmp` to `/tmp` while the allowed directory retained the other spelling. Canonicalizing both URLs consistently fixed the real navigation failure.
- Two full-suite save tests failed inside the sandbox: `SaveTests.testNativeSaveCapturesTokenBeforeResourcePreparationSuspends` (Cocoa 256) and `SaveTests.testUntitledAutosaveRetainsFormalDirtyButClearsAutosaveNeed` (Cocoa 512). Both passed in the approved unsandboxed full run; no Task 2 files were changed here.

## Final GREEN evidence

| Check | Actual result |
| --- | --- |
| `npx vitest run web/test/export.test.ts` | 11 passed; real-browser opt-in skipped by default |
| `RET_EXPORT_BROWSER=1 npx vitest run web/test/export.test.ts` | 12 passed, including real fonts/image decode, remote non-fetch, print styling, short/long code/table layout and overwide formula ranges |
| `npm test` | 9 files; 149 passed, 1 opt-in skipped |
| `npm run typecheck` | Passed |
| `swift test --filter PDFTests` with cache/scratch flags below | 8 passed, 1 native-runtime opt-in skipped |
| Full approved unsandboxed `swift test` | 66 tests; 65 passed, 1 native-runtime opt-in skipped; 0 failures |
| Native default runtime, final production sources | Passed in 0.349 s; 5 actual pages; literal body/code Chinese and final sentinel searchable with PDFKit |
| Native generated pagination fixture, final production sources | Passed in 0.477 s; 27 actual pages with frozen local SVGs, formulas, code and table |

Final full-suite logs: `/private/tmp/ret-task6-swift-full-final.log`, `/private/tmp/ret-task6-web-full-final.log`. Native fixture log: `/private/tmp/ret-task6-runtime-fixture-final.log`.

Swift commands used `--disable-sandbox --scratch-path /private/tmp/ret-task6-build --cache-path /private/tmp/ret-swiftpm`, with `CLANG_MODULE_CACHE_PATH` and `SWIFTPM_MODULECACHE_OVERRIDE` set to `/private/tmp/ret-clang`. Full native filesystem tests required execution outside the tool sandbox.

Every resumed runtime invocation used `/private/tmp/ret-task6-bounded.py`: a 60-second external `subprocess.wait` deadline, with TERM/KILL confined to that newly created test process group on timeout. It runs the already compiled XCTest bundle, so compilation is outside the print deadline. Final invocations completed normally; no timeout termination was needed.

Runtime environment:

```text
RET_PDF_RUNTIME=1
RET_EXPORT_WEB_ROOT=/private/tmp/ret-task6-final-web
RET_PDF_TEST_BUNDLE=/private/tmp/ret-task6-build/out/Products/Debug/ReTMarkdownTests.xctest
RET_PDF_FIXTURE_PATH=/Users/grainrain/Developer/GitHub/ReT-Markdown/build/fixtures/pagination.md
RET_PDF_PROOF_PATH=/private/tmp/ret-task6-pagination-proof.pdf
```

Omit `RET_PDF_FIXTURE_PATH` for the default sentinel/Chinese-code test. The helper's test selector is `ReTMarkdownTests.PDFTests/testRealWebKitPaginatedPrintWhenOptedIn`.

## Actual PDF artifacts and inspection

- `/private/tmp/ret-task6-native-proof.pdf`: 5 pages, including literal `FINAL_SENTINEL_中文` and code containing `"中文"`; PDFKit extraction and literal searches passed.
- `/private/tmp/ret-task6-pagination-proof.pdf`: 27 pages, 1,516,661 bytes. Poppler reports every MediaBox as 595 × 842 pt. Text extraction includes `PDF 分页验收` and `searchable code 中文`; an additional source/output comparison verified all 100 table rows in order and the complete final 1000-character wrapped code.
- `/private/tmp/ret-task6-pagination-proof.txt` and `...-bbox.html`: all-page extracted text/geometry. Word bounds: x=56.693…513.430 pt, y=57.442…780.708 pt; within the 20 mm printable bounds. PDFKit additionally checked every page box and completed text samples.
- `/private/tmp/ret-task6-page-{1,2,26,27}.png`: rendered and visually inspected. Math and local SVG are visible; short code stays together; table continues across pages; the final long code wraps without clipping. These samples show white pages and no added header/footer/page numbers.

Artifact SHA-256: pagination PDF `8dce9a0d683b57ac5661155b74a026c0103146f3871deb6682e186d447b0fdbf`; final independent `export.js` `47a2db814e8dd0a8394b40be95e95014d853b4d74544c8c5b8f8518eede08bc5`. Final process inspection found no active Task 6 XCTest/swift-test processes.

## Remaining acceptance work

Main still publishes the updated shared export bundle and app, then verifies the installed application's menu/save flow and error-range reveal UI. Actual live/source-mode equivalence and the dedicated page-end-heading/very-long-code-block native scenarios remain controller acceptance checks; the browser tests cover long-code fragmentation and overwide-formula blocking. Only pages 1, 2, 26 and 27 received visual inspection, although all page boxes/text bounds were checked.

The runtime timings above are individual Debug XCTest observations, not the required 20-run Release performance/RSS/app-size certification. No claim of complete application UI acceptance is made from unit or browser tests.
