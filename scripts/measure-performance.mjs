#!/usr/bin/env node
// Standalone browser evidence, never a substitute for native Release acceptance.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync, renameSync } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { rawCssPlugin } from './web-tooling.mjs';
import { chromium } from 'playwright';
import { copyRendererResources } from './build-web.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = { outdir: path.join(root, 'build/performance'), fixtures: path.join(root, 'build/fixtures'), bundle: path.join(root, 'build/ReT Markdown.app'), timeout: 15000, deadline: 600000 };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help') {
    console.log(`Usage: node scripts/measure-performance.mjs [--outdir DIR] [--fixtures DIR]
  [--bundle APP] [--chromium EXECUTABLE] [--timeout-ms 15000] [--deadline-ms 600000]
Always 20 samples per browser series, nearest-rank P95 (19th sorted sample).
Writes only OUTDIR; uses esbuild write:false, cached Chromium and file:// resources.
Exit 0: complete browser checks within comparison budgets; 1: regression/error;
2: incomplete measurement. Exit 0 NEVER means native acceptance passed.
Native startup/RSS/IME/PDF remain unmeasured. No app launch or OS changes.`);
    process.exit(0);
  }
  const key = { '--outdir': 'outdir', '--fixtures': 'fixtures', '--bundle': 'bundle', '--chromium': 'chromium', '--timeout-ms': 'timeout', '--deadline-ms': 'deadline' }[args[i]];
  if (!key || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${args[i]}`);
  options[key] = ['timeout', 'deadline'].includes(key) ? Number(args[++i]) : path.resolve(args[++i]);
}
if (![options.timeout, options.deadline].every(v => Number.isSafeInteger(v) && v >= 100 && v <= 3600000)) throw new Error('Timeouts must be integer milliseconds in [100, 3600000]');
for (const protectedDir of [root, path.join(root, 'build'), path.join(root, 'build/web'), path.join(root, 'Sources'), path.join(root, 'web'), options.fixtures, options.bundle]) {
  if (options.outdir === protectedDir || options.outdir.startsWith(protectedDir + path.sep) && ![root, path.join(root, 'build')].includes(protectedDir)) throw new Error(`Refusing shared/product output directory: ${options.outdir}`);
}
if (options.outdir.startsWith(root + path.sep) && !options.outdir.startsWith(path.join(root, 'build') + path.sep)) throw new Error('Repository outputs must be in a dedicated build subdirectory; use an independent directory outside the repository otherwise');
const count = 20, sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(options.outdir, { recursive: true });
const output = path.join(options.outdir, 'performance.json');
// A rerun must not destroy earlier raw evidence, even if it fails to launch.
if (existsSync(output)) {
  const prior = await readFile(output), history = path.join(options.outdir, 'history'); await mkdir(history, { recursive: true });
  await copyFile(output, path.join(history, `${sha256(prior)}.json`));
}
const unmeasured = (target, reason) => ({ status: 'unmeasured', target, reason, samplesMs: [], p95Ms: null });
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', scriptSHA256: sha256(await readFile(fileURLToPath(import.meta.url))),
  sampleCount: count, percentile: { method: 'nearest-rank', percentile: 95, rank: 19, incompleteSeries: 'P95 is null; never drop failures or substitute zero' },
  environment: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version, cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, systemMemoryBytes: os.totalmem(), browser: null, headless: true, viewport: { width: 1000, height: 900 }, deviceScaleFactor: 1, nativeReleaseBuildVerified: false, otherWorkloadControlled: false },
  methodology: {
    scope: 'Current product CodeMirror/session, transport and live extensions; optimized standalone esbuild browser bundle, not the native Release executable',
    isolation: 'One owned Chromium process; fresh browser context/page per sample, warm browser engine and OS file cache; no native app control',
    openStart: 'performance.now immediately before decodeSource of frozen fixture bytes, then real transport load/live mode/appearance/zoom',
    openEnd: 'Focused contenteditable first screen with exact document length and nonzero visible caret geometry, checked across two requestAnimationFrame callbacks after fonts are ready',
    inputStart: 'Trusted beforeinput event.timeStamp in the browser performance time origin, captured before editor handlers; one real Playwright keyboard.type character',
    inputEnd: 'Committed source and visible glyph Range geometry agree in two consecutive RAF callbacks; second RAF is a conservative paint-opportunity upper bound, not a physical display timestamp',
    fcp: 'Actual Chromium first-contentful-paint entry, awaited before any typing because presentation/entry delivery can lag RAF. Navigation FCP includes page/harness/preload; document FCP subtracts open start. Neither is native cold launch.',
    exclusions: 'Native launch, native disk read/IPC/asset authorization, WebKit, compositor presentation timestamp, real Chinese IME, PDF, and native RSS. Browser bytes preloaded before open timer. JSON-only loopback acknowledges real commits; no native persistence.',
    resources: 'All document images are frozen file:// copies of manifest-verified local files; scripts/styles/fonts also use file://. HTTP(S) and all other nonlocal schemes are blocked and recorded.',
  },
  fixtures: {}, sourceFiles: {}, harness: {}, browserSeries: {}, diagnostics: {}, errors: [],
  nativeAcceptance: {
    coldStartup: unmeasured({ p95Ms: 3000 }, 'No new native Release process launched; browser widget load is not native cold startup'),
    openBoundary: unmeasured({ p95Ms: 2000 }, 'Browser component open excludes native file IO, IPC and WKWebView'),
    ordinaryInput: unmeasured({ p95Ms: 50 }, 'Chromium RAF estimate is not a native WKWebView display measurement'),
    memory: unmeasured({ combinedRSSBytes: 512 * 1024 ** 2 }, 'No accurately attributed native application PID and dedicated WebContent PID set; browser RSS is not substituted'),
    chineseIME: unmeasured({ p95Ms: 100 }, 'No real native candidate commit measured'),
    pdfExport: unmeasured({ p95Ms: 15000 }, 'No native paginated export measured'),
    bundleSize: { status: 'unmeasured', targetBytes: 80 * 1024 ** 2, path: options.bundle, releaseBuildVerified: false },
  },
};
function checkpoint() {
  writeFileSync(output + '.tmp', JSON.stringify(report, null, 2) + '\n');
  renameSync(output + '.tmp', output);
}
function bounded(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer));
}
let server, browser, activeContext, stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  if (server) {
    try { await bounded(server.close(), 3000, 'Owned Chromium shutdown'); }
    catch { try { await bounded(server.kill(), 2000, 'Owned Chromium kill'); } catch { server.process()?.kill('SIGKILL'); } }
  }
}
const watchdog = setTimeout(() => {
  report.status = 'incomplete'; report.errors.push('Overall deadline exceeded'); report.finishedAt = new Date().toISOString(); checkpoint();
  void shutdown().finally(() => process.exit(2));
}, options.deadline);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  report.status = 'incomplete'; report.errors.push(`Interrupted by ${signal}`); report.finishedAt = new Date().toISOString(); checkpoint();
  void shutdown().finally(() => process.exit(2));
});

async function inventory(directory, prefix = '') {
  const entries = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = path.join(directory, name), relative = prefix + name, stat = await lstat(full);
    if (stat.isDirectory()) entries.push(...await inventory(full, relative + '/'));
    else if (stat.isFile()) entries.push({ path: relative, bytes: stat.size, sha256: sha256(await readFile(full)) });
    else if (stat.isSymbolicLink()) throw new Error(`Symlink in measured bundle: ${relative}; supply a fully materialized bundle`);
  }
  return entries;
}
async function findChromium() {
  if (options.chromium || process.env.RET_CHROMIUM) return options.chromium || process.env.RET_CHROMIUM;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  for (const entry of (await readdir(cache)).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const candidates = [path.join(cache, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), path.join(cache, entry, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')];
    for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  }
  throw new Error('No cached Chromium. Supply --chromium or RET_CHROMIUM; this tool never downloads a browser.');
}

// Bundled from current sources in memory. No fake clock, parser or editor.
const harnessSource = `
import { createTransport } from './web/src/main';
import { decodeSource } from './web/src/editor/source';
import { liveExtensions } from './web/src/live/decorations';
import { EditorView } from '@codemirror/view';
const api = window.__perf = { result: null, input: null, seenImages: [], commits: 0 };
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
let transport, serial = 0, original = '', before = '', anchor = 0, character = 'x';
const message = (type, payload, replyTo) => ({v:1, documentID:'perf-document', sessionID:'perf-session', id:'native-'+(++serial), type, payload, ...(replyTo ? {replyTo} : {})});
function visibleRect(rect) { return rect && rect.right >= rect.left && rect.bottom > rect.top && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth; }
function editable() {
  const view = transport?.session?.view;
  return !!view && view.contentDOM.isContentEditable && document.activeElement === view.contentDOM && visibleRect(view.coordsAtPos(0));
}
function glyphVisible() {
  const session = transport.session, view = session.view;
  if (session.state.doc.sliceString(anchor, anchor+1) !== character || session.state.doc.length !== before.length+1) return false;
  // At a line boundary domAtPos can return the line element, not its text node.
  const start = view.domAtPos(anchor), end = view.domAtPos(anchor+1);
  const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  const element = start.node.nodeType === Node.TEXT_NODE ? start.node.parentElement : start.node;
  const style = getComputedStyle(element);
  return range.toString() === character && style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0 && Array.from(range.getClientRects()).some(visibleRect);
}
document.addEventListener('beforeinput', event => {
  if (!api.armed || event.target !== transport.session.view.contentDOM) return;
  api.armed = false;
  api.input = { trusted: event.isTrusted, inputType: event.inputType, data: event.data, eventTimeStamp: event.timeStamp, capturedAtMs: performance.now(), startRevision: transport.session.snapshot().revision };
  const check = async () => {
    if (!glyphVisible()) { requestAnimationFrame(check); return; }
    const firstVisibleRafMs = performance.now(); await frame();
    if (!glyphVisible()) { requestAnimationFrame(check); return; }
    const end = performance.now(), snapshot = transport.session.snapshot();
    api.result = { ...api.input, firstVisibleRafMs, visibleRafMs: end, durationMs: end-api.input.eventTimeStamp, revision: snapshot.revision, exactText: snapshot.text === before.slice(0,anchor)+character+before.slice(anchor), focused: document.activeElement === transport.session.view.contentDOM };
  };
  requestAnimationFrame(check);
}, true);
api.open = async mode => {
  window.retEditor?.destroy();
  const parent = document.querySelector('#editor'); parent.replaceChildren();
  transport = createTransport(parent, {documentID:'perf-document', sessionID:'perf-session'}, envelope => {
    const wire = JSON.parse(JSON.stringify(envelope));
    if (wire.type === 'commit') { api.commits++; queueMicrotask(() => transport.receive(message('ack', {revision:wire.payload.revision}, wire.id))); }
  }, destination => window.__perfFrozen.resources[destination] ?? null);
  transport.installLiveExtensions(liveExtensions);
  const start = performance.now();
  const source = decodeSource(window.__perfBytes); original = source.text;
  const response = await transport.receive(message('load', { snapshot:{...source, revision:0}, mode, selection:{anchor:0,head:0}, assetBase:'', assets:{}, appearance:'light', zoom:1 }));
  if (response.type !== 'loaded') throw new Error(JSON.stringify(response));
  transport.session.view.focus();
  await document.fonts.ready;
  await frame(); if (!editable()) throw new Error('First screen not editable');
  await frame(); if (!editable()) throw new Error('First screen lost editability');
  const end = performance.now();
  const exactText = transport.session.snapshot().text === original;
  if (!exactText) throw new Error('Open truncated or changed fixture');
  return { durationMs:end-start, startMs:start, visibleRafMs:end, utf16Length:original.length, exactText, mode:transport.session.status().mode, localImagesOnFirstScreen:document.querySelectorAll('.cm-live-image img').length, fcpMs:performance.getEntriesByType('paint').find(e=>e.name==='first-contentful-paint')?.startTime ?? null };
};
api.arm = async () => {
  before = transport.session.snapshot().text;
  anchor = before.indexOf('\\n'); if (anchor < 0) anchor = before.length;
  await transport.session.command('revealRange', {from:anchor,to:anchor});
  transport.session.view.focus(); await frame(); await frame();
  api.result = null; api.input = null; api.armed = true;
};
api.auditAssets = async positions => {
  for (const pos of positions) {
    transport.session.view.dispatch({effects:EditorView.scrollIntoView(pos,{y:'center'})});
    await frame(); await frame();
    for (const img of document.querySelectorAll('.cm-live-image img')) {
      await img.decode();
      if (!(img.naturalWidth > 0 && img.naturalWidth <= 2048 && img.naturalHeight > 0 && img.naturalHeight <= 1536)) throw new Error('Invalid decoded local image dimensions');
      if (!api.seenImages.some(item=>item.src===img.src)) api.seenImages.push({src:img.src,width:img.naturalWidth,height:img.naturalHeight});
    }
  }
  return { images:api.seenImages, math:!!document.querySelector('.katex'), code:!!document.querySelector('.cm-live-code') };
};
`;

try {
  checkpoint();
  try {
    const files = await inventory(options.bundle), bytes = files.reduce((sum, f) => sum + f.bytes, 0);
    report.nativeAcceptance.bundleSize = { ...report.nativeAcceptance.bundleSize, status: 'measured-artifact', bytes, mib: bytes / 1024 ** 2, withinSizeBudget: bytes <= 80 * 1024 ** 2, releaseAcceptance: 'unmeasured', measurement: 'Sum of actual regular-file logical sizes; not allocated disk blocks or a rebuilt/published bundle', treeSHA256: sha256(JSON.stringify(files)), files };
  } catch (error) { report.nativeAcceptance.bundleSize.reason = error.message; }
  const manifest = JSON.parse(await readFile(path.join(options.fixtures, 'manifest.json'), 'utf8'));
  const frozen = {};
  for (const name of ['regular-256k.md', 'boundary-1m.md', ...Object.keys(manifest).filter(n => n.startsWith('assets/'))]) {
    const bytes = await readFile(path.join(options.fixtures, name));
    if (manifest[name]?.bytes !== bytes.length || manifest[name]?.sha256 !== sha256(bytes)) throw new Error(`Fixture manifest mismatch: ${name}`);
    report.fixtures[name] = { bytes: bytes.length, sha256: sha256(bytes) }; frozen[name] = bytes;
  }
  const regularText = frozen['regular-256k.md'].toString('utf8');
  const imageMatches = [...regularText.matchAll(/!\[[^\]]*\]\(<([^>]+)>\)/g)];
  const structure = { codeBlocks: (regularText.match(/^```typescript$/gm) || []).length, formulas: (regularText.match(/^\$\$$/gm) || []).length / 2, images: imageMatches.length };
  if (structure.codeBlocks !== 20 || structure.formulas !== 20 || structure.images !== 10) throw new Error(`Regular fixture structure mismatch: ${JSON.stringify(structure)}`);
  if (Math.abs(frozen['regular-256k.md'].length - 256 * 1024) > 4096 || Math.abs(frozen['boundary-1m.md'].length - 1024 ** 2) > 4096) throw new Error('Unexpected acceptance fixture sizes');
  report.fixtures['regular-256k.md'].structure = structure;
  const harnessDir = await mkdtemp(path.join(options.outdir, 'harness-'));
  const assetDir = path.join(harnessDir, 'fixture-assets'); await mkdir(assetDir);
  const resources = Object.fromEntries(await Promise.all(imageMatches.map(async match => {
    const name = match[1], bytes = frozen[name];
    if (!bytes || !name.endsWith('.svg') || /<(?:script|foreignObject)\b|(?:href|src)\s*=|url\s*\(/i.test(bytes.toString('utf8'))) throw new Error(`Expected static local SVG fixture: ${name}`);
    const local = path.join(assetDir, path.basename(name)); await writeFile(local, bytes);
    return [name, pathToFileURL(local).href];
  })));
  await copyRendererResources(harnessDir);
  const rawCSS = rawCssPlugin({ onRead(absolutePath, bytes) {
    report.sourceFiles[path.relative(root, absolutePath)] = { bytes: bytes.length, sha256: sha256(bytes) };
  } });
  const captureInputs = { name: 'performance-source-hashes', setup(bundle) {
    bundle.onLoad({ filter: /\.(?:ts|js)$/ }, async arg => {
      if (!arg.path.startsWith(path.join(root, 'web') + path.sep)) return;
      const bytes = await readFile(arg.path); report.sourceFiles[path.relative(root, arg.path)] = { bytes: bytes.length, sha256: sha256(bytes) };
      return { contents: bytes.toString('utf8'), loader: arg.path.endsWith('.ts') ? 'ts' : 'js' };
    });
  } };
  const compiled = await build({ stdin: { contents: harnessSource, resolveDir: root, sourcefile: 'performance-harness.ts', loader: 'ts' }, absWorkingDir: root, outfile: path.join(harnessDir, 'app.js'), bundle: true, write: false, metafile: true, format: 'iife', platform: 'browser', target: ['safari17', 'chrome120'], minify: true, keepNames: true, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [rawCSS, captureInputs], logLevel: 'warning' });
  for (const file of compiled.outputFiles) await writeFile(file.path, file.contents);
  await writeFile(path.join(harnessDir, 'app.css'), '/* Standalone acceptance harness. */\n');
  for (const name of Object.keys(compiled.metafile.inputs).filter(n => /^(web\/|node_modules\/.*package\.json$)/.test(n))) {
    if (!report.sourceFiles[name]) { const bytes = await readFile(path.join(root, name)); report.sourceFiles[name] = { bytes: bytes.length, sha256: sha256(bytes) }; }
  }
  const packageBytes = await readFile(path.join(root, 'package-lock.json')); report.sourceFiles['package-lock.json'] = { bytes: packageBytes.length, sha256: sha256(packageBytes) };
  report.harness = { directory: harnessDir, bundleSHA256: sha256(compiled.outputFiles[0].contents), esbuildWrite: false, minified: true, keepNames: true, fixturePreload: true };
  const executablePath = await findChromium(); await access(executablePath);
  server = await chromium.launchServer({ executablePath, headless: true, timeout: options.timeout, args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] });
  browser = await chromium.connect(server.wsEndpoint(), { timeout: options.timeout });
  report.environment.browser = { executablePath, version: browser.version(), ownedPID: server.process().pid };
  const scenarios = [{ id: 'blank-live', fixture: null, mode: 'live' }, ...['regular-256k.md', 'boundary-1m.md'].flatMap(fixture => ['source', 'live'].map(mode => ({ id: `${fixture.replace('.md', '')}-${mode}`, fixture, mode })))];
  for (const scenario of scenarios) {
    for (const metric of ['openFirstEditable', 'inputVisible', ...(scenario.fixture ? ['navigationFCP', 'openFirstContentfulPaint'] : [])]) {
      const budget = metric === 'inputVisible' && scenario.fixture === 'regular-256k.md' ? 50 : metric === 'openFirstEditable' && scenario.fixture === 'boundary-1m.md' ? 2000 : null;
      report.browserSeries[`${scenario.id}.${metric}`] = { fixture: scenario.fixture, mode: scenario.mode, metric, status: 'pending', comparisonBudgetMs: budget, nativeAcceptance: false, budgetBasis: budget ? 'Component comparison only; native spec target not certified' : 'Diagnostic; no acceptance target (in particular, no spec input threshold for 1 MiB)', samplesMs: Array(count).fill(null), evidence: Array(count).fill(null), p95Ms: null, errors: [] };
    }
  }
  const record = (id, metric, iteration, value, evidence) => {
    const series = report.browserSeries[`${id}.${metric}`]; series.samplesMs[iteration] = value; series.evidence[iteration] = evidence;
  };
  async function sample(scenario, iteration, bytes) {
    const context = await browser.newContext({ viewport: report.environment.viewport, deviceScaleFactor: 1, colorScheme: 'light', serviceWorkers: 'block', offline: true }); activeContext = context;
    const page = await context.newPage(), issues = [], requests = [];
    page.setDefaultTimeout(options.timeout); page.setDefaultNavigationTimeout(options.timeout);
    page.on('pageerror', e => issues.push(`pageerror: ${e.message}`));
    page.on('request', request => { const url = request.url(); if (!/^(file:|data:|about:)/.test(url)) issues.push(`nonlocal request: ${url}`); requests.push(url); });
    page.on('requestfailed', request => issues.push(`resource failed: ${request.url()} ${request.failure()?.errorText}`));
    await context.route('**/*', route => /^(file:|data:|about:)/.test(route.request().url()) ? route.continue() : route.abort());
    await page.addInitScript(({ base64, resources }) => {
      window.webkit = { messageHandlers: { ret: { postMessage() {} } } };
      window.__perfFrozen = { resources };
      window.__perfBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    }, { base64: bytes.toString('base64'), resources });
    try {
      await page.goto(pathToFileURL(path.join(harnessDir, 'index.html')).href);
      const opened = await page.evaluate(mode => window.__perf.open(mode), scenario.mode);
      record(scenario.id, 'openFirstEditable', iteration, opened.durationMs, opened);
      if (scenario.fixture) {
        // PaintTiming is asynchronous; querying at the second RAF often sees no
        // FCP yet. Wait for the actual entry before generating any input.
        await page.waitForFunction(() => performance.getEntriesByType('paint').some(e => e.name === 'first-contentful-paint'));
        const paint = await page.evaluate(() => performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint').toJSON());
        if (paint.startTime < opened.startMs) throw new Error('FCP preceded document load; cannot attribute it to the fixture');
        record(scenario.id, 'navigationFCP', iteration, paint.startTime, paint);
        record(scenario.id, 'openFirstContentfulPaint', iteration, paint.startTime - opened.startMs, { ...paint, openStartMs: opened.startMs, note: 'Browser-reported presentation time where supported; engine paintTime retained separately' });
      }
      await page.evaluate(() => window.__perf.arm());
      await page.keyboard.type('x');
      await page.waitForFunction(() => window.__perf.result !== null, null, { polling: 'raf' });
      const input = await page.evaluate(() => window.__perf.result);
      if (!input.trusted || input.inputType !== 'insertText' || input.data !== 'x' || !input.exactText || !input.focused || input.revision !== input.startRevision + 1 || input.durationMs < 0) throw new Error(`Invalid real-input evidence: ${JSON.stringify(input)}`);
      record(scenario.id, 'inputVisible', iteration, input.durationMs, input);
      if (scenario.id === 'regular-256k-live' && iteration === 0) {
        const audit = await page.evaluate(positions => window.__perf.auditAssets(positions), imageMatches.map(m => m.index + 1));
        const decoded = new Set(audit.images.map(item => item.src));
        if (decoded.size !== 10 || Object.values(resources).some(src => !decoded.has(src))) throw new Error(`Local image audit decoded ${decoded.size}/10 real fixture resources`);
        report.diagnostics.localAssets = { status: 'verified', images: audit.images.map(({ src, ...image }) => { const destination = Object.keys(resources).find(name => resources[name] === src); return { ...image, destination, sha256: report.fixtures[destination].sha256 }; }), note: 'Scrolled all ten real live image widgets and awaited decode; audit excluded from timing samples' };
      }
      if (iteration === 0 && scenario.mode === 'live' && scenario.fixture) await page.screenshot({ path: path.join(options.outdir, `${scenario.id}.png`) });
      if (issues.length) throw new Error(issues.join('\n'));
      report.diagnostics.localRequestCount = (report.diagnostics.localRequestCount || 0) + requests.length;
    } finally { await bounded(context.close(), 3000, 'Sample context close'); if (activeContext === context) activeContext = null; }
  }
  // Round-robin scenarios reduce order bias. Failures remain in the same 20 slots.
  for (let iteration = 0; iteration < count; iteration++) {
    for (const scenario of scenarios) {
      try { await bounded(sample(scenario, iteration, scenario.fixture ? frozen[scenario.fixture] : Buffer.alloc(0)), options.timeout, `${scenario.id} sample ${iteration + 1}`); }
      catch (error) {
        // A timed-out evaluate cannot be interrupted by a page timer if JS is busy.
        // Close this renderer before starting another sample; never overlap runs.
        if (activeContext) { await bounded(activeContext.close(), 3000, 'Timed-out context close'); activeContext = null; }
        for (const metric of ['openFirstEditable', 'inputVisible', ...(scenario.fixture ? ['navigationFCP', 'openFirstContentfulPaint'] : [])]) report.browserSeries[`${scenario.id}.${metric}`].errors.push({ sample: iteration + 1, message: error.message });
        report.errors.push({ scenario: scenario.id, sample: iteration + 1, message: error.message });
      }
      checkpoint();
    }
    console.log(`Completed round ${iteration + 1}/${count}; errors=${report.errors.length}`);
  }
  for (const series of Object.values(report.browserSeries)) {
    const valid = series.samplesMs.filter(v => Number.isFinite(v) && v >= 0);
    series.completedSamples = valid.length;
    if (valid.length === count && !series.errors.length) {
      const sorted = [...valid].sort((a, b) => a - b); series.p95Ms = sorted[18]; series.minMs = sorted[0]; series.maxMs = sorted.at(-1);
      series.status = series.comparisonBudgetMs === null ? 'measured' : series.p95Ms <= series.comparisonBudgetMs ? 'within-comparison-budget' : 'regression';
    } else series.status = 'incomplete';
  }
  report.diagnostics.overOneMiB = { bytes: frozen['boundary-1m.md'].length, exceedsOneMiB: frozen['boundary-1m.md'].length > 1024 ** 2, note: 'The unmodified boundary fixture is already over 1 MiB; exact source and trusted editing checked in both modes in every sample' };
  report.diagnostics.fullDocumentSyntax = { evidence: ['web/src/live/decorations.ts: project(state) passes state.doc.toString() to syntaxSpans, and StateField.update calls project on every noncomposition transaction', 'web/src/live/syntax.ts: syntaxSpans invokes grammar.parse(text) and mathGrammar.parse(text)'], note: 'Source inspection explains a possible scaling cost. Timings include it; no claim of profiled causal attribution. Source hashes identify the measured implementation.' };
  // The bundle is frozen, but source edits make it stale for current acceptance.
  const changed = [];
  for (const [name, stamp] of Object.entries(report.sourceFiles)) if (sha256(await readFile(path.join(root, name))) !== stamp.sha256) changed.push(name);
  report.diagnostics.sourcesChangedDuringRun = changed;
  if (changed.length) report.errors.push(`Measured source inputs changed during run: ${changed.join(', ')}`);
  report.status = Object.values(report.browserSeries).some(s => s.status === 'incomplete') || report.errors.length ? 'incomplete' : Object.values(report.browserSeries).some(s => s.status === 'regression') || report.nativeAcceptance.bundleSize.withinSizeBudget === false ? 'regression' : 'browser-measured-native-unmeasured';
} catch (error) {
  report.status = 'incomplete'; report.errors.push(error.stack || error.message);
} finally {
  clearTimeout(watchdog); report.finishedAt = new Date().toISOString(); checkpoint(); await shutdown();
}
for (const [name, series] of Object.entries(report.browserSeries)) console.log(`${name}: ${series.status}; n=${series.completedSamples ?? 0}/20; P95=${series.p95Ms ?? 'unmeasured'} ms`);
console.log(`Raw samples and evidence: ${output}\nNative cold startup and attributed RSS: unmeasured`);
process.exitCode = report.status === 'regression' ? 1 : report.status === 'incomplete' ? 2 : 0;
