# Task 3 independent spec and quality review

Date: 2026-10-15. Reviewed against `docs/testing/briefs/task-3.md`, `docs/testing/task-3-report.md`, the architecture, and F04–F08/F12–F14 of the product spec.

## Scope and evidence

The review target is the complete new-file snapshot `docs/testing/reviews/task-3.diff`, SHA-256 `e00bf6570e31764fba718d368a7edb8e5e98e715cfb511eae1c36311a3b92471`. All twelve captured files matched the working files when compared. Locations below are source-file line numbers in that snapshot.

The owner's **25 focused tests, typecheck, and file-browser check are recorded evidence, not independently rerun results**. The reported full-suite table failure belongs to Task 4 and does not determine this verdict. Review-specific probes bundled the matching Task 3 source into `/private/tmp` and exercised commands, clipboard conversion, renderer resolution, and transport with jsdom. They did not rebuild shared output or modify product/test files. No Git operations or subagents were used.

## Spec verdict: CHANGES REQUIRED

The central Task 3 architecture is implemented, but findings S1–S5 demonstrate failures in its formatting, clipboard, and asset-resolution contracts. These failures are reproducible without connecting Task 4's live factory.

| Contract | Assessment |
| --- | --- |
| Single CodeMirror history; mixed EOL/BOM fidelity | `history.ts:41` installs the EOL field, transaction extender and inverse effects alongside CM history. `session.ts:189` applies patch batches as isolated transactions. Recorded tests cover alternating modes, grouped typing, EOL-only edits, undo/redo and replay into a native-style mirror. No additional defect established here. |
| Committed versus provisional IME state | `session.ts:145`–`:148` returns the separate committed snapshot and committed selection during composition. Dispatch accumulates changes at `:166`; `endComposition` publishes the net edit at `:216`. Mode/live reconfiguration waits. Synthetic evidence supports this contract; it does not prove real macOS candidate input. |
| Mode, appearance, zoom and state availability | Compartment reconfiguration preserves the root document/view and adds no history event. `status()` disables undo/redo while composing or locked and publishes selection/mode/revision. Recorded selection, focus and screen-zoom checks cover the basic session contract. |
| Commands and source find/replace | Source ranges include hidden syntax; replace-all uses one root transaction. Formatting has the concrete context failures S1, S2 and S5. |
| Clipboard and paste routing | Full inline source selections expand to delimiters; source mode retains selected raw EOLs. Rich output includes text fallback; text paste takes precedence over image import. Reference-link plain/rich copy fails S3. |
| Structured transport, revisions and acknowledgements | Version/session/document/type validation, structured receiver replies, duplicate execution suppression, ordered commit publication, retained outbox, snapshot acknowledgement and stale asset-base rejection are present. Clipboard requests wait for native results; chooser/import requests return immediately to avoid the native command-queue deadlock. No proven persistence corruption found. |
| Asset-map refresh and Save As lock | Maps replace capabilities without source transactions; live refresh defers during composition. The lock rejects content commands and patch edits, filters user document transactions, rejects locking during composition, and permits native asset adoption. Resolution has the percent-decoding defect S4. |
| Native plural image insertion | Supplied destinations take precedence over the single fallback, insert in one transaction, inherit line EOLs and avoid reopening the chooser. Recorded tests cover Unicode/spaces/alt escaping and one-step undo. S4 concerns subsequent capability resolution, not plural transaction construction. |

### S1 — P2 / Important: indenting a parent detaches its child

**Location:** `web/src/editor/commands.ts:55`–`:71`, especially `:70`.

**Real trigger:** In `- previous\n- parent\n  - child\n- next`, place the caret in `parent` and invoke `format {kind:'indent'}` (Tab / Indent List). The implementation edits only selected lines, producing `- previous\n  - parent\n  - child\n- next`. The renderer confirms that `parent` and `child` are now siblings under `previous`; the child has lost its relationship to the parent. This violates F06's requirement to adjust necessary child items when changing list level.

**Action:** Include the affected item's descendant lines in the indentation transaction, preserving their relative indentation and unrelated source.

**Necessary test:** Indent a parent with nested children and an unselected following sibling, using mixed CRLF/LF/CR. Assert the child remains below its parent, the sibling and EOL metadata are unchanged, and one undo restores identical initial bytes. Cover the corresponding outdent path.

### S2 — P2 / Important: Code Block can produce an invalid opening fence

**Location:** `web/src/editor/commands.ts:35`–`:38` and the generic wrapper at `:19`–`:24`.

**Real trigger:** Select `chosen` at `[7,13)` in `before chosen after` and invoke `format {kind:'codeBlock'}`. Actual source is `before ```\nchosen\n``` after`. The fixed renderer leaves `chosen` in a paragraph and interprets the final line as a new opening fence with language `after`; it does not render the selected text as code. Invoking the command at the end of `paragraph` similarly inserts the opening fence on the prose line. F06 exposes this command without a line-boundary precondition.

**Action:** Make the fence insertion respect Markdown block boundaries, adding only the necessary separators and preserving surrounding text/EOLs.

**Necessary test:** Apply Code Block to a selection inside a paragraph and to a collapsed caret at paragraph end. Assert the intended content is inside a rendered fenced code block, surrounding prose remains intact, and one undo restores the original mixed-EOL bytes.

### S3 — P2 / Important: plain/rich copy drops reference-link context

**Location:** `web/src/editor/clipboard.ts:49`–`:53`.

**Real trigger:** For `[label][ref]\n\n[ref]: https://example.com`, select the visible label at `[1,6)` in live mode. Source copy correctly returns `[label][ref]`. Plain copy also returns `[label][ref]` instead of `label`; rich copy contains literal `[label][ref]` and no anchor. The helper receives only the selected fragment, so the definition outside the selection is unavailable. Reference links are explicitly in F08, and F06/T24 require visible plain text and the selected content's rich representation.

**Action:** Supply the relevant document reference definitions as conversion context while keeping default source copy equal to the selected original source. Keep the renderer helper APIs unchanged.

**Necessary test:** Copy a reference link whose definition is outside the selection in all three formats. Assert exact source copy, plain `label`, rich anchor plus text fallback, unchanged revision/history, and no remote resource requests. Include collapsed/shortcut references and reference-style images in the same context coverage.

### S4 — P2 / Important: decoding an already decoded image path selects the wrong capability

**Location:** `web/src/main.ts:55`–`:59`, specifically decoded-key precedence at `:59`.

**Real trigger:** A native destination `a%2520b.png` represents a filename containing the literal characters `%20`. Install valid capabilities for `a%20b.png` → `ret-resource://asset/literal-percent` and `a b.png` → `ret-resource://asset/space` (the encoded alias `a%2520b.png` can also be present). Native insertion produces `![](<a%2520b.png>)`. The fixed renderer decodes once and calls the resolver with `a%20b.png`; the transport decodes again and chooses the space-file capability before the exact key. The probe rendered `<img src="ret-resource://asset/space" ...>`. With only the percent-file capability present, this particular path falls back correctly; the collision exposes the wrong-image defect.

**Action:** Respect the renderer's decoded-destination contract and preserve exact capability-key identity. Avoid a second decode taking precedence over an exact match. Native destinations are already URL-escaped; blindly escaping every `%` during insertion would introduce another error.

**Necessary test:** Load or refresh a map containing distinct literal-percent and space filenames, insert native plural destinations including `a%2520b.png`, and render using the installed resolver. Assert each image selects its own opaque capability before and after `setAssets`, with unchanged source/revision during the map update and no network access.

### S5 — P2 / Important: Enter treats code text as a Markdown list

**Location:** `web/src/editor/commands.ts:40`–`:50`; invoked unconditionally by the root Enter binding at `web/src/editor/session.ts:72`.

**Real trigger:** Inside the fenced block ` ```\n- item\n``` ` (without the outer spaces), put the caret after `item` and press Enter. Actual content becomes ` ```\n- item\n- \n``` `. The regex recognizes a list prefix without checking whether the line is code. Numbered code lines are incremented similarly, and an empty code line containing `- ` is erased by the empty-item branch. These are code-content edits, not continuation of an actual Markdown list.

**Action:** Restrict list continuation/exit to actual list-item context; retain ordinary newline/indent behavior inside fenced or indented code.

**Necessary test:** Enter after unordered/numbered-looking text and an empty marker inside fenced and indented code. Assert no marker insertion/removal, inherited EOLs, and byte-identical undo. Retain the existing `-`, `+`, `*`, ordered and task-list continuation cases outside code.

## Quality verdict: CHANGES REQUIRED

The separation between source metadata, session/history, pure commands, clipboard conversion and transport is sound. Defensive snapshots, inverse EOL effects, native result handling, atomic plural insertion and the explicit live adapter are useful safeguards. The five reproduced P2 defects above are sufficient to require changes; no additional style-only or speculative quality findings are raised. No P0/P1 defect was established.

Repair and run the necessary focused regressions above, then let the controller perform the final integrated checks. The recorded green suite does not exercise these triggers.

## Boundaries retained for final review

- **Live factory connection and actual widgets:** The controller has not connected the factory in this review baseline; Task 4 owns widget behavior. Its absence is not a Task 3 defect or evidence that live editing/v1 is complete.
- **Native acceptance:** Real WKWebView Chinese IME, OS clipboard/image operations, Save As failure/cancel orchestration, menu/UI behavior, PDF and performance remain with their owners and the parallel native/UI verification. This review establishes no native acceptance result.
- **Root build changes:** `web/index.html` and `scripts/build-web.mjs` are listed in the report but absent from the twelve-file snapshot. Their post-task changes and final packaged output require final review; this verdict does not approve them.
- **Other probes not promoted to findings:** A late acknowledgement after a newer snapshot acknowledgement is rejected, but no lost content or blocked native operation was demonstrated. Directly injecting the internal EOL restore effect can bypass the text-change lock; no supported user/live editing path to that operation was established. Neither observation is counted as an actionable defect.

Task 3 contract review is complete; acceptance remains blocked on S1–S5, independently of the final product gates above.
