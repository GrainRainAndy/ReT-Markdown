# Performance harness and baselines

## Current reacceptance collection (2026-10-16, 01:10:39–01:12:04 UTC)

Authoritative current raw samples: [performance-reacceptance-final/performance.json](../../build/performance-reacceptance-final/performance.json). All 18 series × 20 samples completed, exit 0, errors `[]`, source changes `[]`. Product sources were frozen and matched the independent review; all owned agents/probes and other heavy tests/build/native UI actions had ended before this loop. Other user workload was not controlled.

| Fixture/mode | Open → editable P95 ms | Input → visible RAF P95 ms |
| --- | ---: | ---: |
| Blank/live | 54.4 | 32.1 |
| Regular/source | 64.8 | 32.1 |
| Regular/live | 130.8 | 49.8 |
| Boundary/source | 103.0 | 32.1 |
| Boundary/live | 564.5 | 208.9 |

Regular live input meets the 50ms component comparison with little headroom; this is not a native input certification or a guarantee under other workloads. Boundary input is diagnostic only. Native Release startup/RSS/IME/PDF timing sequences remain unmeasured. The unchanged script measured the final `build/candidate-20261016/ReT Markdown.app` artifact at 11,954,223 logical bytes; it does not infer native performance from bundle size. Do not interpret differences from prior collections as causal speedups or regressions without controlled comparisons. Earlier collections below are historical.

## Acceptance correction rerun (2026-10-16)

Current frozen-source results: `build/performance-acceptance-final/performance.json`; 18 series × 20 samples, errors `[]`, source changes `[]`, exit 0. P95 milliseconds:

| Fixture/mode | Open → editable | Input → visible RAF |
| --- | ---: | ---: |
| Blank/live | 48.4 | 32.1 |
| Regular/source | 63.7 | 33.6 |
| Regular/live | 129.5 | 44.9 |
| Boundary/source | 98.6 | 32.0 |
| Boundary/live | 555.0 | 206.6 |

Regular input passes the 50ms component comparison; boundary input remains diagnostic only. Native Release cold startup, RSS, real IME and repeated PDF timings remain unmeasured. No native UI actions or controller heavy tests ran during this final loop; other user workload was not controlled. The preceding incomplete regression run remains at `build/performance-acceptance/performance.json`; indexed containment and monotonic block scans resolved the confirmed quadratic projection work. See [fix evidence](acceptance-projection-performance-fix.md). The following 10/15 collections are historical.

## Controller rerun after FR-1/2/4 (2026-10-15 23:20)

The earlier stable collection below is historical. After the live context/link/highlighting corrections, the controller reran the unchanged harness into `build/performance-final/performance.json`: all 18 series × 20 samples completed, errors `[]`, source changes `[]`, all ten images decoded. Regular live input P95 is **48.3 ms**, source input **31.7 ms**; boundary live first-editable **844.2 ms**, source **119.6 ms**. Boundary live input **231.8 ms** remains supplemental. Browser engine/cache, concurrent native diagnostic activity and workload were not controlled, so differences are observations, not causal speedup/regression claims. Native Release acceptance remains unmeasured. The artifact inventory for that run was 11.40 MiB; it included an opt-in native diagnostic build and is not the final release inventory.

Status: **final browser collection complete; native Release acceptance
unmeasured**. After the controller announced stable web sources, the final run
completed all 18 timing series × 20 samples, with no errors or web fingerprint
changes. The first incomplete snapshot is preserved separately. Native source
work and possible concurrent compilation load were not controlled; no native
Release performance claim follows from these component measurements.

## Final stable web baseline

Authoritative raw samples and evidence:
[build/performance-stable/performance.json](../../build/performance-stable/performance.json).
Run: 2026-10-15 13:54:01–13:55:22 UTC. Same browser/host configuration as the first
run below. All values are P95 in milliseconds, each from 20 observations.

| Fixture/mode | Open → editable | Input → visible RAF | Open → actual FCP | Navigation → actual FCP |
| --- | ---: | ---: | ---: | ---: |
| Blank/live | 43.2 | 32.1 | — | — |
| Regular/source | 62.8 | 33.5 | 88.0 | 184.0 |
| Regular/live | 161.1 | 32.5 | 161.7 | 260.0 |
| Boundary/source | 100.3 | 248.8 | 332.1 | 452.0 |
| Boundary/live | 1321.1 | 187.4 | 1012.9 | 1132.0 |

Regular input is below the 50 ms component comparison in both modes; boundary
open is below the 2 s component comparison. **Boundary input is diagnostic only,
with no 50 ms threshold.** Blank widget load is not cold application startup.
The empty document has no fixture FCP series. P95 values are computed separately
for each series; subtracting two P95 values does not yield another series' P95.

The final script awaited actual delayed FCP entries before typing, retaining
Chromium's paint/presentation fields. All input samples have trusted
`insertText` events, exact source preservation, focus and one revision increment.
All ten real local images decoded successfully. There were 1,251 local page
requests, no external page requests or failed resources, and no source changes
among the 19 captured web/configuration inputs. The owned Chromium process was
verified to have exited afterward.

Script SHA-256:
`81c4441841b5d52ad2229955ec04f63f0a65814229d5e2b66722017339d7de4a`.
Frozen harness bundle SHA-256:
`ee5409a1c4dd081dc69061d0835efec6cb296a2b4cb36b25b3104eedc8642f17`.

## Reproduce independently

From the repository root, with the existing dependencies and generated fixtures:

```sh
node scripts/measure-performance.mjs --outdir build/performance
# Or keep all benchmark output separate from shared build products:
node scripts/measure-performance.mjs --outdir /private/tmp/ret-performance-stable
```

The script discovers cached Chromium, or accepts `--chromium /absolute/path` or
`RET_CHROMIUM`. It does not install dependencies, download browsers, invoke the
root build, publish a bundle, or launch/control the native application. In the
Codex filesystem sandbox Chromium launch needs execution outside that sandbox;
the successful run used that permission for its own headless browser only.

`--fixtures DIR`, `--bundle APP`, `--timeout-ms 15000` and
`--deadline-ms 600000` are supported. There are always 20 repetitions, performed
round-robin across five scenarios. Individual sample timeouts close their owned
context before the next sample. The overall deadline checkpoints incomplete
results and shuts down only the owned Chromium process. No source, fixture,
root bundle, root build resource or test file is written.

Output is `OUTDIR/performance.json`, with raw samples, per-sample evidence,
nearest-rank P95 (19th sorted observation), fixture/source hashes, browser/host
details, resource audit, and actual bundle inventory. Previous JSON is preserved
under `OUTDIR/history/<sha256>.json` on subsequent runs. Generated harness
resources and two browser screenshots stay in OUTDIR. Exit 0 means completed
browser measurements within applicable component comparison budgets; it does
**not** mean native acceptance passed. Exit 1 indicates an over-budget comparison
or measured oversized artifact; exit 2 indicates incomplete evidence. Failed or
missing observations remain null and never become zero or get dropped from P95.

## Preserved first run

Raw original: [performance-first-run.json](../../build/performance/performance-first-run.json).
SHA-256: `0b92bc08737908f656d1e956c0ea6115c2d2d673a9c78243204fc607b96f4011`.
The original is byte-for-byte preserved, including its historical boundary input
budget labels. [performance.json](../../build/performance/performance.json)
contains identical timing arrays with corrected classification metadata:
**50 ms applies only to regular 256 KiB input**. Boundary and blank input have
no specified threshold. Neither historical label is a native product failure.

Collection: 2026-10-15 13:47:02–13:48:21 UTC. Apple M5, arm64, 10 logical CPUs,
32 GiB RAM, Darwin 27.0.0, Node v26.11.1, cached Chromium 149.0.7827.55, headless,
1000×900 CSS pixels, device scale 1. Other machine workload was not controlled;
native Release build provenance was not verified.

| Fixture/mode | Open → first editable P95 | Trusted input → visible RAF P95 | Interpretation |
| --- | ---: | ---: | --- |
| Blank/live | 51.4 ms | 32.1 ms | Widget diagnostic; not native cold startup |
| Regular/source | 64.5 ms | 33.1 ms | Browser comparison to regular 50 ms target |
| Regular/live | 175.7 ms | 35.8 ms | Browser comparison to regular 50 ms target |
| Boundary/source | 103.4 ms | 274.5 ms | Open comparison to 2 s; input diagnostic only |
| Boundary/live | 1376.6 ms | 196.3 ms | Open comparison to 2 s; input diagnostic only |

Every table cell has 20 real observations in the preserved JSON. These are
component measurements against a frozen browser bundle. They do not establish
native WKWebView target compliance or certify the current, actively edited source.

Navigation first-contentful-paint was queried too early in that collection:
three fixture/mode series have 0/20 observations and regular/live has 1/20.
Their P95 is correctly null. Do not substitute first editable or navigation load
for first paint. A separate short browser diagnostic confirmed that real paint
entries arrive asynchronously after the second RAF. The final script waits
for the actual FCP entry **before typing**, records navigation FCP and open-to-FCP
as separate 20-sample series, and retains engine paint/presentation fields when
Chromium supplies them. The subsequent authorized stable run above completed all
20 observations in each of those series. Native first-paint/startup acceptance
remains unmeasured.

## What is measured

The standalone esbuild bundle uses `write:false`, production optimization and
`keepNames:true`: markdown-it adapters look up parser rules by function name, so
ordinary name mangling changes behavior. It imports the actual product transport,
CodeMirror session/source codec and live extensions; no mock parser, editor,
clock, timing sample or renderer is used. Local styles and fonts are copied into
its private harness directory. A fresh context/page is used for each sample in
one warm browser process; browser engine and OS file caches are not cold.

Fixture bytes are frozen before the timer. Open begins immediately before the
real source codec decodes them, includes transport load, mode configuration,
appearance/zoom, font readiness and focus, and ends after visible caret geometry
and editability survive two RAF callbacks. Exact complete source is verified
afterward, followed by actual successful typing. Native disk read and IPC are
excluded. Browser FCP is a separate paint-entry timestamp, not the open timer.

Input is one real Playwright `keyboard.type('x')` at the end of the first line.
Capture starts at the trusted `beforeinput` event timestamp, before editor
handlers. The endpoint checks the committed source character, a visible DOM Range
for that glyph, and a subsequent RAF with the glyph still visible. Exact full
source, focus and one revision increment are verified. This measures the
requested event-to-visible-RAF interval; it does not measure hardware input
queueing or physical display presentation. A JSON-only loopback acknowledges
real transport commits, without claiming native persistence or IPC.

The regular fixture is 262,157 bytes, with 20 code blocks, 20 formulas and ten
local SVG images. Its SHA-256 is
`35c7ef133edbc754dbf52f134cffb0768f6651e0f0e98a0654ae09832280958a`.
The boundary fixture is 1,048,762 bytes, SHA-256
`2e424b51040a7e48f9c60a74a88dd3772c4e2fe57b59c6fedd9e44a57933d9e4`.
It is already **186 bytes over 1 MiB** and was opened without truncation or
rejection, then edited in both modes for all 20 samples. This proves only the
tested size; arbitrarily larger files are not covered.

Manifest-verified SVG bytes are copied to private `file://` resources. The actual
resolver receives those URLs; the production resolver rejects SVG data URLs.
All ten live image widgets were scrolled into view and decoded at 640×480, with
matching resource hashes. This resource audit is outside the timed intervals.
Document requests were local, with no page resource failures or external
requests. Offline browser contexts, blocked nonlocal schemes and the existing
CSP enforce that boundary. This is not an OS-wide network capture.

The sampled live implementation reparses the whole source on each transaction:
`decorations.ts` passes `state.doc.toString()` to `syntaxSpans`, whose implementation
invokes both the Lezer and markdown-it parsers. The 1 MiB timings retain that cost.
It is a concrete scaling concern, not a profiled attribution of all delay.
Source mode also showed appreciable boundary input latency. Preserve both
diagnostics when comparing later repairs; do not reject large files or weaken
source/IME correctness to improve these numbers. No product code was changed.

## Native measurements still required

| Native requirement | State |
| --- | --- |
| Cold Release launch → blank editable, P95 ≤3 s | Unmeasured; widget load cannot substitute |
| Running application open 1 MiB → editable, P95 ≤2 s | Unmeasured; native IO/IPC/WebKit excluded |
| Regular fixture visible ordinary input, P95 ≤50 ms | Unmeasured in native WKWebView |
| Real Chinese candidate commit, P95 ≤100 ms | Unmeasured |
| Native paginated PDF, P95 ≤15 s | Unmeasured |
| App + dedicated WebContent RSS ≤512 MiB | Unmeasured; PID ownership not established |
| Release bundle ≤80 MiB | Existing artifact measured; Release provenance unverified |

Actual existing `build/ReT Markdown.app` file-tree sum: **11,620,285 bytes
(11.082 MiB)**. The JSON contains every regular file's size and hash, with tree
digest `a11ed9465c214a4d1f3d6be6fd4a4709d120f18679235156315624c09c862617`.
This is logical file size, not disk allocation, a rebuild, or a claim about the
eventual controller-published Release bundle. Reinventory that final artifact.

For future native acceptance, the controller should use a known Release bundle,
without a debugger, after active repairs settle. Measure 20 independently owned
native process launches from process launch to an explicit blank-editor-ready
signal after a visible frame. Separately measure running-app file open and real
input commit to visible frame, with the same fixtures. Starting a browser,
constructing a WKWebView, loading a widget, or reopening a window is not a cold
application launch. Do not force-quit the existing user application; use an
isolated benchmark instance and recovery/storage locations, with orderly cleanup
of only its own processes. Do not change OS preferences.

For RSS, record the owned native PID and evidence that each selected WebContent
PID belongs exclusively to that benchmark window/process pool. A generic
`WebContent` name, parent PID or system-wide sum is not sufficient attribution.
After the regular document stabilizes, record each PID's resident bytes and sum
only that identified set. If ownership is ambiguous, retain `unmeasured` instead
of borrowing Chromium memory or declaring a pass.

Validation performed: both full 20-sample browser collections above; ten real
local-image decodes; source/hash-change detection; verified owned-browser cleanup;
a separate delayed-PaintTiming diagnostic; final script syntax/CLI and independent
assertions of all 360 raw observations and nearest-rank P95 values. Original
history integrity was checked against its SHA-256. No unit tests were added for
the harness. The controller owns future runs and publication; native UI and
root/shared builds were left untouched.
