Task 5 independent native review — 2026-10-15

**Spec verdict: CHANGES REQUIRED.** F10/F12–F14 fail for independent Save As documents, canceled migration provenance, nested image references and recovered frozen images.

**Quality verdict: CHANGES REQUIRED.** Filesystem tests cover many important failures, but persistent identity and manifest transitions have reproducible integration defects.

**Review basis.** Independent native integration review, 2026-10-15, against `AGENTS.md`, the complete native architecture, F09–F17 and relevant source/offline requirements in the spec, each assigned task brief and implementation report. This is a non-Git workspace: the owned source files were inspected directly as complete additions, not as a commit diff. Cross-component evidence is used where the actual integration contract requires it. Product code, shared builds and the running acceptance app were not changed; no subagents were used. Current macOS 27.0.1 arm64 is the acceptance target; Windows and older macOS compatibility are not findings.

**Evidence policy.** Existing suites were read, not rerun: Task 2 15/15; Task 5 28/28; the later approved native full-suite log records 66 tests, **65 passed, 1 skipped, 0 failed**. This supersedes the historical Task 2 report's earlier asset-alias failure. The 5-page and 27-page production PDF proofs remain valid evidence for their inputs. Passing these cases does not cover the concrete triggers below. New probes were confined to `/private/tmp/ret-native-review-20261015`, used captured production source, and were added only for risks found in review. The native probe uses a packaging-only `Bundle.module = .main` shim and omits `AppMain`; it does not change storage/document implementations or create a WebView. Swift 6 compilation succeeded. The restricted run could not access AppKit file coordination (Cocoa 256); an approved elevated, 45-second-bounded run completed normally. That sandbox limitation is not a product finding.

**Findings (ordered by severity).**

1. **R5-1 — P1: Save As gives two independently editable files the same draft namespace.** Location: `Sources/ReTMarkdown/Storage/AssetStore.swift:247–251`, `:300–315`, `:345–350`; consumers `NativeAssetIntegration.swift:23–24`, `:85–86` and `DraftStore.swift:21–24`, `:77–83`. Migration retains `manifest.documentID`, publishes that UUID for the new URL and retains the original URL's UUID metadata. Reopening the original after Save As creates a second independent document/window with the same UUID. Both stores write `drafts/<UUID>/generations`, and recovery selects the latest generation without checking the requested document URL. Fresh probe: commit A, Save As B, resolve both identities, persist independent edits, then recover A: `SAVEAS sameID=true A_recovery=unsaved B`. This can restore B's text/assets into A or reject one window's newer work using the other window's revisions. Keep managed-asset lineage/history separately from a unique active document recovery identity; fork a durable identity for independent copies (or equivalently disambiguate the recovery namespace) while preserving stable reopen identity for each URL. Test two concurrently opened post-Save-As files, independent edits/crashes/restoration, not just lookup of one destination.

2. **R5-2 — P2: Canceling a return Save As leaves the old target's provenance replaced.** Location: `AssetStore.swift:270–274`, `:287–289`, `:336–337`, `:353–355`. Staging writes the candidate manifest directly to the committed `<UUID, target URL>` manifest path. The index's candidate Markdown hash protects selection between different UUIDs, but cannot distinguish old and staged manifests for the same UUID/URL. Real trigger: save A with a managed image, Save As B, reopen A and add an image only to A, then attempt Save As B back over A and fail the Markdown write/cancel. Reopening unchanged A reads B's staged resource directory/assets. A fresh targeted probe reports `SAME_ID_ROLLBACK originalBytesPreserved=true oldManaged=2 newManaged=1 lostOriginalOnlyAsset=true resourceDirectoryChanged=true`. A's newly imported image still exists, but its managed provenance is lost; a later Save As no longer copies it as a managed asset, and later imports use the resource directory chosen by the failed operation. The in-memory original manifest and original Markdown survive, but persistent metadata does not. Stage manifests under an immutable migration/generation key and publish the committed pointer only when the write is proven, with recoverable crash-after-write selection. Add a regression comparing the complete reopened target manifest before/after a same-UUID canceled migration; the existing different-UUID identity test does not catch this.

3. **R5-3 — P2: Valid images nested in lists are classified as code and never authorized.** Location: `AssetStore.swift:498–514`, particularly the unconditional four-space exclusion at `:509`; production consumers `NativeAssetIntegration.swift:94–105` and `AssetStore.swift:187–188`. Example source is `- item

    ![image](image.svg)`, with a real local image beside the Markdown. The shared Markdown renderer parses it as an image inside the list. Native `AssetReferences.scan` returns `[]`, so the live capability map omits the image, the preview shows “Missing local image,” and PDF preflight blocks export. The same scanner also omits that unmanaged reference from Save As breakage warnings. The Swift probe reports `SCANNER nestedDestinations=[]`; `nested-renderer.json` records the actual renderer's image issue at UTF-16 12–31 when given the resulting empty map. Use grammar-aware image destination ranges consistent with the renderer/editor, including list/container indentation, while continuing to exclude actual code. Test nested/continued lists and blockquote reference definitions in addition to top-level syntax.

4. **R5-4 — P2: Importing an image drops the frozen fallback needed by recovered unmanaged images.** Location: `AssetStore.swift:154–158` (new manifest omits `capabilities`); the same loss occurs in `:291–296`. Recovery intentionally retains frozen capability data for a valid local image whose original file has disappeared. On the next image import, the immutable manifest is rebuilt with only managed assets, resetting capabilities to `[:]`. Later `authorize` has neither disk bytes nor fallback bytes. Fresh focused probe: recover `![](user.svg)` after deleting its original file, authorize successfully, import unrelated `new.svg`, authorize again: `FROZEN_RECOVERY before=true afterImport=false`. The retained live handler token alone does not fix PDF or subsequent map/draft regeneration. Carry retained recovery capability bytes through working-manifest updates (and deliberate migration policy), or materialize a durable fallback before dropping them. Test recovery followed by import, ordinary save/rename and a second recovery, rather than authorization immediately after recovery only.

**Cross-component blocker.** R2-2 in `task-2-review.md` is also a Task 5 acceptance blocker: a clean named reopen starts editor revisions at zero, but DraftStore's global-per-UUID stale filter rejects new-session edits; the adapter suppresses the error and skips live-map refresh. Coordinate revision epochs with Task 2. R2-3 also affects the retry path after `didWrite` adopts a migration and its editor acknowledgement fails. These are cross-references, not duplicate numbered findings.

**Spec/quality assessment beyond findings.** Imports are collision-safe immutable files, with durable provenance rather than directory-name inference. Migration stages copied bytes before Markdown, keeps originals, and current alias copies solve the previously recorded plain-Markdown undo problem. Draft publication uses complete synchronized generations and verifies snapshot/manifest/managed-file hashes, falling back from incomplete/corrupt generations. Capability URLs are opaque exact matches; authorization freezes bytes, checks canonical paths/file descriptors, supports legitimate relative parent paths, and does not resolve web-supplied arbitrary paths. The SVG allowlist blocks active elements, event attributes, DTD/entities and external styles/resources; raster bytes are decoded before service. The scheme handler revalidates data and never performs network fetches. Editor/export CSP and navigation policy supply the outer no-network boundary. No demonstrated security bypass was found in these reviewed paths. Completed recovery generations and original image files are retained rather than auto-deleted.

**Targeted evidence and limits.** The review scratch directory contains `Probe.swift`, `probe-elevated.log`, `FrozenProbe.swift`, `frozen-probe.log`, `RollbackProbe.swift`, `rollback-probe.log`, and `nested-renderer.json`. The first four integration outputs were obtained using unchanged captured native implementations; the frozen-image probe completed without elevation. `/private/tmp/ret-assets-final-green.log` confirms 28 tests, zero failures at 18:39:32. Current tests adequately cover resource-copy failure, aliases, symlink changes, unsafe SVG, mixed-EOL locality and atomic generations, but do not cover the sequences reported here. Native chooser/paste/drag, version restoration and full close/relaunch remain the controller's GUI acceptance; the current Task 2 public-save hang blocks that acceptance.


**Captured file hash manifest (SHA-256).** Initial capture UTC: 2026-10-15T13:31:57.103729+00:00. Paths below identify the exact complete additions/dependencies reviewed. The immutable review copies and JSON manifest are under `/private/tmp/ret-native-review-20261015/captured/` and `manifest.json`. Later amendments require their own evidence; this does not claim an atomic repository-wide snapshot.

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  AGENTS.md
e07cdf668fb07925b457f205810b6161ed99f0940d3b2aa22e10f71a09f69499  Sources/ReTMarkdown/Bridge/AssetSchemeHandler.swift
a1276a7274daf4f7c47ac12e6de829fd562610bed78aa2e54a86ee4f24824e99  Sources/ReTMarkdown/Bridge/BridgeTypes.swift
cf691639b1f2fd30a5a2670cd61a91070fab3fb5bd36a8836439533213bc12c2  Sources/ReTMarkdown/Documents/MarkdownDocument.swift
b79f57e9b62a74941b92b83d2c4f08081e0857bd046746abfa440a4d2c6c80b7  Sources/ReTMarkdown/Export/PDFExporter.swift
d4a4066b7aebf7c1a1a4c62417acf9b79697719d8664c0b7eb650209f48ac8fc  Sources/ReTMarkdown/Storage/AssetStore.swift
cff3047f31687d0f38732e39f533b9098f5b22a51f2aa55e80c11039f80f8d20  Sources/ReTMarkdown/Storage/DraftStore.swift
5c0efca1e974eaca1f6cbd236e76677472204ce8bee0d14be0cdafcc303b8b53  Sources/ReTMarkdown/Storage/NativeAssetIntegration.swift
a94e02a922ab87035a80f0059d0acb7bb38171f838e17f7352e6adc5d52ccf84  Sources/ReTMarkdown/Storage/SourceCodec.swift
554d7ac8f8df0bf0a32c472f40bc4a9e4fa79815837c73d83e5f821dabca6fbc  Tests/ReTMarkdownTests/AssetsTests.swift
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
b144d7f00a5b428523ea370d645e632537895ed4474250bf62bb5bc28de79882  docs/testing/briefs/task-5.md
ab7d6ce549d1f895dda8ebe717784f63208c820577b262885898d7c67fe0ba75  docs/testing/task-5-report.md
96109faf985a08475f8be7de6defbba853910e708fa3172b5b6267973d1bb628  scripts/build-web.mjs
b05fc4b43ca727bc5853ce4036f8b3b02d361fb6968182cf08b4857055bfa3b9  web/index.html
176634d18d6b5afafcc9b237e43de2108ed88cb9bdb36c87af13f1fad36f73cd  web/src/editor/session.ts
64db23d2b9f1bcb57d6f156e183c4212f32b89da2a2a6b9bff3449f8b50d86ce  web/src/main.ts
36fcb034f975f93b73af938c27db1c2a5be6f58da8c089ea38bdf9c30234630f  web/src/render/markdown.ts
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
