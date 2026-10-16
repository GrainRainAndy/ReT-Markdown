Task 6 independent native/PDF review — 2026-10-15

**Spec verdict: CHANGES REQUIRED.** The production paginated-print/atomic-output implementation has substantial real proof, but F16/F17's error localization fails on a concrete supported source arrangement.

**Quality verdict: CHANGES REQUIRED.** One reproducible range-mapping defect remains. No new defect was found in the reviewed async print completion, frozen export bytes, atomic replacement or current-arm64 CJK fallback path. Task 5 image authorization findings additionally block some integrated exports and are owned there.

**Review basis.** Independent native integration review, 2026-10-15, against `AGENTS.md`, the complete native architecture, F09–F17 and relevant source/offline requirements in the spec, each assigned task brief and implementation report. This is a non-Git workspace: the owned source files were inspected directly as complete additions, not as a commit diff. Cross-component evidence is used where the actual integration contract requires it. Product code, shared builds and the running acceptance app were not changed; no subagents were used. Current macOS 27.0.1 arm64 is the acceptance target; Windows and older macOS compatibility are not findings.

**Evidence policy.** Existing suites were read, not rerun: Task 2 15/15; Task 5 28/28; the later approved native full-suite log records 66 tests, **65 passed, 1 skipped, 0 failed**. This supersedes the historical Task 2 report's earlier asset-alias failure. The 5-page and 27-page production PDF proofs remain valid evidence for their inputs. Passing these cases does not cover the concrete triggers below. New probes were confined to `/private/tmp/ret-native-review-20261015`, used captured production source, and were added only for risks found in review. The native probe uses a packaging-only `Bundle.module = .main` shim and omits `AppMain`; it does not change storage/document implementations or create a WebView. Swift 6 compilation succeeded. The restricted run could not access AppKit file coordination (Cocoa 256); an approved elevated, 45-second-bounded run completed normally. That sandbox limitation is not a product finding.

**Finding.**

1. **R6-1 — P2: Export overflow is mapped to the wrong source after a multiline HTML block.** Location: `web/src/export.ts:99–110`, especially `new MarkdownIt({ html: false })` at `:100` and index-based block/DOM pairing at `:107–109`. The shared renderer uses `html: true` to tokenize unsupported HTML atomically before safely displaying it as literal code (`web/src/render/markdown.ts:23–26`, `:76`). The second parser instead splits a multiline HTML comment with a blank line into two paragraphs. A following formula is the second DOM child, so it receives the second HTML fragment's range rather than its formula range. Reproduction source: `<!--
first

second
-->

$$\underbrace{` + `x+` repeated 100 times + `x}$$`. The production `browserExportHost.mount` in a temporary jsdom harness produces expected formula range **24–242**, actual assigned range **12–23**, selecting `second
-->
`. `overflow()` uses that exact `rangeOf` mapping and the native installer reveals it when the editor revision is unchanged. The wide formula therefore sends the user to unrelated comment text instead of the content preventing export. Obtain block ranges from the same parser/configuration/render result that created the HTML, or use stable per-block source metadata rather than a separately guessed DOM order. Add the HTML-block-plus-overflow case and verify that a genuine decode/layout error points to the offending block. This is a demonstrated mapping error; the probe does not pretend jsdom proves real pagination.

**Native print and output assessment.** `PDFExporter` copies snapshot/capability values, retains a separate nonpersistent WKWebView/window and separate scheme handler, and uses `callAsyncJavaScript` structured arguments. Fonts/local image decode/layout preflight must complete with no issues/overflow; remote references become inert URL placeholders. The public `printOperation(with:)` → `runModal(for:delegate:didRun:contextInfo:)` route enables a separate printing thread and resumes MainActor from the callback. It does not use `createPDF` rectangle capture. The print operation and WebView remain retained until completion. A process-wide busy flag prevents concurrent modal print jobs. Native margins are set once in fresh NSPrintInfo; print CSS strips screen padding and sets A4/white/13 px. Output uses an exclusively created temporary sibling, cancellation/error cleanup, PDFKit EOF/page-size/text validation, file synchronization and an atomic rename; the old PDF is untouched until commit. The source is not mutated by print preparation.

**Readiness, fonts and evidence.** Export-only font ordering puts offline Hiragino Sans GB ahead of generic CJK fallback for both body and code. Existing proofs substantiate literal Chinese extraction on the current Mac; no older-Mac/Windows font guarantee is inferred. Read-only artifact inspection in this review confirmed:

| Artifact/evidence | Observed result |
| --- | --- |
| `/private/tmp/ret-task6-native-proof.pdf` | `pdfinfo`: 5 pages, 595 × 842 pt A4; existing runtime report/tests record literal body/code Chinese and final sentinel search. |
| `/private/tmp/ret-task6-pagination-proof.pdf` | `pdfinfo`: 27 pages, 595 × 842 pt, 1,516,661 bytes; SHA-256 matches recorded `8dce9a0d683b57ac5661155b74a026c0103146f3871deb6682e186d447b0fdbf`. |
| `/private/tmp/ret-task6-final-web/export.js` | SHA-256 matches recorded `47a2db814e8dd0a8394b40be95e95014d853b4d74544c8c5b8f8518eede08bc5`. |
| `/private/tmp/ret-task6-runtime-fixture-final.log` | Production runtime test completed normally in 0.477 seconds, one test/zero failures; existing 27-page proof. |
| Task 6 report and tests | Web focused 11 + opt-in browser case, full web 149 passed/1 skipped, Swift PDF 8 passed/1 opt-in skipped; these are recorded results, not reruns. |
| `/private/tmp/ret-native-review-20261015/export-range-probe.json` | Fresh focused production DOM-mapping reproduction: formula 24–242 assigned comment 12–23. |

The owner reports all-page geometry/text checks plus visual samples of pages 1, 2, 26 and 27. This review did not repeat native printing or claim a new full visual inspection. The production cancellation checks protect replacement once the producer returns; the existing cancellation unit test does not establish interactive mid-print cancellation UI. Main still owns installed-app menu/save flow, source/live equivalence, page-end heading and dedicated long-code acceptance, and 20-run Release performance/RSS measurements. These are explicit evidence limits, not speculative additional defects. The real public NSDocument Save hang in Task 2 blocks main GUI acceptance; it does not invalidate the independent PDF artifacts. Task 5 R5-3/R5-4 affect capabilities supplied to otherwise correct export preflight.


**Captured file hash manifest (SHA-256).** Initial capture UTC: 2026-10-15T13:31:57.103729+00:00. Paths below identify the exact complete additions/dependencies reviewed. The immutable review copies and JSON manifest are under `/private/tmp/ret-native-review-20261015/captured/` and `manifest.json`. Later amendments require their own evidence; this does not claim an atomic repository-wide snapshot.

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  AGENTS.md
e07cdf668fb07925b457f205810b6161ed99f0940d3b2aa22e10f71a09f69499  Sources/ReTMarkdown/Bridge/AssetSchemeHandler.swift
a1276a7274daf4f7c47ac12e6de829fd562610bed78aa2e54a86ee4f24824e99  Sources/ReTMarkdown/Bridge/BridgeTypes.swift
cf691639b1f2fd30a5a2670cd61a91070fab3fb5bd36a8836439533213bc12c2  Sources/ReTMarkdown/Documents/MarkdownDocument.swift
b79f57e9b62a74941b92b83d2c4f08081e0857bd046746abfa440a4d2c6c80b7  Sources/ReTMarkdown/Export/PDFExporter.swift
283afbc18a840a8063a64859bbdc6e0167a4f54a4d551fdb32fab6934b816a4b  Sources/ReTMarkdown/Export/PrintProfile.swift
d4a4066b7aebf7c1a1a4c62417acf9b79697719d8664c0b7eb650209f48ac8fc  Sources/ReTMarkdown/Storage/AssetStore.swift
5c0efca1e974eaca1f6cbd236e76677472204ce8bee0d14be0cdafcc303b8b53  Sources/ReTMarkdown/Storage/NativeAssetIntegration.swift
a94e02a922ab87035a80f0059d0acb7bb38171f838e17f7352e6adc5d52ccf84  Sources/ReTMarkdown/Storage/SourceCodec.swift
078f8e4848bbcde2f7fdf9683798c8f43f6149104294ec4d42c39059b75994e3  Tests/ReTMarkdownTests/PDFTests.swift
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
9dcd684a24135cfeb4ce38de4a66b74194dea95f7b90d85bea4b76ecb38da16e  docs/testing/briefs/task-6.md
e0f65c24c82f9d50f08f11c4940b901e75158530676c18038948f9b5213cb72e  docs/testing/task-6-report.md
96109faf985a08475f8be7de6defbba853910e708fa3172b5b6267973d1bb628  scripts/build-web.mjs
b05fc4b43ca727bc5853ce4036f8b3b02d361fb6968182cf08b4857055bfa3b9  web/index.html
28189a125eb4a08667c2e52e15fea941c650f73d84993feb6245942fc61bb364  web/src/export-main.ts
ea26990d5af11b44156e09fe032e9af37bd33a3122531812c8cdc349203d3136  web/src/export.ts
36fcb034f975f93b73af938c27db1c2a5be6f58da8c089ea38bdf9c30234630f  web/src/render/markdown.ts
c1dd964695182497d101a0fff972fee68a45572c3cbfa15fa6f36be114d278f2  web/src/render/math.ts
f9838bedac84f0e76c4942c259f23dfb6f2ef87b98e6195ee22c5d177302076a  web/src/render/positions.ts
0707515fb6eb10004894a68e4fab24cbe54ee4b9fd472f99f457c11f1257a930  web/styles/fonts.css
067a5480e4ad528f3de2bca18284a545da05c2a2712ea1e60b96cedd476d320f  web/styles/print.css
26e03e0b3b16e2d9f9ffe88aa9c42fad982ea3b8218a5a22bc28c3523b7f850b  web/styles/typography.css
6d0eeb98a0f0404dd3b7188f01a13a888e0b37ef68e4b1475071ccc08548de57  web/test/export.test.ts
```

**Focused review evidence hashes.** These files are in `/private/tmp/ret-native-review-20261015/`.

```text
2f3b5493b98be45a42d973c72bbf8d6a8129ea987f9ba4ff1f247494b623f496  Probe.swift
b0eac0cf36999a388b73925f41f6f34b77250506d232067cd502de6bbf11e333  probe-elevated.log
3fd0b9e15174a53dcf3a9e4e5f0adc41a73022d603d00c7dfb32e68d53608fe6  FrozenProbe.swift
0028b41ded39d2abf7492670b0df591db67d96b225e77e138521c0b66dccd075  frozen-probe.log
73683e1a9e8a23d1a26adf708885edd4ab3015ed232a27c6a9941aea8e4a8a12  RollbackProbe.swift
036cb0d500413d3dc74703ac1dafcdf8d7a4e2be922d54cc735ca925ab504ee5  rollback-probe.log
14b0f9888320084c8075ff68d400ad3435145cd1b6579aa8267f38e071b6afa6  export-range-probe.json
d28cae4bc142e4aa46cc9eab24e931325fcf63d6135480636ffeb8fb9079f163  export-range-input.md
c2895c43e4d8f12fc6f27d654178aab92fb0d852e7614c2bbe6c6f9f41a82169  nested-renderer.json
```
