# Task 5 — local assets, durable drafts and migration

Implemented 2026-10-14–15. Scope is the storage/capability subsystem and the explicitly authorized native adapter. Native UI acceptance remains with the controller and Task 2/3 owners.

## Changed files

- `Sources/ReTMarkdown/Storage/AssetStore.swift` — public asset models, immutable import/provenance, canonical URL identity index, destination scanning, staged migration and retained history aliases.
- `Sources/ReTMarkdown/Storage/DraftStore.swift` — complete atomic recovery generations and stale-revision protection.
- `Sources/ReTMarkdown/Bridge/AssetSchemeHandler.swift` — exact `ret-resource` capability serving, frozen image bytes, live updates and exact bundled-resource allowlists.
- `Sources/ReTMarkdown/Storage/NativeAssetIntegration.swift` — authorized focused adapter installing Task 2 hooks; native chooser/paste/drop and Task 3 insertion commands.
- `Tests/ReTMarkdownTests/AssetsTests.swift` — 28 focused tests using generated fixtures and actual temporary files/directories.
- `docs/testing/task-5-report.md` — this report.

No other owner's source files, fixtures, root configuration, Git state or shared web/app build outputs were modified by Task 5. No subagents were started.

## RED / GREEN evidence

Initial `swift test --filter AssetsTests` failed on missing Task 1/native dependencies; after those landed, the focused suite failed on missing `AssetStore`. Additional tests failed on missing `AssetSchemeHandler.update` and `AssetStore.documentIdentity` before those interfaces were implemented.

Behavioral RED runs on the actual filesystem:

- 19 tests: provenance reopen failed after destination creation. Investigation reproduced Foundation changing `/private/tmp/...` to `/tmp/...` once a file exists; metadata keys now use `realpath` with an existing-ancestor fallback, stable before and after creation.
- 22 tests: the old managed Markdown reference did not exist beside the newly saved document. Migration now also copies immutable history aliases inside the destination document directory. A conflicting user-owned alias fails without overwrite.
- 26 tests: recovered unmanaged frozen bytes were dropped, and typed local references did not update the live capability map. Recovery now retains the authorized frozen fallback; the adapter updates live maps as destination sets change.
- 28 tests: a new import after draft recovery modified the completed generation and produced a parent-directory reference. Restored stores now use a working resource directory for new imports and preserve completed generations.

Final GREEN command (independent Task 5 scratch output):

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang \
SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang \
swift test --disable-sandbox --scratch-path build/swift-task5 \
  --cache-path /private/tmp/ret-swiftpm --filter AssetsTests
```

Result: **28 tests, 0 failures**, exit 0; runtime 0.139 seconds. Final log: `/private/tmp/ret-assets-final-green.log`. `--disable-sandbox` is required because nested SwiftPM `sandbox-exec` failed with `sandbox_apply: Operation not permitted`; this is a build-harness setting, not an application permission prompt. Only SwiftPM's inaccessible user-cache warnings remain.

The tests exercise Chinese/space/colliding names, durable managed identity, a directory-blocked import/copy, actual EACCES on provenance writes, failed Markdown replacement after successful resource copies, cancellation, exact mixed-EOL fixture bytes, damaged/incomplete generations, corrupt/missing images, stale revisions across restart, reference-token locality, inline/fenced/indented code exclusion, title/angle/full/collapsed/shortcut reference syntax, local parent paths, final symlink replacement, remote/arbitrary capability rejection, active SVG/DTD/external-resource rejection, untitled autosave, UUID restoration, named installer adoption, frozen unmanaged recovery and immutable generations after recovery.

## Published contracts

All model fields below are immutable `let` values. Persistent models are Codable/Sendable; PDF receives independent frozen Data values.

```swift
AssetCapability(url: URL, data: Data, mimeType: String)
ManagedAsset(assetID: UUID, destination: String, fileURL: URL,
             sha256: String, aliases: [String] = [])
AssetManifest(documentID: UUID, documentURL: URL?, resourceDirectoryURL: URL,
              managedAssets: [ManagedAsset] = [],
              capabilities: [String: AssetCapability] = [:])
// manifest.capabilityMap: [String: String]
// manifest.resolveImage(_ destination: String) -> String?
// ImportedAsset: assetID, destination, fileURL; markdownDestination aliases destination.
```

`AssetStore` is an actor. Its initializer takes `documentID`, `rootURL`, optional `documentURL` and optional `recoveredManifest`.

```swift
importImage(data: Data, suggestedName: String, documentID: UUID) async throws -> ImportedAsset
planMigration(snapshot: Snapshot, to: URL) async throws -> AssetMigration
planMigration(snapshot: Snapshot, to: URL, references: [AssetReference]) throws -> AssetMigration
authorizedManifest(destinations: [String]) throws -> AssetManifest
stageMigration(_ migration: AssetMigration,
               acceptingUnmanagedBreakage: Bool = false) throws -> StagedAssetMigration
adoptMigration(_ staged: StagedAssetMigration) -> AssetManifest
cancelMigration(_ staged: StagedAssetMigration)
documentDidRename(to: URL) throws
static documentIdentity(for documentURL: URL, rootURL: URL) throws -> UUID?
```

`AssetMigration` exposes `id`, `documentID`, `destination`, `copies`, `patches`, `unmanagedBrokenReferences`, `candidateSnapshot`, `candidateManifest`, `baseManifest`. Patches target destination tokens only, preserve BOM/EOL metadata and retain the barrier revision until the editor commits the successful adoption. `AssetReferences.scan(_ text: String) -> [AssetReference]` returns exact UTF-16 destination ranges; callers with grammar-owned ranges can use the explicit-reference overload.

Host order is **barrier/short edit lock → plan → explicit acceptance of reported unmanaged breakage → stage → coordinated write of candidateSnapshot → didWrite/adopt and applyPatches → unlock**. `didFail` cancels the store's pending token. Resource/provenance failures happen before Markdown is written; adoption has no fallible disk I/O. Staged URL-index candidates activate only when the exact candidate Markdown hash exists on disk, including crash-after-write recovery; failed writes preserve the previous target's committed identity. Normal saves promote the current identity, and renames retain the resource directory. Imported files, original migration sources, historical aliases and completed generations are never automatically deleted.

```swift
DraftStore(rootURL: URL, documentID: UUID)
persist(snapshot: Snapshot, manifest: AssetManifest) async throws
recover() throws -> RecoveredDraft? // snapshot, manifest, generationURL
```

Each completed generation contains snapshot/manifest hashes, all managed image copies and frozen authorized capability bytes. Files and directories are synchronized before atomic generation publication. Recovery verifies every managed file hash and falls back to an older complete generation. Stale revisions cannot supersede newer generations, including after process restart.

```swift
@MainActor AssetSchemeHandler(manifest: AssetManifest,
                             bundledResources: [URL: AssetCapability] = [:])
// scheme = "ret-resource"
update(manifest: AssetManifest)
resource(for: URL) throws -> AssetCapability
static bundledResources(rootURL: URL, paths: [String]) throws -> [URL: AssetCapability]
```

Image URLs are opaque `ret-resource://asset/<UUID>` tokens. The handler never translates requests to filesystem paths or network fetches. Native canonical/file-descriptor checks happen before freezing bytes; legitimate source references containing `../` are supported. Live updates retain older capability tokens for history. PDF creates its own handler from one frozen manifest and does not update it. SVG uses a deliberately conservative static subset; script, event attributes, DTD/entities, style/external fetches and unsupported active constructs are rejected. Raster bytes are decoded through ImageIO before authorization. Bundled files use a separately supplied exact allowlist and CSP.

## Native integration ready

```swift
@MainActor
NativeAssetIntegration.install(on document: MarkdownDocument,
                               rootURL: URL? = nil) throws -> NativeAssetIntegration
adapter.authorizedManifest(for snapshot: Snapshot) async throws -> AssetManifest
```

Default application root is Application Support/ReTMarkdown. `AssetStore`'s root and `documentIdentity`'s root are **that root plus `provenance/`**; draft generations are under `drafts/`. The installer itself performs canonical URL identity lookup and calls Task 2's `document.adoptPersistentIdentity(_:)` before constructing the store. Restored UUID hooks rebind storage before editor load. Hooks retain the adapter; it holds the document weakly.

The adapter installs `prepareResources`/`didWrite`/`didFail`, `persistDraft`, `configureWebView`, `refreshAssets`, `handleDrop`, `restoreDraft`, `onIdentityRestored` and `assetRequest`. `.autosaveElsewhereOperation` writes recovery only and never migrates to the system autosave URL. Normal in-place saves do not rewrite references. Paste/drop values are captured synchronously from native NSPasteboard; asynchronous imports use those captured values. No path supplied by a web assetRequest is treated as a file capability.

Native maps use load `assets` and command `setAssets {assets: map}`. Image insertion uses Task 3's `insertImage {destinations: [String], destination: String, alt: String}` command, one editor-owned transaction. PDF installation consumes `{ snapshot in try await adapter.authorizedManifest(for: snapshot) }`. These contracts and identity semantics have been sent to the controller; Task 2's AppDelegate wiring and Task 3's destination insertion implementation are present in the current shared workspace.

## Concerns / controller acceptance still required

- These focused tests prove storage and adapter contracts; they do not establish real window restoration, NSDocument versions, sheet cancellation, image-only OS paste/chooser/drag, WebView process recovery or edit-lock timing. Controller still verifies T08/T11/T12/T18/T22/T23 with the assembled app, including Save As failure/cancel and historical image references restored by NSDocument versions.
- A successful disk write followed by a lost editor acknowledgement is handled as native finalization failure by Task 2. Exercise retry/process-loss behavior with the real bridge; focused filesystem tests do not prove that UI path.
- SVG support intentionally rejects content outside the static allowlist (including style blocks and DTD/comments). Safe generated SVG fixtures pass; broader SVG compatibility is not claimed.
- The native scanner covers the tested Markdown destination forms and exposes an exact-range overload; it is not a second Markdown renderer. Grammar edge cases and shared reference definitions should be checked against renderer/editor parsing during integration.
- No release performance, total RSS/bundle size or full-project GREEN claim is made by this task. No shared `build/web` or app assembly was published.
