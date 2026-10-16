Task 2 independent native review — 2026-10-15

**Spec verdict: CHANGES REQUIRED.** F10/F11 are not met in the concrete activity, recovery and retry cases below.

**Quality verdict: CHANGES REQUIRED.** Public NSDocument activity serialization is a release blocker; passing low-level save tests does not establish the public save lifecycle. Two additional integration defects are reproduced.

**Review basis.** Independent native integration review, 2026-10-15, against `AGENTS.md`, the complete native architecture, F09–F17 and relevant source/offline requirements in the spec, each assigned task brief and implementation report. This is a non-Git workspace: the owned source files were inspected directly as complete additions, not as a commit diff. Cross-component evidence is used where the actual integration contract requires it. Product code, shared builds and the running acceptance app were not changed; no subagents were used. Current macOS 27.0.1 arm64 is the acceptance target; Windows and older macOS compatibility are not findings.

**Evidence policy.** Existing suites were read, not rerun: Task 2 15/15; Task 5 28/28; the later approved native full-suite log records 66 tests, **65 passed, 1 skipped, 0 failed**. This supersedes the historical Task 2 report's earlier asset-alias failure. The 5-page and 27-page production PDF proofs remain valid evidence for their inputs. Passing these cases does not cover the concrete triggers below. New probes were confined to `/private/tmp/ret-native-review-20261015`, used captured production source, and were added only for risks found in review. The native probe uses a packaging-only `Bundle.module = .main` shim and omits `AppMain`; it does not change storage/document implementations or create a WebView. Swift 6 compilation succeeded. The restricted run could not access AppKit file coordination (Cocoa 256); an approved elevated, 45-second-bounded run completed normally. That sandbox limitation is not a product finding.

**Findings (ordered by severity).**

1. **R2-1 — P1: Public Save can block the main thread on an outstanding document activity.** Location: `Sources/ReTMarkdown/Documents/MarkdownDocument.swift:162–181`, `:228–233`; public entry wired at `App/MenuController.swift:22`. The override returns after launching an unstructured MainActor task, and later enters `super.save` and its completion after multiple suspensions. It does not preserve/re-enter the originating NSDocument activity context. The controller's real trigger was Cmd-S in a newly typed untitled second document after the sample's no-edit save. `build/native-save-sample.txt:58–64`, PID 80819, 2026-10-15 21:34:19 +0800, records **all 1,701 main-thread samples** in `_saveDocumentWithDelegate:` → `performActivityWithSynchronousWaiting:` → `_performActivity:` → `_NSDocumentSerializationSemaphore wait`. This is direct GUI evidence, not a hypothetical deadlock. The stack proves the public entry is blocked; loss of nesting across the async handoff is the source-based explanation under investigation, not independently established solely by that stack. The original owner is fixing this; do not implement a competing fix. Preserve the public activity continuation contract around the barrier/write/completion path, including failure/cancel and close/autosave interactions. Acceptance requires the actual public Save/Save As entry, a main-run-loop heartbeat while asynchronous preparation is suspended, and a second save afterward. `SaveTests` directly calling `save(to:...)` is insufficient. **Status at initial report: OPEN; owner fix/retest pending.**

2. **R2-2 — P1: Named reopen/revert resets revisions while the persistent draft rejects every lower revision.** Location: `Documents/MarkdownDocument.swift:112–120` (new `Snapshot(source:)` has revision 0), `:98–105` (stable UUID adoption); interacting code `Storage/DraftStore.swift:29–35` and `Storage/NativeAssetIntegration.swift:35–42`. After a named document has a retained r10 draft, clean reopen retains its UUID but begins at r0. Its next edit r1 is a new session's current content, yet `persist` rejects it as stale and the adapter silently returns. This also skips the subsequent live-image refresh. The native adapter probe prints `REOPEN sameID=true initialRevision=0 recovered=old session draft revision=10` after persisting `new session edit` at r1. Crash recovery therefore keeps old content rather than the new edits until revisions exceed the previous lifetime's high-water mark. Revert/external reload uses the same reset path. Introduce a persisted generation/session ordering distinct from editor revision, or explicitly rebase the newly loaded editor above the retained recovery boundary; preserve protection against genuinely delayed writes. Regression: save/close/reopen a named UUID, make fewer edits than the old revision, verify latest draft and newly typed image capabilities; repeat after revert. Task 5 must share this fix contract; this is one cross-component finding, not a second duplicate finding in its report.

3. **R2-3 — P2: Post-write finalization failure makes the next save conflict with the app's own successful write.** Location: `Documents/MarkdownDocument.swift:191–200`. `prepared.didWrite()` can throw after NSDocument has replaced the target (e.g. Task 5's asset patch acknowledgement or asset-map update loses the WebView). The catch exits before updating `diskFingerprint`, although the disk bytes and possibly `fileURL` have already changed. On retry, `ExternalChanges.requireUnchanged` compares the new file with the old fingerprint and rejects it as an external edit. The probe uses the actual NSDocument safe-write path, injects `processLost` only in `didWrite`, then restores the hook and retries: first result `processLost`; second result underlying `externalConflict`; disk contains `written`; document remains dirty. Dirty retention is correct, but Retry is broken without any external writer. Record the committed disk identity immediately after successful write, independently from editor finalization, and retain a separately retryable finalization state. Do not clear later edits or bypass a real external change. Regression must include failed acknowledgement after Save As and successful retry/recovery as well as the existing pre-write failure case.

**Spec/quality assessment beyond findings.** `EditorBridge` validates page/frame/session, source metadata and commit ordering; duplicate commits do not reapply text. Captured older snapshots are checked against byte hashes without regressing the newer mirror. Revision-specific AppKit tokens are taken before resource preparation suspends, and synchronous `data(ofType:)` uses captured bytes. SaveCoordinator orders immutable requests and rejects older completed revisions. In-place coordination checks disk fingerprints, and byte-based dirty state correctly allows undo to saved bytes. Untitled autosave keeps formal dirty identity separate from autosave need. File identity deduplication, one-window configuration, sole JS undo, public version/restoration hooks and adapter/PDF installation are present. These strengths do not resolve the public-activity hang or recovery/retry findings. No unverified preference or minimum-OS objection is being raised.

**Targeted evidence and limits.** `probe-elevated.log` in the review scratch directory records the fresh integration reproductions, exit 0. `Probe.swift` contains the exact probes. Existing `build/task2/final-focused.log` confirms 15 tests with zero failures at 18:33:30; `/private/tmp/ret-task6-swift-full-final.log` confirms the later 66/1-skip/0-failure result at 18:50:16. Real Finder/window restoration, system close settings, versions, native IME and main GUI acceptance remain controller-owned. The real Save hang is an observed failed gate, not merely an unexecuted acceptance item. Do not mark Task 2 approved until the owner fix has specific public-entry evidence and the other findings are addressed.


**Captured file hash manifest (SHA-256).** Initial capture UTC: 2026-10-15T13:31:57.103729+00:00. Paths below identify the exact complete additions/dependencies reviewed. The immutable review copies and JSON manifest are under `/private/tmp/ret-native-review-20261015/captured/` and `manifest.json`. Later amendments require their own evidence; this does not claim an atomic repository-wide snapshot.

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  AGENTS.md
163eef5f739439f68c50787aa611c4aadebcfb729358fdee8cfeac440382d558  Package.swift
6a0ed48e69ab5342e4c49cc32b95e3ce7029138e3b208b1fb9810f0c9379495a  Resources/Info.plist
c1d7347009f743822294c7e9eab3b9c52f26acd0179a2b69b86104e18be99127  Sources/ReTMarkdown/App/AppDelegate.swift
086c7523e0f2d50e00ccce0a37130162575ae73f1d8c3781cdb3e06e4956f84f  Sources/ReTMarkdown/App/AppMain.swift
200ceeb1ce4776877e63082143af6f499eb5ac6fead8757a3afc557288f6219c  Sources/ReTMarkdown/App/MenuController.swift
a1276a7274daf4f7c47ac12e6de829fd562610bed78aa2e54a86ee4f24824e99  Sources/ReTMarkdown/Bridge/BridgeTypes.swift
eba8533a3d5b135adcad96ece5a1723fd3371dc832c4f716ffe5cd150cb94524  Sources/ReTMarkdown/Bridge/EditorBridge.swift
afed755719014ba652f6fd2cd1d0d71068df8711a25df468a65996765c2ecc28  Sources/ReTMarkdown/Bridge/EditorWebView.swift
15680ee815b809146e599bc7fd026bdcf084c3233001dd5bb390b7d60b4d6940  Sources/ReTMarkdown/Documents/DocumentController.swift
b1a37d8ff9318b18a2a5020f8699a3b14f0ff90f3881387b7c9c5cca4ed57da1  Sources/ReTMarkdown/Documents/DocumentWindowController.swift
cf691639b1f2fd30a5a2670cd61a91070fab3fb5bd36a8836439533213bc12c2  Sources/ReTMarkdown/Documents/MarkdownDocument.swift
d4a4066b7aebf7c1a1a4c62417acf9b79697719d8664c0b7eb650209f48ac8fc  Sources/ReTMarkdown/Storage/AssetStore.swift
cff3047f31687d0f38732e39f533b9098f5b22a51f2aa55e80c11039f80f8d20  Sources/ReTMarkdown/Storage/DraftStore.swift
42cf35f413688ea1471d5041ef40ee964ebbf450665383ce9b5f133a3c0b3db9  Sources/ReTMarkdown/Storage/ExternalChanges.swift
5c0efca1e974eaca1f6cbd236e76677472204ce8bee0d14be0cdafcc303b8b53  Sources/ReTMarkdown/Storage/NativeAssetIntegration.swift
13cd54f040a75a0d8cbeceedac6098f6a408ce258870e1d6a36bfc21df62da00  Sources/ReTMarkdown/Storage/SaveCoordinator.swift
a94e02a922ab87035a80f0059d0acb7bb38171f838e17f7352e6adc5d52ccf84  Sources/ReTMarkdown/Storage/SourceCodec.swift
f181b43975f2b15b3bb17f14ea873c3aa96a7823d4d87fdf6afc9a8bc9ea8ff5  Tests/ReTMarkdownTests/BridgeTests.swift
c3e18367f2727bdd8983d0d4806e4eb6546cbbecd9dc6ccb109609ef47023521  Tests/ReTMarkdownTests/SaveTests.swift
4edd7db86b96128e8d4849d80fcefed14888dbe6536cd78061c01d88fbe75b9c  build/native-save-sample.txt
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
953a35df4e22f109093e08420a775f31bafb8be3d16bf1f695f275669ac47414  docs/testing/briefs/task-2.md
dbff037870aca84bc32d38b6d8e9511155f99068aa767a9b13517a8126ffe8d8  docs/testing/task-2-report.md
31cf0741ab20059222578e6aaf6dd7feadfd3225c028159df3b315016331c8ed  scripts/build-app.sh
176634d18d6b5afafcc9b237e43de2108ed88cb9bdb36c87af13f1fad36f73cd  web/src/editor/session.ts
64db23d2b9f1bcb57d6f156e183c4212f32b89da2a2a6b9bff3449f8b50d86ce  web/src/main.ts
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
