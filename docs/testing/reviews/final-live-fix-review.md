**FR-1 / FR-2 / FR-4 scoped fix re-review — 2026-10-15**

**Spec: PASS within FR-1/2/4 scope. Quality: PASS within the changed web paths.** The three original P2 findings are resolved for the captured files. No actionable residual or demonstrated regression was established in this review. This verdict does not close FR-3, the separate dirty-SOURCE public Save As investigation, or whole-product/native acceptance.

Read `../final-live-fix-report.md`, all eight changed/new source and test files, the original final findings, and affected renderer/session/table/transport contracts. Reviewed current complete files directly; no Git baseline is implied. No product edits, subagents, shared builds, UI control or broad test reruns were performed.

| Finding | Resolution and affected-path evidence |
| --- | --- |
| **FR-1 — resolved** | `decorations.ts` resolves body links in document context and marks their original source spans with `data-live-link`. New `links.ts` captures explicit Cmd-left-click at the root, including table-widget anchors, and forwards HTTP/HTTPS/mailto through the existing session callback and production `createTransport` `openLink` envelope. Ordinary anchor clicks suppress WebContent navigation while allowing normal editing; composition blocks opening. The tests assert exact URLs/identity, unchanged selection/source/history, reference-definition edit/undo invalidation, unsupported schemes, and table anchors. The native validator remains the final authority; OS browser launch is outside this web verdict. |
| **FR-2 — resolved** | New pure `renderInlineContexts` uses the existing configured renderer and complete reference environment. Exact image spans reuse original parsed image tokens, preserving container-adjusted UTF-16 mapping. Body widgets consume contextual HTML; equality includes that HTML, and cached contexts invalidate on CM document identity changes, so a definition-only edit updates an inactive image. The four browser variants cover full/collapsed/shortcut/continued references, real supplied raster image decoding, missing-local and remote placeholders, reveal/re-hide, and exact BOM/mixed-EOL undo. Native discovery is explicitly not simulated or approved by the supplied test capability. |
| **FR-4 — resolved** | The existing root `markdown` extension now selects bundled JavaScript/Python/JSON languages. Language-scoped highlighting and a scoped base theme supply actual palette colors; unknown fences remain plain. Tests check token DOM and computed number/string colors, real typing, mode changes, root edit/undo commits and exact bytes. The synthetic composition control checks retained marked text and one committed root transaction; it does not claim native IME acceptance. |

The helper parses once per contextual batch rather than creating an independent Markdown grammar. Its fragment fallback retains document references and original-offset mapping, and rendering precedes href extraction so the existing inert file-link rule still applies. It does not serialize source or load resources. The live cache is reused for selection-only updates; composition still maps existing decorations, and asset reconfiguration creates a fresh factory/context. The capture listener is scoped to its own root DOM and removed on destruction. Highlighting is added to the persistent editor state, without a second view or history.

**Change-boundary verification.** Removing only `renderInlineContexts` and its interface/comment from current `markdown.ts` reproduces the previously reviewed SHA-256 `82bf4da4daff0e49d2791bd96b58f49509e4a58f70d008172af501dc3d8d8be8`. Removing only the new highlighting imports/configuration and link plugin, and restoring the replaced anchor-click handler, reproduces the prior session SHA-256 `176634d18d6b5afafcc9b237e43de2108ed88cb9bdb36c87af13f1fad36f73cd`. This confirms the renderer's existing grammar/table/export/clipboard rules and session source/history/composition/command logic were not rewritten. The existing 22-test browser source, `history.ts` and `cell-widget.ts` still match their previously approved fingerprints.

**Execution evidence and limits.** Owner/controller-recorded evidence in the fix report: focused unit **26 passed**, combined browser **32 passed**, full web **189 passed / 1 skipped**, typecheck PASS. The report includes initial missing-helper and original ten browser failures, plus the later real computed-color failure and its correction. This reviewer inspected the actual assertions and production transport harness, but did not rerun those suites or independently claim a fresh browser/native execution. The skipped test is not counted as passing. Fresh review work consisted of source inspection, baseline reconstruction and hash checks.

FR-3 requires its separate native scanner review. The controller reports clean LIVE Save As preserved redo, while dirty SOURCE public keyboard Save As is still under Gauss's narrow investigation. Neither is adjudicated here. Genuine native IME, system close/restoration/Versions settings, full Typora comparison and native Release 20-run performance/RSS remain separate gates. Publishing the changed Web resources and testing OS link launch remain controller work; this review did not inspect or certify a newly packaged app.

**Captured current-file SHA-256 manifest.** A full 13-input manifest is retained at `/private/tmp/ret-final-live-fix-review-20261015/source-hashes.json`; the principal changed inputs are below. These are file hashes, not commits.

```text
c8dbd2eca50cd56b9a3fe0b3e1aa9a0d42a86bc76620d263507eba77f9744ee6  web/src/live/decorations.ts
991b7989982d3f0250c0f683a2e4ac35adcb9ae8085f1599627f265e0dc97eb6  web/src/live/links.ts
43833c9adaf908b7086ffa0009fd57069afb99fbfc4e03d9da764f2df7591d26  web/src/live/code-highlighting.ts
d533d1f6b8d799b883c5de8ba89c95b9e7af1559fdd502f710bcf203e0729976  web/src/editor/session.ts
34564c5ff54f89d12e82c38e26ab986fc1814c3c315c6999936b443db8805074  web/src/render/markdown.ts
0aa4f700ad2edb1f3fd1fea107b93b1e2002446e90943b8d50c6686fd3960100  web/test/final-live-context.test.ts
180d9e3c13ad60a74e49d45b04d40f0919fe0a573c9b348ea42ae368e4b757ce  web/test/final-live.spec.ts
211deee7a95fff13521a113433b1318f5d64fe5417ec649b46a4bd62fe9622af  web/test/final-live-browser-harness.ts
5fbadc5c5d661247286ee2cb505fc3b30ea33be706f600ec3025e3486edd42d2  docs/testing/final-live-fix-report.md
```
