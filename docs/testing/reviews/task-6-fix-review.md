# Task 6 R6-1 scoped export-mapping fix re-review

Date: 2026-10-15. Reviewed current files directly against R6-1 in `task-6-review.md` and `../task-6-fix-report.md`, including the authorized renderer helper described in `../task-4-fix-report.md`. Scope is export DOM/source range association and regressions in its affected decode/overflow diagnostics. Native GUI/epoch work and a new native PDF acceptance run are outside this gate. Current-file hashes appear below.

## Spec verdict: PASS within R6-1 scope

**R6-1 — Resolved.** `web/src/export.ts:96–102` obtains block ranges from `blockSourceRanges(source)` and pairs them with root DOM children. The independent `MarkdownIt({html:false})` parser has been removed. The helper at `render/markdown.ts:140–149` calls the same private configured `md.parse` and `createEnv` used by rendering, including atomic HTML, task lists, tables, references and math. It selects mapped level-zero opening/standalone tokens, excludes inline/closing tokens and translates normalized line starts through original offsets. Non-rendering reference definitions introduce no extra block.

For the original multiline-comment-plus-wide-formula trigger, `export.test.ts:155–163` requires overflow range **[24,242)**, preserved input and literal/inert comment rendering. The opt-in Chromium test at `:241–247` asserts that same range with real geometry. This replaces the erroneous comment fragment **[12,23)**.

| Affected path | Evidence and assessment |
| --- | --- |
| Following block after complex prefixes | `export.test.ts:165–173` verifies formula localization after a multiline HTML element, comment plus task list, comment plus table and non-rendering reference definition. The helper and HTML now share the same root-block sequence. |
| Nested formula overflow | `:175–181` exercises production host overflow collection and reveals the enclosing task list/table after HTML. The containing root range is intentional for layout diagnostics. |
| Actual host image-decode rejection | `:183–202` mounts production HTML and substitutes only the image decode operation. The returned issue identifies the containing paragraph/list/table, not a preceding HTML fragment. |
| Precise renderer errors | `prepareExport` still copies the renderer's own issue ranges directly; block metadata is used by decode/layout diagnostics. Existing missing-image and invalid/unclosed-math tests retain exact token coordinates. |
| Frozen input/readiness | Existing snapshot/capability freezing, font/image barriers, layout measurement, timeout and error-blocking tests remain. Mapping takes the same frozen source string that produced the mounted HTML. |

## Quality verdict: PASS within R6-1 scope

The fix removes the duplicated grammar that caused the defect. The new helper does not expose parser state, invoke a resolver, load resources or alter source; ranges are derived synchronously from per-call parsing state. Level-zero container selection avoids counting nested list/table content as additional root DOM elements, and non-rendered reference definitions do not shift subsequent ranges. The normalized line-start/original-offset translation preserves UTF-16 and CRLF coordinates at the helper boundary; export snapshots themselves remain LF-normalized.

Index pairing still relies on one rendered root element per selected top-level token. Inspection of the current configured renderer supports that invariant: paragraphs/headings/lists/quotes/tables/fences/rules, escaped atomic HTML and display math each emit one root element. The affected-path regressions specifically exercise the cases that broke the previous independent grammar. No new mismatch or affected-path regression was identified.

The authorized helper addition leaves existing renderer behavior intact: removing the two new helper functions from current `markdown.ts` reproduces the prior reviewed file hash `36fcb034f975f93b73af938c27db1c2a5be6f58da8c089ea38bdf9c30234630f`; the separately reviewed math and source-position files are unchanged. This scoped review does not reopen unrelated renderer or native findings.

## Verification and native evidence boundaries

Read the existing `/private/tmp/ret-task6-fixround1/` logs: `green-focused.log` records **21 passed, 1 skipped**; `green-browser.log` records **22 passed**, including opt-in Chromium; `green-full.log` records **187 passed, 1 skipped**. The owner's report records successful focused/full typecheck exit statuses; their empty diagnostic logs are consistent with that report but do not independently encode exit status. Task 4 additionally records **24 live units, 39 renderer/build tests and 22 live browser tests** after the helper integration. No existing test, typecheck, build or native proof was rerun during this review.

The original 5-page and 27-page native PDFs remain historical evidence for their original inputs, not newly generated proof of this mapping fix. Fresh hash comparison confirms `PDFExporter.swift`, `PrintProfile.swift` and `PDFTests.swift` are byte-identical to their initial Task 6 review manifest. Their production Swift print/output path is therefore unchanged by this scoped round. The new browser proof establishes source localization and preflight behavior; it does not claim renewed WKWebView pagination, native PDF geometry or GUI/epoch acceptance.

Fresh review work comprised current source/test inspection, recorded-log inspection and hash checks. No uncovered concrete risk justified rerunning recorded checks. No product writes, subagents, Git operations or shared builds were performed. Only the two requested fix-review documents were authored. R6-1 is closed for the manifested files; no further work is required within this scoped review gate.

## Current-file SHA-256 manifest

Hashes identify the reviewed current implementation, tests, reports and existing execution logs. Native hashes are included solely to substantiate the unchanged-path comparison, not a new native code review. Inputs were checked again before delivery.

```text
537857c077526535b8420e095b7e07868233309f0a5fc08f4fe18ad3515d1205  /private/tmp/ret-task6-fixround1/green-browser.log
21cc0f438170bcaf5f0a3713ade010d92d331fadeadec02e88eea9d93af07b85  /private/tmp/ret-task6-fixround1/green-focused.log
3cbb06ef919bfb2125576bb1703d29859fe8ccf0d025d4e283cfcd3228e3c78a  /private/tmp/ret-task6-fixround1/green-full.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /private/tmp/ret-task6-fixround1/typecheck-focused.log
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /private/tmp/ret-task6-fixround1/typecheck-full.log
b79f57e9b62a74941b92b83d2c4f08081e0857bd046746abfa440a4d2c6c80b7  Sources/ReTMarkdown/Export/PDFExporter.swift
283afbc18a840a8063a64859bbdc6e0167a4f54a4d551fdb32fab6934b816a4b  Sources/ReTMarkdown/Export/PrintProfile.swift
078f8e4848bbcde2f7fdf9683798c8f43f6149104294ec4d42c39059b75994e3  Tests/ReTMarkdownTests/PDFTests.swift
9dcd684a24135cfeb4ce38de4a66b74194dea95f7b90d85bea4b76ecb38da16e  docs/testing/briefs/task-6.md
3bb8e57d97f432dfdafb041bd77576c2109b5d91df68414ad8bfe3d5a93545ad  docs/testing/reviews/task-6-review.md
854134af024a0f05f02c718711ec3842096047ff6ccb3cb14f77181a694b433b  docs/testing/task-4-fix-report.md
31a81d3384703385039e44e6118b4311641d02ac806c1e7ebdf061980c578bed  docs/testing/task-6-fix-report.md
499649c0b497ed031bf21b1f29e5a53b9a49101d6f432eb13e68050ba754f860  node_modules/markdown-it/dist/markdown-it.mjs
ab263c54fb2bedfce5b3cd309b6f9f412d0936bd043ca9eddf10482ad79cd254  package-lock.json
45f1a3500562db03a4e1833bd8a44cc1d0fcd9c4ab79955409f45dea41b3664a  package.json
28189a125eb4a08667c2e52e15fea941c650f73d84993feb6245942fc61bb364  web/src/export-main.ts
e86c6e9039a49fb1aa20794e7a47696e9c1c8c38d45addad66380a687ff40197  web/src/export.ts
82bf4da4daff0e49d2791bd96b58f49509e4a58f70d008172af501dc3d8d8be8  web/src/render/markdown.ts
c1dd964695182497d101a0fff972fee68a45572c3cbfa15fa6f36be114d278f2  web/src/render/math.ts
f9838bedac84f0e76c4942c259f23dfb6f2ef87b98e6195ee22c5d177302076a  web/src/render/positions.ts
9b9739683e21cc3bf69f6053a5eb2bd5d86c355d7ba173eb8277c1d136107130  web/test/export.test.ts
```
