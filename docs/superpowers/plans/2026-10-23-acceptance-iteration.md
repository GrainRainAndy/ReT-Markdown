# Acceptance Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. User has authorized implementation and subsequent independent acceptance handoff.

**Goal:** Repair the acceptance report's correctness defects and specified editing gaps, produce alpha.2 with reproducible evidence, and submit it for independent re-acceptance.

**Architecture:** Keep source-authoritative DocumentSession and the native document bridge. Repair projection/source anchors and focus transfer without weakening recovery validation. Make flush, close, termination and recovery removal explicit completion barriers.

**Tech Stack:** TypeScript, ProseMirror, CodeMirror 6, AppKit, WKWebView, Swift.

**Spec:** `docs/verification/2026-10-23-rewrite-acceptance-review.md`, with existing `docs/specs/requirements.md` and `docs/specs/editing-contracts.md`.

## Global Constraints

- Work in the existing authorized `rewrite/from-zero` checkout. Preserve the legacy archive and external acceptance edits. Do not copy legacy or Typora implementation.
- Preserve source bytes when no edit occurs, root undo history, reverse selection and IME ownership. Never suppress a safety check to obtain a passing test.
- Use isolated test files/recovery directories; do not discard user documents or force-kill their application. UI automation uses CUA only.
- Native IME, native interactive matrix and visual comparison require actual evidence; synthetic browser events and CLI tests must be labeled accurately.
- X01–X03 belong to this repair iteration. X04–X06 are the next style-extension milestone, explicitly documented with API, security, example and print acceptance deliverables; default A4/20mm printing remains mandatory now.
- New candidate is `0.2.0-alpha.2 (2)` at `build/rewrite/0.2.0-alpha.2/ReT Markdown Preview.app`; preserve alpha.1.
- Tests/evidence live under `build/rewrite/verification/2026-10-23/iteration-2/`; durable findings and scope belong in tracked docs. Commit explicit paths only. Workers do not spawn agents.

## Review Focus

- Newly typed fence and language text: preserve intent across focus transition, Enter, reverse selection and undo.
- Empty nested literals and CRLF: add only necessary container syntax without closing an unclosed block.
- Reentrant close/quit during input or asynchronous save: every caller completes once; cancellation preserves editing and late work cannot overwrite discard.
- Dirty web input with clean native snapshot: termination must flush every open document and wait for durable recovery cleanup.
- Virtual table cells and collapsed math: selection/focus remains usable without mutating source merely by rendering.

### Task 1: Repair editor input and source-preserving projection

**Files:** `editor/surfaces/{rich,commands,projection}.ts`, `editor/syntax/projection.ts`, `editor/render/document.ts`, relevant `tests/surfaces/*`, new `tests/browser/acceptance-iteration.spec.ts`.

**Interfaces:** Preserve DocumentSession transaction/history API, LiteralEditor callbacks and projection mapping contracts. Report any new metadata for virtual table cells or focus ownership for subsequent tasks. Do not change native protocol.

**Scope:** B01, B02, B04, B05, B06; X01 behavior matrix for repaired interactions. Read report sections 3 and 7 plus existing editing contracts. Evidence probes under `build/rewrite/verification/2026-10-23/acceptance-review/` are reproductions, not expected-success tests.

- [ ] Add failing tests for typing backticks/tilde plus language then Enter and `xhello` without clicking; committed source must contain text, no recovery, correct literal focus. Include undo/redo and source-mode round trip.
- [ ] Add model/browser tests for empty bare and nested quote/list fences, empty math, with/without LF, CRLF; editing must keep valid prefix/newline anchors and not auto-close an unclosed block.
- [ ] Repair owner transfer and literal insertion using parsed source boundaries, preserving safety checks and source selections; run focused tests and retain pre/post evidence.
- [ ] Add failing ragged-table cases: header width governs rendering/navigation; virtual missing cells editable; extra cells hidden but source preserved until edit. Materialize only necessary syntax when editing a missing cell. Check live and exported HTML.
- [ ] Assert linked image inherits link, inline math inherits strong, command-click routes through existing link bridge; leading same-line indentation creates no fake gap, real blank lines still do.
- [ ] Implement projection/export fixes and run `npm test`, `npm run typecheck`, focused Playwright tests. Document X01 entry/edit/blur/exit behaviors and remaining native evidence in `docs/specs/editing-contracts.md` without claiming final acceptance.
- [ ] Self-review and commit product/tests/contracts with explicit paths; write report with regressions, commands/results and commit IDs.

### Task 2: Complete pending input and native lifecycle barriers

**Files:** `editor/main.ts`, `native/Sources/ReTPreview/{App,Document,EditorHost,Recovery}.swift`, relevant native/browser tests. May extract a focused lifecycle coordinator if needed.

**Interfaces:** Retain protocol v1 envelope and source/checkpoint semantics. Flush request IDs must remain outstanding while composition is pending, settle exactly once after a valid commit, and expose bounded timeout/cancel. Task 1 preserves these APIs; read its report only for changed ownership metadata.

**Scope:** B03, B07, R01, R02, EV01. Read report sections 3/4/7 and current native code. Isolate all recovery experiments. Do not claim real IME results from synthetic events.

- [ ] Reproduce overlapping `canClose` while prepare/save/flush is suspended; assert both delegates complete exactly once, deterministic result, no late write after discard and editing survives cancellation.
- [ ] Implement explicit coalescing or rejection of duplicate close requests. Prevent quit/close-all waiting indefinitely; tests must cover overlapping rather than sequential calls.
- [ ] Add pending-composition flush regression: no premature failure; compositionend commits and resumes original action once; timeout/cancel/stale responses and multiple requests behave deterministically. Implement web/native pending wait without forcing compositionend.
- [ ] Add an application termination barrier covering every open MarkdownDocument including native-clean/Web-dirty documents. Test clean/dirty/multiple windows, late checkpoints, save-in-flight, cancel/retry and repeated termination; integrate with NSDocument review without duplicate save prompts or recursion.
- [ ] Make confirmed-close recovery cleanup durable before normal termination can complete, without deleting real recovery data or allowing queued writes to resurrect a closed document. Use controlled child-process exit/reopen evidence; identify the actual durability boundary and failure policy.
- [ ] Replace EV01 no-op reload tests with a real host/handshake or focused seam that proves entry before delayed interleavings. Assert handshake entry and then fault timing.
- [ ] Run targeted native/browser tests and full `swift test --package-path native`; retain logs and child-process evidence. Self-review and commit explicit paths, with report separating proved behavior from native UI/IME still needing acceptance.

### Task 3: Special-block UX, visual baseline and candidate build

**Files:** `editor/surfaces/{literal,rich}.ts`, `editor/styles.css`, `editor/typography.ts`, `editor/render/*` as needed, dependency manifests/notices if adding bundled highlighting, `scripts/build-app.sh`, new/updated browser tests, `docs/specs/editing-contracts.md`, `docs/verification/2026-10-23-iteration-2.md`.

**Interfaces:** Preserve repaired source/history/focus APIs from Task 1 and pending flush from Task 2. Language highlighting is an offline presentation extension and never edits source. Print rendering remains independent of screen viewport and collapsed editor state.

**Scope:** UX01/UX02 and X01–X03, version alpha.2. Use shipped reference CSS/evidence as observations only; no product dependency on reference assets. Read REA skill if examining shipped Typora artifacts. Reference docs/code APIs must be verified from primary sources when needed.

- [ ] Add browser tests for known-language token styling, unknown-language plaintext fallback, changing language without body/selection/history loss; implement bundled offline syntax highlighting with maintained CM6 language packages, keeping notices accurate.
- [ ] Add tests that valid math hides its source after blur, click restores bookmark/focus, error math stays editable and recovery text never becomes source. Implement state-driven visibility without DOM/source loss or scroll jumps; include undo and mode switching.
- [ ] Record entry/edit/blur/exit contracts for paragraph/heading/list/quote/code/math/table and source, paste, menu, reverse selection, undo/save-reopen coverage. Avoid representing untested interactions as verified.
- [ ] Define reproducible Github samples, reference hash, actual font/fallback, 100% zoom, narrow/normal/wide light/dark screenshots and measured typography/layout. Compare concrete title, width, spacing, list, quote, code, table, math and selection values; document deviations. Use allowed runtime tools for actual reference observations; report unavailable evidence honestly.
- [ ] Bump package, lock and build script to `0.2.0-alpha.2 (2)`. Build new candidate without replacing alpha.1. Run complete unit/browser/typecheck/Swift/build/sign checks and print-layout regressions; produce identity manifest bound to final source commit.
- [ ] Write tracked iteration report mapping each B/R/EV/UX/X item to evidence, remaining native acceptance checks and explicit next-milestone X04–X06 deliverables (versioned style API, safe local assets, example theme, fallback/upgrade, default independent print). Commit explicit paths; report verification log/artifact locations.

## Controller completion and handoff

- Review each task with separate read-only reviewer (spec and quality verdicts); run one final branch review and address material findings.
- On the same final candidate, attempt authorized CUA native close/input/save/export checks using only independent temporary documents. Preserve user state. Record inability to reach a process as unverified, never a pass.
- Preserve source identity and evidence, update README candidate/status without erasing failed baseline report. Submit concrete report, build identity, closure map and remaining checks to the existing acceptance thread `01a163b6-c43f-70c0-a96b-24d3972164bc` under the user's explicit handoff authorization.
- No merge, push or release publication. Independent acceptance owns the acceptance verdict.
