# Task 5 recovery / asset identity fixes — round 1

2026-10-15. **Implemented; focused verification GREEN: 38 tests, zero failures.**
R5-1 through R5-4 and the Task 5 portion of cross-R2-2 are covered. This is not a
full-app or GUI acceptance claim. R2-1 and R2-3 controller changes remain Gauss's
ownership; the final focused run compiled his current controller with this adapter.

## Ownership and actual changes

Changed only `Sources/ReTMarkdown/Storage/AssetStore.swift`, `DraftStore.swift`,
`NativeAssetIntegration.swift`, `Tests/ReTMarkdownTests/AssetsTests.swift`, and this
report. Read `AssetSchemeHandler.swift`; its existing frozen-token retention and
validation needed no change. No new production files, subagents, Git operations,
shared build outputs, or controller/bridge/editor source edits were made.

- **R5-1:** recovery namespace is stable UUID plus the hash of the canonical named
  document path, or an explicit `untitled` key. Save As keeps asset lineage and
  wire UUID, switches the recovery binding after successful write, and retains
  the original document's recovery generations. Tests open A and B independently,
  persist separate edits/images, reject a retained A closure after the switch,
  delete original image files and recover each document's own frozen image bytes.
  The same native mirror/bridge instances, selection and undo state survive.
- **R5-2:** staging writes immutable `migration-<UUID>.json` provenance and an
  indexed candidate; it never replaces the target's committed manifest. Candidate
  lookup uses the exact candidate Markdown hash and a change from the pre-stage
  disk identity (device/inode/size/nanosecond mtime/ctime). Identical candidate text
  therefore cannot activate on unchanged disk. After replacement, crash recovery
  selects the exact staged manifest even before adoption. Adoption publishes
  committed provenance; cancellation removes candidate eligibility and retains
  all image bytes. Same-UUID A → B → A cancellation compares the whole target
  manifest both during staging and after cancellation.
- **R5-3:** native scanning accounts for list continuation columns, ordered/nested
  list markers and blockquote prefixes before identifying indented/fenced code.
  Definitions are found at their original UTF-16 offsets inside those containers;
  a definition cannot interrupt a paragraph. Eight cases were checked against the
  repository's installed markdown-it 15.0.2 parser. Two older test inputs placed
  definitions in a paragraph; blank lines now make those fixtures valid Markdown.
- **R5-4:** immutable manifest rebuilds for import, rename and migration retain
  recovery capabilities. Tests delete an unmanaged original, recover its frozen
  bytes, import another image, rename/save, migrate, persist/recover again and
  reopen saved provenance. Every stage retains the original authorized bytes.
- **Cross-R2-2:** durable session tokens separate write eligibility from editor
  revision. Generation sequence remains monotonic within each namespace; revision
  comparison applies within the current epoch. A new r1 supersedes a former r10;
  an old epoch's r99 cannot supersede it. Scoped recovery reads legacy UUID-only
  generations only as a fallback and only for the exact requested canonical URL
  (including nil for untitled), so rotating the epoch preserves previous recovery.
- A related canonical-path regression exposed by these tests is fixed: relative
  managed destinations compare canonical components on both sides, avoiding
  spurious `../../private/tmp/...` paths as Foundation changes `/tmp` aliases.

## Approved shared cross-task contract

Published to controller thread `01a13984-1713-7662-8be6-0247ed29eb69` before
implementation, approved by the main thread, relayed to Gauss, and verified in
his source without editing it:

```swift
// MarkdownDocument, owned by Gauss
var onRecoverySessionReset: (() -> Void)?
```

Invoke synchronously after replacing the mirror for clean read, revert or external
reload, before accepting new commits. Do not invoke for Save As or UUID adoption.
The adapter installs this hook, reloads working provenance, invalidates the cached
asset map and immediately installs a new persistence closure. Epoch creation runs
on the draft actor and is awaited before writes; it does not block MainActor on
storage work. Epoch tasks are ordered within the adapter.

`persistDraft` is captured at commit by Task 2, together with snapshot/UUID, before
its unstructured Task starts. Each installed closure captures its own binding
UUID, DraftStore, AssetStore and epoch task. At entry and after suspension it
requires the current binding and exact current mirror snapshot; it never looks
up a new mutable namespace to publish an old snapshot. DraftStore independently
checks the durable token under a per-namespace nonblocking file lock. Busy locks
surface an I/O error; they do not block an executor indefinitely. Stale epoch
writes are ignored by the adapter; other storage errors propagate.

```swift
// Explicitly scoped production API; nil is the untitled namespace.
DraftStore(rootURL: URL, documentID: UUID, documentURL: URL?)
beginSession() throws -> UUID
persist(snapshot: Snapshot, manifest: AssetManifest, sessionID: UUID?) async throws
recover() throws -> RecoveredDraft?
// RecoveredDraft includes snapshot, manifest, generationURL, sessionID.

// Compatibility API continues the legacy revision stream; it does not start an epoch.
DraftStore(rootURL: URL, documentID: UUID)

// Publication/cancellation now report durable metadata errors.
adoptMigration(_ staged: StagedAssetMigration) throws -> AssetManifest
cancelMigration(_ staged: StagedAssetMigration) throws
```

Generation publication retains the prior complete-generation checks, copied managed
assets and frozen capability bytes. Scoped generations take precedence; corrupt or
incomplete generations fall back to earlier complete generations. Legacy data is
read-only fallback and is never moved, rewritten or deleted during initialization.

**Post-write contract with Gauss's R2-3 PendingFinalization:** advance the committed
disk fingerprint immediately after successful Markdown replacement, retain the
same `PreparedDocumentSave.didWrite` closure on failure, and retry finalization
before another save. Never call `didFail` after committed disk success. `didFail`
is for pre-write cancellation/failure and reports candidate-cancellation errors.

Task 5's `didWrite` retains adoption and patch-applied flags across retries. Once
adoption succeeds, namespace switching occurs once. An already-committed candidate
source is recognized after a lost patch acknowledgement; a successful patch is
marked before `setAssets` can fail, so retry does not apply the base patch twice.
Frozen maps can be rebuilt/re-sent. The closure retains the staged value and assets
through finalization. Save To publishes the copy via a separate store and preserves
the live source binding. In-place rename provenance is published in `didWrite`.
No recovery fix reloads the web editor, replaces its history/selection, or changes
its documentID/sessionID during Save As.

## Actual RED / GREEN evidence

All logs and the isolated package are under `/private/tmp/ret-task5-round1/`.
Tests were written before the relevant fixes; these are behavioral failures, not
missing-symbol claims:

| Run | Actual result |
| --- | --- |
| `red.log` | 5 review-trigger tests, 20 assertion failures: A/B cross-recovery, overwritten committed manifest, container scanner omissions/code false positive, frozen bytes lost, reopen/revert r1 suppressed and asset map missing. |
| `red-additional.log` | 2 tests, 2 failures: identical-text candidate activated before write; migration generated parent paths across `/tmp` aliases. |
| `red-finalization.log` | 1 test failed with `unavailable` on retry after the candidate patch was already committed; the old adapter attempted to apply it again. |
| `green-first.log` | All 36 tests passed after those fixes. |
| `red-legacy.log` | Legacy fallback test had 2 failures: A was missing and untitled restored named B. A supplementary direct epoch stale-writer test already passed. |
| `red-definition.log` | 1 failure: a paragraph continuation was incorrectly authorized as a reference definition. |
| `green-compatibility.log` | All 38 tests passed after legacy scoping and definition-block fixes. |
| `green-final.log` | Fresh current-source compilation; **38 tests, 0 failures**, exit 0, test runtime 0.213 seconds (21:58:47 +0800). Includes stronger A/B frozen-image and selection/undo assertions. |

A test-authoring compile error (`NativeEditorError` is not Equatable) was corrected
before the behavioral `red-finalization.log` run; it is not counted as RED evidence.
An initial parser invocation used an obsolete package entry filename; rerunning
through the package's exported entry succeeded. `renderer-parity.json` records all
eight passing parser comparisons, including the non-definition counterexample.

The independent package contains copies of native Swift sources except AppMain,
a packaging-only `Bundle.module = .main` shim, AssetsTests, and a fixture-directory
link. It does not change storage/document implementations for testing. The runner
bounds each build+test process group to 120 seconds and kills the group on timeout;
all actual runs completed normally. No AppKit file-coordination GUI test was run,
so elevation was unnecessary. Only inaccessible SwiftPM user-cache warnings remain.

Reproduce the final focused run with the retained isolated package:

```sh
python3 /private/tmp/ret-task5-round1/run.py green-final AssetsTests
```

The runner executes `swift test --disable-sandbox` with package, scratch, cache and
module-cache paths exclusively under `/private/tmp/ret-task5-round1`. Final source
SHA-256 capture: `final-source-hashes.json`; a post-run check found no changed
captured workspace sources. This is a focused suite claim, not full-project GREEN.

## Controller acceptance boundaries

The tests prove storage, current native adapter hooks, stable native bridge/selection
state and candidate-commit retry behavior. They do not operate a real CodeMirror
undo stack or WebView process. The assembled-app pass still needs Save As undo/redo,
real setAssets failure after a successful patch ACK, native close/relaunch/versions,
and Gauss's public Save activity/finalization scenarios. No shared app build or
running acceptance app was touched. The scanner has parity for the tested Markdown
containers; it is not a claim to implement every CommonMark extension.
