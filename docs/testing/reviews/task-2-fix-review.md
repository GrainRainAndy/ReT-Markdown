# Task 2 scoped native fix re-review

2026-10-15. Supersedes the open status of R2-1, R2-2 and R2-3 in `task-2-review.md` for the captured implementation below.

**Spec verdict: PASS within R2-1..3 scope.**

**Quality verdict: PASS within R2-1..3 scope.** No actionable remaining defect or demonstrated regression was found in these fixes and the reviewed cross-component paths.

**Scope and method.** Follow-up to the original independent native review, limited to the named findings, their shared save/recovery contract, and newly affected paths. Read current production implementations, regression tests, implementation reports and retained execution logs. No product changes, shared build writes, app manipulation, Git operations, subagents or redundant test runs were performed. Existing executed results below are attributed to their logs; this review does not claim a fresh suite run. PDF retains its separate completed scoped review and was not re-reviewed.

| Original finding | Resolution and reviewed evidence |
| --- | --- |
| **R2-1 — resolved**: public Save activity/main-thread hang | `MarkdownDocument.swift:185–209` defers Save, Save As, Revert and Versions before opening a competing synchronous activity; `:429–455` does the same for Close. `:401–427` delivers captured superclass saving and final completion through the document continuation APIs. The real public-save regression at `SaveTests.swift:17–86` runs menu/menu **and** autosave/menu scenarios in separate XCTest children, each with an external monotonic eight-second deadline, and asserts a main-run-loop heartbeat during 100 ms suspended preparation, two successful native callbacks, expected disk bytes and clean final state. The original code failed this test after 8.128 seconds in `build/task2/activity-red.log`; the final combined case passes in 0.565 seconds in the authoritative focused log. This directly covers the public native activity missing from the initial low-level save tests. |
| **R2-2 — resolved across Tasks 2/5**: reset wire revision suppresses current-session drafts | `MarkdownDocument.swift:129–139` synchronously calls `onRecoverySessionReset` after replacing mirror/bridge, before the new session can commit. `NativeAssetIntegration.swift:38–54`, `:100–125` rebinds the scoped store and captures a durable session token in each persistence closure. `DraftStore.swift:35–53`, `:70–85` separates URL/UUID recovery namespace, session eligibility and within-session editor revision. New r1 can supersede prior r10; delayed old-epoch r99 cannot supersede it. `AssetsTests.swift:238–269` verifies named reopen, subsequent reset/revert, latest recovery and typed-image map refresh; `:40–59` verifies durable old-writer rejection and same-session ordering. The final Task 5 source/test hashes match current files. See `task-5-fix-review.md` for the storage verdict. |
| **R2-3 — resolved**: committed write is misclassified as external on retry | `MarkdownDocument.swift:348–387` records the byte-derived committed disk fingerprint before awaiting resource/JS finalization, retains the original prepared callback/receipt/operation/lock requirement, and leaves pending finalization dirty. Both autosave (`:255–282`) and ordinary save (`:329–343`) use this contract. Retry checks the actual target fingerprint and reuses that retained finalizer before preparing another write. Pre-write failure still calls `didFail`; committed-write acknowledgement failure retains resources. `SaveTests.swift:89–129` uses actual NSDocument writes for initial in-place and initial Save As failures, requires the original finalizer to be called twice, checks dirty/autosave state and zero post-commit cancellations, then verifies retry and another Save As. `:132–154` replaces the file externally after failure and verifies retry preserves those external bytes and never re-enters the finalizer. `build/task2/finalization-red.log` records the prior false conflict; the final focused log records both tests passing. |

**Newly affected autosave/activity path.** `MarkdownDocument.swift:211–254` captures the bridge barrier, immutable snapshot, exact revision tokens and resource/draft preparation before `super.autosave`. Its callback to `save(to:)` consumes that preparation and starts captured `super.save` inline (`:255–297`), preserving autosave's native file-access nesting. Only completed disk-write finalization then becomes asynchronous. `SaveCoordinator.swift:37–54` supplies the same monotonic revision check and completed-write receipt for the inline autosave path and queued manual path; the document save tail serializes both. Synchronous `data(ofType:)`, NSDocument safe writing/file coordination and per-revision change-count tokens remain in use. The implementation therefore addresses the distinct autosave nesting failure described in the fix report rather than merely adding a wrapper around the original menu-only case.

**Cross-task contract.** Task 5's migration finalizer retains adoption/patch-applied flags (`NativeAssetIntegration.swift:188–218`), recognizes an already-committed candidate after lost acknowledgement, and switches recovery binding once without replacing the live mirror, bridge, wire identity, selection or history. A failed durable adoption now throws and is retried through Task 2's retained finalizer. This is the explicitly coordinated replacement for the original no-fallible-adoption handoff; it does not cancel staged resources or undo the successful Markdown write. The already-committed-patch regression at `AssetsTests.swift:62–81` passes in the shared full run.

**Execution evidence read.** `build/task2/fix-focused-final.log`, 21:58:11 +0800: **18 tests, zero failures** (7 bridge, 11 save). `build/task2/fix-all-swift.log`, 21:59:02: **79 tests, 78 passed, 1 skipped, zero failures**, including 38 asset tests. The skip is the opt-in graphical PDF runtime test. These recorded runs replace the initial 15-test evidence for this scoped fix; neither was rerun by this reviewer.

**Acceptance boundary.** This closes the original code-review findings and the native public-entry regression gate. Main still owns republishing the app and repeating the original no-edit sample save followed by newly typed untitled Cmd-S, real WebView Save As/cancel, IME, close settings and restoration/version flows. The native delegate tests do not claim keyboard/panel acceptance in the packaged app. No additional test rerun is required for this unchanged captured review snapshot.


**Captured SHA-256 manifest.** Capture UTC: 2026-10-15T14:02:51.053458+00:00. Direct current-file review in this non-Git workspace; immutable copies and JSON are under `/private/tmp/ret-native-fix-review-20261015/`. The Task 5 final test-source manifest was compared with the workspace: all 18 entries match. Reviewed inputs were checked again before delivery.

```text
06b9dd457026ab81a190af95cb02dace4ee204ed4fa9bb8c0617bc9e1ab792a8  /private/tmp/ret-task5-round1/final-source-hashes.json
7893fe9ddf466382b30eaf66b4b4445f35ec64f34fb662ddf1ab61e9d97978fc  /private/tmp/ret-task5-round1/green-final.log
eba8533a3d5b135adcad96ece5a1723fd3371dc832c4f716ffe5cd150cb94524  Sources/ReTMarkdown/Bridge/EditorBridge.swift
965e915d2fde678d13d43b866694245f243002af37f1e76341309e5c2d539841  Sources/ReTMarkdown/Documents/MarkdownDocument.swift
a33f1b17230d85e4cc44eb18d44a96f086db16dccbdafd337c5d437c5642e227  Sources/ReTMarkdown/Storage/AssetStore.swift
028e47228dda2108f70b70d619b6dad2be47a879ad8606df33fd4aebe44324bf  Sources/ReTMarkdown/Storage/DraftStore.swift
42cf35f413688ea1471d5041ef40ee964ebbf450665383ce9b5f133a3c0b3db9  Sources/ReTMarkdown/Storage/ExternalChanges.swift
283fae43257e087a9390a8c004b9d74fc84ec6c4bb84178097a15db6119210a1  Sources/ReTMarkdown/Storage/NativeAssetIntegration.swift
2f6eac49b9d2db6c22262be0d514ee7d44213664e30788d4a6c4a82182a3d202  Sources/ReTMarkdown/Storage/SaveCoordinator.swift
90f30afdc25b1da39495bdf1c383afbc955c51e8d84b625ce5ba2e2bc4135fe3  Tests/ReTMarkdownTests/AssetsTests.swift
d835cf238f376260f39fd57b68f0c654aa02832653f108e4ffb90aecdbccb38a  Tests/ReTMarkdownTests/SaveTests.swift
4b6e1f49b9984c4d9a47eea7288e73da4ddce188af90c51a2802ea75337013f8  build/task2/activity-red.log
0f2ec5c852b1f8eceb1d72e3c2681253ad4f7250c3889f1d20f7b233eb3263be  build/task2/finalization-red.log
5ee0a59a8e2f6b61c45791721c1c676551a9375ff16a8519a89beb0f53e0f41d  build/task2/fix-all-swift.log
0efcf1c5acc2638fbc6a53e20f1f69b10b1c1811866e1140b33bdf362c52add6  build/task2/fix-focused-final.log
27b0b112d8bf5f3455ddc76ef30a452fc5488ddb321c87b967db522201274145  docs/architecture/2026-10-14-native-editor.md
aa1506a9fce3c1bd536ef79c0ec45ad25197df4a065f1f3555dcc980ec3da47c  docs/specs/2026-10-14-markdown-editor-design.md
349d3541ddb991db5dbc9ec834fc331b42c10341309aa0d021424dbaadd09f8c  docs/testing/reviews/task-2-review.md
90dc6085fd162452e8bc196f31c25cbad085cba45d901ebfddd0a18f4afafcf0  docs/testing/task-2-fix-report.md
049ff1f9e62ffdaf2009a70e96e600ce6005f3849f7f98a83d8c0336b298a476  docs/testing/task-5-fix-report.md
```
