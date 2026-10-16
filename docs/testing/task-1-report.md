# Task 1 — source fidelity and bridge schema

Completed 2026-10-14. Only the six assigned implementation/test files and this explicitly requested report were written in the workspace. No subagents, Git operations, root configuration edits, or other-owner edits.

## Delivered contract

- `web/src/protocol.ts`: architecture-exact `Source`, flat `Snapshot`, `Patch`, `Selection`, `Commit`; discriminated `Envelope<T>`/`BridgeEnvelope<T>`, complete v1 payload map and directional message allowlists. Includes `setReadOnly` at Task 3/controller request for the internal Save As lock. JS entry remains `window.retEditor.receive(envelope)`; native message handler remains `ret` (implemented by their owners).
- `web/src/editor/source.ts`: strict UTF-8 decode; exact leading BOM extraction; LF-normalized UTF-16 text with one original EOL per LF; byte-preserving encoding; simultaneous sorted/nonoverlapping patch validation and application. Rejects CR in normalized text, invalid EOL/cardinality, unsafe/out-of-range offsets, split surrogate boundaries and unpaired inserted surrogates. Original objects/arrays are never mutated.
- `Sources/ReTMarkdown/Bridge/BridgeTypes.swift`: public Codable/Sendable `Source`, `Snapshot`, `Patch`, `Selection`, `Commit`, `SourceRange`, enums and generic `BridgeEnvelope<Payload>`. Initializers: `Source(text:eols:bom:)` defaults to empty/no BOM; `Snapshot(text:eols:bom:revision:)` and `Snapshot(source:revision:)`, with `.source`. `eols` is `[String]`. Snapshot JSON is flat. Required wire fields are not silently defaulted; decoding validates source metadata, safe nonnegative integers, revision advancement, version and type allowlist. Source/Snapshot equality compares text UTF-8 bytes, preserving the distinction between composed and decomposed Unicode. Native bridge retains responsibility for document/session matching, frame origin, payload size, payload dispatch, and document-relative selection checks.
- `Sources/ReTMarkdown/Storage/SourceCodec.swift`: `decode(_:)`, `encode(_:)`, `applying(_:to:)` agree with TS. UTF-16 array indexing permits combining-scalar boundaries and rejects surrogate splits; no grapheme-index substitution or Unicode normalization. Value semantics preserve the input on failure.
- `web/test/source.test.ts`, `Tests/ReTMarkdownTests/SourceCodecTests.swift`: behavioral tests for both codecs and Swift wire validation.

Patches retain provided EOL metadata; choosing a typed newline's terminator belongs to the session. Adjacent zero-width insertions at the same offset preserve supplied order. No final newline is added automatically.

## RED evidence

1. `npm_config_cache=/private/tmp/ret-markdown-npm npx vitest run web/test/source.test.ts`
   - First run failed with missing `../src/editor/source` (before implementation).
   - After publishing typed throwing scaffolds: **40 failed / 16 passed**, expected `Source codec not implemented` failures.
2. Requested package command: `CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang swift test --scratch-path build/swift --cache-path /private/tmp/ret-swiftpm --filter SourceCodecTests`
   - Initial run failed before compilation: nested `sandbox-exec: sandbox_apply: Operation not permitted`.
   - With `--disable-sandbox --config-path /private/tmp/ret-swiftpm-config --security-path /private/tmp/ret-swiftpm-security`, package compilation reached other-owner tests and failed on then-missing `CommittedMirror` / assets implementation.
3. Isolated SwiftPM harness at `/private/tmp/ret-task1-tests` links exactly the two Task 1 Swift sources and `SourceCodecTests.swift`; fixtures resolve to the same workspace `build/fixtures`. No workspace manifest was changed.
   - Throwing codec scaffolds produced expected failures (`invalidUTF8`, `invalidSource`, `invalidPatch`). The Unicode identity test also failed against synthesized Swift `Equatable` as expected.
   - Initial isolated fixture lookup exposed a Foundation symlink lookup problem; resolving the test file symlink before constructing the fixture path corrected the harness lookup.
   - After codec GREEN, additional wire tests produced **19 expected assertion failures** for missing schema validation, then went GREEN after validation was implemented.

The TS malformed UTF-8 parameterized test initially unpacked each byte array into positional arguments; its input callback was corrected to collect those arguments before checking the real decoder. No production behavior was weakened.

## GREEN commands and results

```sh
npm_config_cache=/private/tmp/ret-markdown-npm npx vitest run web/test/source.test.ts
```

Final run at 21:41:13: **56 passed**, exit 0 (1.06 s). Controller independently confirmed the same result.

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang \
SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang \
swift test --package-path /private/tmp/ret-task1-tests \
  --disable-sandbox --scratch-path /private/tmp/ret-task1-tests/.build \
  --cache-path /private/tmp/ret-swiftpm \
  --config-path /private/tmp/ret-swiftpm-config \
  --security-path /private/tmp/ret-swiftpm-security \
  --filter SourceCodecTests
```

Final run at 21:41:02: **14 passed, 0 failures**, exit 0. Log: `/private/tmp/ret-task1-swift-final.log`. Earlier RED logs: `/private/tmp/ret-task1-swift-red.log`, `/private/tmp/ret-task1-schema-red.log`.

```sh
npm_config_cache=/private/tmp/ret-markdown-npm npx tsc --ignoreConfig \
  --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
  --types node,vitest/globals --skipLibCheck \
  web/src/protocol.ts web/src/editor/source.ts web/test/source.test.ts
```

Exit 0. Explicit files were checked because the renderer-owned root tsconfig initially included only renderer paths.

Both language suites read all nine identical controller `.md` fixtures: `bom-crlf`, `mixed-eol`, `unicode-selection`, `unsupported`, `table-locality`, `remote-and-missing`, `regular-256k`, `boundary-1m`, `pagination`. Each asserts its encoded output equals the original fixture bytes, so TS and Swift outputs agree with each other and the controller inputs. The 1 MiB-plus fixture is accepted. Explicit literal cases also assert normalized text/EOL metadata, repeated BOMs, NUL, decomposed Unicode, simultaneous multiple edits, insertion ordering and exact unchanged prefix/suffix bytes. T01/T02/T20 codec-level fidelity is proven; UI/history/native-save acceptance remains with integration owners.

## Full-project verification — external pending failures

At 21:40:59, `npm_config_cache=/private/tmp/ret-markdown-npm npm test` ran **105 tests: 104 passed, 1 failed**. The sole failure was `web/test/session.test.ts` → `one source-first CodeMirror session` → `alternates modes and inverts mixed EOL metadata with the sole CM history`, line 27. Its helper uses `new TextDecoder().decode(encodeSource(s))`, which strips a leading BOM by default, while the expected string includes U+FEFF. Task 3/controller were informed to compare encoded bytes or use `ignoreBOM:true`. No owner file was edited. Log: `/private/tmp/ret-task1-web-full.log`.

Full `swift test --disable-sandbox --scratch-path build/swift --cache-path /private/tmp/ret-swiftpm --config-path /private/tmp/ret-swiftpm-config --security-path /private/tmp/ret-swiftpm-security` with the same cache environment exited 1 during compilation: `Tests/ReTMarkdownTests/AssetsTests.swift:32:88: cannot find type 'AssetStore' in scope`. Log: `/private/tmp/ret-task1-swift-full.log`. The project-wide Swift suite and package-filtered source test therefore remain pending other-owner implementation. The isolated source suite above is green; this report does not claim the whole project is green.
