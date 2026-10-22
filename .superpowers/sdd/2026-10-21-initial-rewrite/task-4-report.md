# Task 4 implementation report

2026-10-23, Asia/Shanghai. Implementation base **9ce5638**, branch `rewrite/from-zero`. Controller-only intervening commits `32a3a2e`, `0c6b210`, `d25093e` are not this implementation. No subagents, legacy product source, root README/spec edits, push or merge. Existing modified Task 2 scratch report and controller plan-checkbox edits remain unstaged.

Status: **DONE_WITH_CONCERNS**. Required asset/PDF production services are implemented and automated checks pass. Actual native GUI observation remains unavailable because the controller's native CUA `getApp` timed out (-10005); no AppleScript/CGEvent or other UI-automation bypass was used. This report is implementation evidence, not self-approval of final application acceptance.

## Implemented behavior

### Offline rendering prerequisite

The initial actual bundled `file://` WKWebView rejected `new Worker(fileURL)` with a worker `onerror`. Chromium HTTP success was not used as a substitute. `EditorHost.installBundledWorker` now reads only the app's packaged `render-worker.js`, safely JSON-encodes it into a main-frame-only document-start WKUserScript, and defines a read-only `retRenderWorkerSource` property. The existing renderer constructs a classic Blob worker from those trusted bytes in the native host; ordinary browser development retains its URL-worker route. CSP adds `blob:` to **worker-src only**. Each render job still has its own terminable worker, original 1500 ms queue-inclusive deadline, max two active jobs, cancellation and stale-result suppression. There is no main-thread KaTeX fallback.

`WebKitRenderTests.testBundledFileWorkerActuallyTypesetsKaTeX` loads the signed app's actual `Contents/Resources/web/index.html` with `loadFileURL`, uses its packaged worker source, and asserts actual `class="katex"`, frozen Chinese heading and absence of a source-fallback marker. Production fixture export independently exercises the full bridge → 1500 ms renderer → independent print WebView route successfully.

### Images and journal

`Assets.swift` owns image validation, persistent managed ownership/import/save journals and document integration. It supports PNG/JPEG/GIF via ImageIO and a conservative static SVG whitelist; rejects script/event/external/entity/foreign-object SVG content, traversal, unauthorized capability hosts and symlinks. Raster input is bounded to 30 MB, 32768 per dimension, 40 million aggregate decoded frame pixels and 1000 frames; SVG XML depth/node count and request sizes are bounded. Clipboard extraction deliberately reads image formats even when text is present, with bounded TIFF → PNG normalization for common screenshots. Missing/unsupported clipboard content returns an error without an insertion.

File picker, web image paste and rich/source image drop all feed the same import service. Drop uses its actual editor coordinate to capture the insertion bookmark. Empty `importImage` remains the picker; `source:'clipboard'` remains explicit Paste Image; dataURL/fileName remains the web file path. The native picker checks file size and uses scoped access before reading. The source file is only read, never moved or replaced. Native reports an asset result **after** a complete copy has installed; web inserts one root transaction through the existing cancellable bookmark. Special spaces, Chinese, parentheses, `#` and `%` survive as encoded Markdown path components. The raw native path is encoded before web validation, avoiding rejection/double encoding of a literal percent in filenames.

Each import records an operation ID, stable unique destination, hash and approved source roots before installation. Same-operation retry returns the same path and rejects different bytes. Copies use descriptor-relative `openat`/`O_NOFOLLOW` traversal, bounded regular-file reads, a fully written/fsynced sibling temporary file and exclusive atomic rename. Existing different bytes are never overwritten, including concurrent name collisions. Temporary files clean up on failure; a partially prepared migration retains its journal and original staging bytes for retry. Reference deletion/undo has no resource deletion path.

Drafts use document-specific staging and stable `<draftID>.assets/` relative paths. Per the explicit controller ruling (also committed in `0c6b210`), first save and SaveAs preserve those existing relative paths and change the authorized root after successful document commit. New images imported into an already saved document use `<current document name>.assets/`. This may retain multiple managed asset directories, intentionally preserving source/history instead of rewriting Markdown.

Save freezes a parser-derived asset manifest for the exact snapshot, prepares only its managed resources, then delegates document replacement to existing NSDocument save coordination. Successful body commit updates ownership roots and the saved baseline. N+1-only assets retain their old staging/root capability until a subsequent save installs them; N+1 source remains dirty when N saves. Failure/cancel before document commit leaves fileURL/saved identity unchanged. Ordinary relative references that would change or fail at the destination are listed in a native alert with **Cancel** or explicit **Keep original references and save**; they are not bulk copied. Missing images show their path. Remote image URLs remain source text and become placeholders without fetching.

Managed ownership survives reopened NSDocument IDs through persistent URL ownership and journals. Recovery copies clone their old record ID's persistent asset roots into the new ID, including unresolved draft assets and original ordinary-reference roots. A file renamed while the app was closed can rediscover managed assets within its already authorized directory; existing asset directory names remain stable. Committed save transactions are retired when preparing newer work rather than accumulating every source snapshot indefinitely.

### Manifest/capability protocol integration

Existing envelope documentId/epoch/requestId validation remains authoritative. New native `collectAssets {source,revision}` receives web `assetManifest {paths,revision}` for that exact immutable source, using the real parser to resolve image reference definitions while excluding code/prose/unrelated links. Native matches request ID and revision, bounds list/string sizes, times out and cancels pending requests on session invalidation. Renderer paths never authorize filesystem roots.

Native `load` adds `assetToken`, an unguessable per-store capability host. Live render and frozen worker output use `ret-asset://<capability>/<encoded path components>`. Native resolves only the matching token within native-owned roots. Export's scheme handler has only an immutable dictionary of frozen validated image bytes, never a general filesystem resolver.

### Production PDF

`Export.swift` owns `PDFResources`, `PDFPrintJob`, `PDFCommitCoordinator` and the document export controller. After flush, the host captures the exact source/revision, parser image manifest, validated image bytes and packaged KaTeX CSS/font bytes **before** requesting asynchronous HTML rendering. Later editing or external file mutation cannot alter that job's bytes. The editor's mutable DOM is never printed.

An independent nonpersistent WKWebView loads a test/job-owned local print directory. Strict native CSP blocks scripts/network/images outside the frozen ret-asset capability. Native DOM inspection rejects a real `<pre data-render-state='timeout|unavailable|error|cancelled'>` fallback and formula-error elements; escaped user text containing that marker is allowed. Fonts and image readiness await success or explicit failure. Missing images become readable path placeholders. Wide formulas scale with visible feedback; needing below 35% fails visibly instead of clipping. Local CSS wraps long code/URLs and permits code/table pagination. Trailing paragraph margin no longer creates a blank final page.

Printing uses public `WKWebView.printOperation(with:)`, `canSpawnSeparateThread = true` and asynchronous `runModal(for:delegate:didRun:contextInfo:)` with an independent hidden print window. The completion selector actually runs on the print thread, so it explicitly hops to MainActor before inspecting output or cleaning WebKit/window state. The editor remains usable; export progress is a nonmodal child panel with Cancel. The operating-system spool may finish after cancellation, but its disk commit is prohibited and its temporary file is cleaned when printing unwinds. WebContent failure cancels commit and defers WebKit teardown until an active print operation unwinds.

NSPrintInfo is the single physical margin authority: A4 portrait, four 20 mm margins, no centering/header/footer/page numbers; CSS specifies A4 size without a second margin. White appearance is independent of editor theme. Print-only Hiragino Sans GB avoids the system UI PingFang font alias's compatibility-radical ToUnicode mappings; Chinese and code now copy/search with exact Unicode. KaTeX fonts remain bundled/frozen.

The job writes a sibling temporary PDF and verifies valid A4 pages before replacing the destination. Cancellation and final atomic rename are decided under the same lock **inside** NSFileCoordinator's accessor (no lock held while waiting for file coordination). If cancellation wins, rename is forbidden; if rename committed, later cancellation reports completed. Request/job identity suppression alone is not used as disk cancellation. Export never sets document fileURL or saved state.

The app build now includes the exact root THIRD_PARTY_NOTICES.md. Dependency pins/lock are unchanged.

## RED → GREEN and diagnostics

The logs below are local `/private/tmp` artifacts. They distinguish missing-API/compiler RED and test-fixture mistakes from observed production failures.

- `swift test --package-path native --filter WebKitRenderTests` initially demonstrated native `worker error: undefined` for the real bundled file worker, after correcting an initial probe mistake (Swift newline interpolation into JavaScript). After trusted Blob bootstrap, actual KaTeX passed. A further test fixture used invalid single-line `$$...$$`; correcting it to a real display block was a fixture correction, not a product fix. GREEN 7/7 initial Assets+WebKit tests in `/private/tmp/ret-task4-assets-green.log` (01:33:45–48); final native suite includes the same actual worker proof.
- `swift test --package-path native --filter AssetsTests` before implementation failed `cannot find type 'AssetStore' in scope` (`ret-task4-assets-red.log`). This is missing-feature compilation RED, not a claim of observing every filesystem edge fail in the old product. Later missing reopen/adoption API similarly failed `AssetStore has no member 'adopt'` (`ret-task4-reopen-red.log`). Real final tests cover collisions, restart/idempotency, partial migration then process-style object reconstruction/retry, approved roots, symlinks, capability/path escaping, formats/clipboard, frozen bytes, new IDs, filename rename and N+1 migration.
- `npm test -- tests/surfaces/render.test.ts` failed 2/5 before manifest/capability/path-placeholder behavior (`ret-task4-web-red.log`); GREEN 5/5 (`ret-task4-web-green.log`), final suite 115/115.
- `npm run test:browser -- --grep 'live missing/remote'` failed because the live placeholder contained `[图片不可用：alt]` instead of its path (`ret-task4-live-red.log`); GREEN 2/2 missing/remote + immutable manifest tests (`ret-task4-live-green.log`). The first sandboxed attempt could not bind the local server; it was rerun with escalation and is not counted as a behavioral RED.
- `npm run test:browser -- --grep 'image drag in'` failed 2/2 for absent native image drop requests (`ret-task4-drag-red.log`). After rich/source drop routing and special-path handling, source passed; the rich synthetic event had coordinates outside the editor, so the test was corrected to use its actual rectangle. GREEN 2/2 (`ret-task4-drag-green2.log`), final browser 65/65. That coordinate correction is not claimed as another production defect.
- Native import integration first posted a raw host request without creating the web bookmark: it correctly did not insert. The test was corrected to paste a real image File through the editor so the production bookmark exists. It then exposed the real literal `%` path rejection; encoding before validation fixed it. Native import → complete copy → insertion → NSDocument first save passes against the real bundle.
- Native PDF tests were written before services existed (`ret-task4-pdf-red.log`, missing API compilation). Actual first print attempt timed out waiting for animation frames in an invisible WebView; native readiness now awaits fonts/images and flushes layout without rAF (`ret-task4-pdf-green.log` historical failing diagnostic).
- Synchronous `NSPrintOperation.run()` then produced an endlessly growing temporary PDF. Focused runs were interrupted and exact task-owned temporary roots removed. Stack evidence `/private/tmp/ret-task4-print-sample.txt` showed repeated NSView printing, not a successful finite PDF. Primary WebKit source explains main-thread preview's unbounded unknown page range and actual secondary-thread data path: [WKPrintingView.mm](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/mac/WKPrintingView.mm), `knowsPageRange` and `_isPrintingPreview`. Enabling a separate thread **and asynchronous runModal** produced finite pages; no guessed page cap or screenshot-to-PDF workaround was used. [Apple printOperation API](https://developer.apple.com/documentation/webkit/wkwebview/printoperation(with:)).
- The first finite-print completion crashed by cleaning WebKit from the print thread despite its ObjC method's MainActor annotation. The actual crash report `xctest-2026-10-23-014042.ips` identified `WKWindowVisibilityObserver startObserving` from finish/NSWindow cleanup on the print thread. Explicit hop fixed it; final production tests pass.
- Exact Chinese assertions failed with `中⽂` compatibility radicals from the system UI font (`ret-task4-font-probe.log`); explicit PingFang SC still failed. Hiragino Sans GB passed exact `中文固定快照` (`ret-task4-font-probe2.log`), and the full real fixture extracts exact `中文可检索` and every Chinese code line.
- Actual product fixture failed `Fixture has no intentional trailing blank page` before removing final paragraph margin (`ret-task4-trailing-red.log`). GREEN product fixture/import 2/2 (`ret-task4-integration3.log`); final pages all contain content.
- Tall-image self-review was an additional characterization, not a claimed clipping fix. An initial strict PDFKit RGB threshold falsely rejected visible red/cyan because of color-space conversion; Poppler visual inspection established that the bands were present. A trial max-height was **reverted**. Final test uses six vertical color bands plus their aggregate expected area/aspect ratio, and visual inspection of all printed fragments. Baseline CSS preserves the 1000×4000 SVG across three pages. Logs `ret-task4-tall-red.log`/`ret-task4-tall-baseline2.log` retain the QA false positives; final native suite is the authoritative corrected result.

TDD was used for new service interfaces and the observed import/render/placeholder/print defects. Additional validation/security/race tests were added during self-review; I do not claim each supplemental assertion separately produced a behavioral RED before the underlying code existed.

## Final verification

Working directory for every command: `/Users/grainrain/Developer/GitHub/ReT-Markdown`.

- `npm run typecheck` → exit 0 (`/private/tmp/ret-task4-typecheck.log`).
- `npm test` → **115/115**, 7 files, exit 0 (`/private/tmp/ret-task4-web-full.log`, 01:51:46).
- `npm run test:browser` → **65/65**, 18.2 s, exit 0 (`/private/tmp/ret-task4-browser-full.log`). No inherited color warning.
- `bash scripts/build-app.sh` → release build, plist lint, ad hoc signing and `codesign --verify --deep --strict` all exit 0 (`/private/tmp/ret-task4-final-build.log`).
- `RET_PDF_VERIFICATION_DIR="$PWD/build/rewrite/verification/2026-10-23/task4" swift test --package-path native` → **47/47**, 9.98 s, exit 0, no warnings (02:00:45–55); log `/private/tmp/ret-task4-native-full.log`.
- `git diff --check` → exit 0; final signature re-verification → exit 0.
- Native test environments inject dedicated recovery roots/queues and derived Assets directories. New fixtures use unique pasteboards; no general system clipboard is modified. Test teardown drains recovery writes and asserts that test IDs have no production recovery or asset files. Intermediate stalled/crashed print tests' exact owned temporary roots were removed, without touching other temp/production data.

Coverage includes native F03/F09 partial prepared journal restart/retry and no-overwrite; F14 snapshot N / native received N+1 / later image preparation / dirty baseline; F10 actual worker frozen source and external image mutation after freeze; F17 30 concurrent real filesystem commit/cancel races, cancellation-before-replacement preserving bytes, replacement-before-cancel returning completed, and cancellation of a real WebKit print job with old output and no sibling temp left. Renderer fallback and too-wide formula failures preserve an existing destination. Existing NSDocument/recovery tests remain green.

## Actual PDF and visual output

Final production fixture: `build/rewrite/verification/2026-10-23/task4/print-layout.pdf`. Source is the controller's updated `fixtures/print-layout.md`, SHA256 `74fb49d08fc6b6a43cbf85e81b864873f64d329b9d31bff74d81a77dc5ed4cd8`, not the older dated copy. It includes 80-row table, 80 code lines, ordinary and 16-term wide formulas, special-path SVG, missing/remote images, long URL/code markers and end marker.

The test opens an isolated copy of that source/assets through actual EditorHost, exports via production services, advances native received state to N+1 **at exportContent before printing**, and externally replaces the original SVG after the immutable resource snapshot. The PDF excludes `NPLUSONE-SHOULD-NOT-PRINT`, still contains the frozen SVG, and leaves fileURL/saved source unchanged and N+1 dirty. These are production code checks, not a claim of real GUI typing or real IME observation.

Final artifacts: `pdfinfo.txt`, `print-layout.txt`, `bounds.html`, `final-observations.json`, `build-identity.json`, and every page PNG under `final-pages/`. Poppler commands:

```sh
/opt/homebrew/bin/pdfinfo -f 1 -l 7 build/rewrite/verification/2026-10-23/task4/print-layout.pdf
/opt/homebrew/bin/pdftotext -layout build/rewrite/verification/2026-10-23/task4/print-layout.pdf build/rewrite/verification/2026-10-23/task4/print-layout.txt
/opt/homebrew/bin/pdftotext -bbox build/rewrite/verification/2026-10-23/task4/print-layout.pdf build/rewrite/verification/2026-10-23/task4/bounds.html
/opt/homebrew/bin/pdftoppm -r 80 -png build/rewrite/verification/2026-10-23/task4/print-layout.pdf build/rewrite/verification/2026-10-23/task4/final-pages/page
```

Seven A4 pages (Quartz rounds media box to 595×842 pt; native test tolerance <1 pt from true A4). Every page has content. Actual left text coordinate is **56.69291 pt**, exactly 20 mm, proving the effective margin is not doubled. Extracted text bounds remain inside all four margin edges. Script verifies exact Chinese, all `ROW-001`…`ROW-080`, all `第 001 行`…`第 080 行`, start/end/width markers, missing/remote path placeholders and absence of N+1. Every final page was rendered and visually inspected, including formula, SVG, code continuation and wide content. Controller independently inspected the same layout; `visual-final/comparison.json` records byte-identical page images to the reviewed candidate for the pre-tall-characterization final output.

Observed feedback is `[图片：missing-preview-image.png]` and `宽公式已缩小至64%。`. Remote URL appears as its placeholder without a network fetch. The separate tall-image PDF is `tall-image.pdf`; its six-band image is intentionally fragmented across three pages at the original aspect ratio, with all bands present and rendered area checked against a 170 mm content width. This requirement does not mandate one-page-only images.

## Source/bundle identity

Preview: `build/rewrite/0.2.0-alpha.1/ReT Markdown Preview.app`, bundle ID `com.retmarkdown.rewrite.preview`, version `0.2.0-alpha.1`, ad hoc signature verified. Actual QA OS: macOS **27.0.1 (26A434)**, Apple Silicon. Runtime source and bundle resource hashes are captured in `build-identity.json`; final values appended below. No dependency pins changed. Bundled THIRD_PARTY_NOTICES byte-equals the root file, SHA256 `450e43de6ae3771536d151721d44ed9e2ed0fe9c5666c3f0c0569dd5c02cdd21`. Lock SHA256 `4c436cbb425b3d179cd7d4c5d815e8f993a8a64af2dc4c8035732931f08d8e93`.

## Self-review and remaining concerns

- All task production behavior is present; this is not a stub or a browser download pretending to be native PDF/save. A real output from the actual app bundle was inspected.
- Actual native menu/picker/drop/system-clipboard interaction, progress Cancel button observation and system IME remain **unobserved GUI gates** because native CUA timed out. Code-level WKWebView/NSDocument/NSPasteboard and printing tests are real; browser synthetic events do not prove those GUI/IME gates. No true power-cut/full-volume campaign or macOS 13 compatibility run was performed.
- System printing can continue spooling after accepted cancellation; the commit coordinator forbids replacement and defers temporary cleanup until callback. Forced termination of the printing WebContent process during an active spool was not empirically exercised. Runtime failure paths prohibit final commit; they do not promise instant OS thread termination.
- Native document read with already-installed UI services follows NSDocument's ordinary main-thread lifecycle and uses MainActor isolation for export cancellation. Concurrent unopened-document reads do not have UI services. Unusual callers invoking active-document read off the main actor are not a supported extra interface.
- Controller observed table continuations without a repeated header and small border fragments at page edges; all row/cell text remains present and uncropped. This is nonblocking polish, not hidden lost content.
- SVG validation is intentionally conservative: safe static files using unsupported elements/attributes are rejected explicitly. Images are never auto-deleted; retained orphan/retry assets are a deliberate policy and no garbage-collection feature was added.
- Existing rich.ts is large; changes were limited to image drop/path placeholders. Assets.swift and Export.swift remain focused task-owned files rather than introducing an unrelated architecture split.

Changed owned files are native Assets/Export/Document/EditorHost/Protocol and their tests, web render/client/worker/document/main/CSP and rich/source image adapters, focused browser/render tests, TestEnvironment isolation and build-app notice bundling. Root README/spec/controller fixtures and existing Task 2 scratch modifications were preserved.


## Final frozen verification identity and measured tall-image geometry

Final native suite: **47/47**, 0 failures, 9.98 seconds, exit 0, no warnings. Corrected six-band tall test reports `[9600,9600,9600,9600,9600,9720]`, total 58120 sampled pixels versus 58054 expected from intrinsic 4:1 height/width and 170 mm printable width. This confirms retained image area/aspect ratio across three pages; it does not prove all continuation paint respects the page margins.

The final tall SVG preserves all six bands, expected area/aspect and the required page margins. Artifact `build/rewrite/verification/2026-10-23/task4/tall-image.pdf`, SHA256 `cb0297e6bbf288f078b588b4f4d50fea2324faa171b98f745abb86a07295b7ad`; all fragments rendered as `tall-pages/final-1.png` through `final-3.png`. Independent PNG-byte decoding measures page 2 and 3's first saturated color pixels at **x=55, y=55 at 70 dpi**, equivalent to **19.957 mm**, correct raster rounding of 20 mm (55.12 pixels). Their page size is 579×819 pixels; maximum paint edge y=764 exclusive leaves 55 pixels at the bottom. Page 1's image begins lower, y=139, after its heading. `tall-margin-observations.json` contains exact bounds. The controller independently measured matching geometry in `tall-measure/bounds.json`.

An earlier visual estimate of y≈23 in a tool preview was wrong; the current artifact hash and decoded PNG pixels disprove it. It is **not** a retained product defect. No image loss or margin violation was demonstrated, and the unsupported trial max-height change was reverted. The final runtime retains the independently verified original print layout.

Final ordinary fixture PDF SHA256 **b7d71d6e39fd9c4f177d69f31396b77d5dc42657988cd185dd122a81f5b4164e**. Seven page PNGs are byte-identical to the already inspected final images; `final-observations.json` records this comparison and exact text bounds. All 80 rows/code lines and exact Chinese/width/start/end markers were rechecked after final generation.

Final runtime source SHA256 **33b3173137ddd7950ca914d3f6e43f49c8c19793f78b0bf691132310a522bb7a**, computed over sorted native Sources, editor TS/CSS/HTML, build scripts and lock paths/bytes. It is unchanged from the fully tested/inspected production runtime before the extra tall characterization. New native test coverage alone changed afterward. The previously passing 115 unit/65 browser cases therefore exercise the identical final runtime source.

- App executable SHA256: `88747fc0da9954afc3841b5ec8c7c18c7111491cf9241cedd4426512813be307`.
- Bundled main.js SHA256: `c5dee3764469ece3c5f57b13c2ff8f0c4c354bd4a037a706d8e6d346df700709`.
- Bundled render-worker.js SHA256: `6616976c3c6bea410c2231298fe0287823e923e05124b0e117d9f8c6c17fbd3b`.
- Bundled katex.css SHA256: `d4ab5b8ee16989b070cdb0ea24bd6ad48fc8df1b787f280f29d3ae4f959f2c00`.
- Info.plist SHA256: `aa72f318b1478561d0d3d6a0d0d986fed88a116823b81e72899f0e81841e455a`.

`codesign --verify --deep --strict` and `git diff --check` were rerun successfully after final generation. Runtime files, controller scratch/docs/fixtures and old preview output outside this isolated version were not changed by the last characterization.


## Review fix round 1 — FIX_BASE dc49273 (2026-10-23)

Both Important findings in `task-4-review.md` were reproduced before changing their corresponding production code, then fixed. This round changes only native Assets/Export and their regression tests, plus this report. Controller Task 2 scratch/plan edits are preserved and excluded from the fix commit. No web source, renderer layout, dependency, fixture, or build-script change was needed.

### Asset reference decoding

`resolve(path:)` remains the Markdown/URL boundary that decodes once. New private `resolveNormalizedPath` validates an already decoded filesystem name with `decode:false`. Frozen manifest lookups, unmanaged destination comparisons, and managed save-copy preparation call that normalized lookup, so a literal `%HH` filename cannot be decoded into a different name during migration or freezing.

New unit regression imports real validated SVG bytes named `literal%20.svg`, `literal%2F.svg`, and `literal%2e%2e.svg`; each goes through its encoded capability URL, freeze, first-save preparation/commit, and SaveAs preparation/commit. The `%20` case installs a different similarly named space file and verifies it cannot replace the requested frozen bytes. A separate native WK integration regression pastes a real `File` named `literal%20.svg` through the editor's ClipboardEvent/DataTransfer path, observes the loaded live image (`naturalWidth=80`), collects the production parser manifest, freezes bytes, saves through actual NSDocument first save and SaveAs, and verifies unchanged encoded Markdown, original copied bytes, correct fileURL, and clean saved state. This is actual production service/DOM integration, not observed system clipboard UI.

RED command (before asset fix):

```sh
swift test --package-path native --filter AssetsTests/testPercentLooking > /private/tmp/ret-task4-fix1-percent-red.log 2>&1
```

Exit 1, 1 test / 2 failures: frozen image was `nil` instead of `Optional(110 bytes)`; preparation threw `找不到图片：percent.assets/literal -…svg`, showing `%20` became a space. The thrown first iteration prevented later boundary cases from running in RED; all three run in GREEN.

GREEN same command with `/private/tmp/ret-task4-fix1-percent-green.log`: exit 0, **1/1**, 0.013 seconds. The actual WK/NSDocument regression is included in the focused integration and full results below.

### Superseded native print requests

Each request now owns its ID, snapshot, frozen resources, target, print job, progress panel, and completion. The controller installs the replacement as active and cancels the old request independently. An old printing request keeps its own completion until native printing unwinds, without blocking the replacement's render admission or timeout. Its completion clears only its own resources/panel; it clears controller active state only if it is still that exact request. Completions run once. Cancel buttons carry request identity so a stale panel action cannot cancel a newer request. Cancellation's disk-commit coordinator remains unchanged, including the honest completed result if replacement has already committed.

The regression uses real WK/NSPrintOperation printing, not an injected fake job. After the first export creates its native print WebView/window, the test starts the second export in the same MainActor turn. Both target files initially contain sentinel bytes. It requires first completion to report cancellation, first target bytes to remain unchanged, second completion to succeed with searchable `REPLACEMENT-PRINT-MARKER`, and sibling temporary PDF files/progress windows to be cleaned. While the second target is still pending, the first completion also verifies the replacement's single progress panel remains. This tests the previously stuck controller ownership path and old-cleanup isolation.

RED command (asset fix already present, export controller still old):

```sh
swift test --package-path native --filter ExportTests/testSecondExport > /private/tmp/ret-task4-fix1-supersede-red.log 2>&1
```

Exit 1, **1 test / 2 failures**, 16.600 seconds: both completion expectations unfulfilled after 15 seconds; second target remained the sentinel and could not unwrap as PDFDocument. The overlap assertion passed. The CoreGraphics diagnostic when trying to parse those deliberately unchanged sentinel bytes is a consequence of the expected RED, not a separate print crash.

Focused GREEN after the two fixes:

```sh
swift test --package-path native --filter 'ExportTests/testSecondExport|AssetIntegrationTests/testImportedLiteralPercent' > /private/tmp/ret-task4-fix1-integration-green.log 2>&1
```

Exit 0, **2/2**, 3.066 seconds (asset integration 1.470 s, export replacement 1.596 s). The additional old-completion/progress assertion was then added and passed in the final full suite.

### Final affected verification

```sh
bash scripts/build-app.sh > /private/tmp/ret-task4-fix1-build.log 2>&1
RET_PDF_VERIFICATION_DIR="$PWD/build/rewrite/verification/2026-10-23/task4/fix-round1" swift test --package-path native > /private/tmp/ret-task4-fix1-native-full.log 2>&1
codesign --verify --deep --strict 'build/rewrite/0.2.0-alpha.1/ReT Markdown Preview.app'
git diff --check
```

All final commands exit 0. Release app build/plist lint/signing succeeded. Native suite is **50/50 = 47 prior + 3 new tests**, 12.986 seconds, no warnings/errors; actual bundled file WK KaTeX remains GREEN. The new export regression passes in 1.561 s. The initial build attempt inside the filesystem sandbox failed only because Swift could not write its toolchain module cache; the authorized escalated rerun is the successful final build log, not a behavioral RED.

Web unit **115/115** and browser **65/65** are the prior verified results, **not rerun in this native-only fix**. Rebuilt bundle main.js, render-worker.js, katex.css, notices, lock and plist hashes exactly match the previously verified runtime bytes. No claim is made that unchanged web tests newly ran this round.

All native regressions retain test-only recovery/asset roots and owned temporary output; production recovery/assets and general clipboard were not used. Native GUI/IME observation remains unavailable, and previous table continuation polish limitations remain unchanged. No new unresolved implementation defect is known from this fix round.

### Refreshed production output and identity

Actual production outputs from the final 50-test run are under `build/rewrite/verification/2026-10-23/task4/fix-round1/`:

- `print-layout.pdf`: **7 nonblank A4 pages**, SHA256 `05186f1eca122fa70d845cbb24da17e201e0dc714d455bbcbc7a2ad0dc86e0d7`.
- `tall-image.pdf`: **3 A4 pages**, SHA256 `b2f2b3e99a30cb95a17a4bb0118f34263d6d50504d15c6b89be364a7bbe8b864`; six bands remain `[9600,9600,9600,9600,9600,9720]`.

Poppler rendered every ordinary page at 80 dpi and every tall page at 70 dpi. **All 7 ordinary and all 3 tall PNGs are byte-identical** to the previously inspected `final-pages/page-*.png` and measured `tall-pages/final-*.png`, respectively. No speculative layout change was introduced. `print-layout-comparison.json` / `tall-image-comparison.json` preserve per-page hashes/equality. Fresh `pdftotext -layout` verifies exact `中文可检索`, all 80 row markers, all 80 Chinese code lines, start/end/URL/code width markers and absence of N+1; `text-checks.json` records every check true. Source fixture remains SHA256 `74fb49d08fc6b6a43cbf85e81b864873f64d329b9d31bff74d81a77dc5ed4cd8`.

`fix-round1/build-identity.json` records explicit source paths/digest algorithm and all bundle/PDF hashes. Preview path/version/bundle ID/OS remain as above. Updated runtime source SHA256 is **`284e99c2a69ccac586fcdce09ce1604323f6ec52f316510b1d7211e378e02c32`**, computed as SHA256 over sorted relative path + NUL + bytes + NUL for native/Sources, editor TS/CSS/HTML, the two build scripts, and package-lock.json. The rebuilt executable SHA256 is **`a62df988cbf5ba54bea2f53891c2d8f00e63466701eb01d0ae180f24eeb9788a`**. Native source changes are exactly the two review fixes; renderer bytes and printed page images remain unchanged.
