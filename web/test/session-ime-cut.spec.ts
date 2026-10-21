import { test, expect, type Page } from 'playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';

// Real mounted Chromium + synthetic composition/clipboard events. NOT native OS IME/clipboard.
let bundle: string, styles: string;
const errors = new WeakMap<Page, string[]>();
test.use({ launchOptions: { executablePath: process.env.RET_CHROMIUM || chromiumFallbackPath() } });
test.beforeAll(async () => {
  const output = await build({ entryPoints: ['web/test/final-live-browser-harness.ts'], bundle: true, write: false, format: 'iife', plugins: [rawCssPlugin()] });
  bundle = output.outputFiles[0].text;
  styles = (await Promise.all(['typography', 'palette'].map(n => readFile(`web/styles/${n}.css`, 'utf8')))).join('\n');
});
test.beforeEach(async ({ page }) => {
  const list: string[] = []; errors.set(page, list); page.on('pageerror', e => list.push(e.message));
  await page.setContent('<main></main>'); await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
const boot = (page: Page, raw: string, mode = 'live') => page.evaluate(({ raw, mode }) => (window as any).bootNative(raw, {}, mode), { raw, mode });
const select = (page: Page, anchor: number, head = anchor) => page.evaluate(({ anchor, head }) => (window as any).nativeSelect(anchor, head), { anchor, head });
const command = (page: Page, name: string, args?: unknown) => page.evaluate(({ name, args }) => (window as any).nativeCommand(name, args), { name, args });
const state = (page: Page) => page.evaluate(() => {
  const api = window as any, s = api.nativeTransport.session;
  return { snapshot: s.snapshot(), selection: s.selection(), barrier: s.barrier(), bytes: api.nativeBytes(),
    commits: api.nativeMessages.filter((m: any) => m.type === 'commit').map((m: any) => m.payload) };
});

for (const reverse of [false, true]) test(`IA05 synth compositionstart freezes cross-paragraph deletion before CM observer (reverse=${reverse})`, async ({ page }, info) => {
  const raw = '\uFEFFAlpha\r\n\rBeta\n\ntail';
  await boot(page, raw); await select(page, reverse ? 11 : 0, reverse ? 0 : 11);
  const before = await state(page);
  const started = await page.evaluate(() => {
    const s = (window as any).nativeTransport.session;
    s.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    return { provisional: s.state.doc.toString(), barrier: s.barrier(), commits: s.pendingCommits() };
  });

  await info.attach('synth-not-native-start-boundary', { body: JSON.stringify({ before, started }, null, 2), contentType: 'application/json' });
  expect(started.provisional).toBe('\n\ntail'); // Exercise CM's real cross-line deletion path.
  expect(started.barrier).toEqual({ snapshot: before.snapshot, selection: before.selection, composing: true });
  expect(started.commits).toEqual([]);
  await page.evaluate(() => {
    const s = (window as any).nativeTransport.session;
    s.view.dispatch({ changes: { from: 0, insert: '中' }, selection: { anchor: 1 }, userEvent: 'input.type.compose.start' });
    s.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
  });
  await expect.poll(async () => (await state(page)).barrier.composing).toBe(false);
  const after = await state(page);
  expect(after.snapshot).toEqual({ text: '中\n\ntail', eols: ['\n', '\n'], bom: true, revision: 1 });
  expect(after.commits).toHaveLength(1);
  expect(after.commits[0].patches).toEqual([{ from: 0, to: 11, insert: '中', eols: [] }]);
  await command(page, 'undo'); expect((await state(page)).bytes).toEqual(before.bytes);
  expect((await state(page)).selection).toEqual(before.selection);
  await command(page, 'redo'); expect((await state(page)).snapshot.text).toBe('中\n\ntail');
});

test('IA05 synth cancelled preedit with no net source change emits zero commits', async ({ page }) => {
  await boot(page, '\uFEFFalpha\r\nbeta'); await select(page, 3);
  const before = await state(page);
  await page.evaluate(() => {
    const s = (window as any).nativeTransport.session, dom = s.view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    s.view.dispatch({ changes: { from: 3, insert: '拼' }, userEvent: 'input.type.compose.start' });
    s.view.dispatch({ changes: { from: 3, to: 4 }, selection: { anchor: 3 }, userEvent: 'input.type.compose' });
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '' }));
  });
  await expect.poll(async () => (await state(page)).barrier.composing).toBe(false);
  const after = await state(page);
  expect(after.snapshot).toEqual(before.snapshot); expect(after.bytes).toEqual(before.bytes);
  expect(after.commits).toEqual([]); expect(after.selection).toEqual(before.selection);
});

const cutCases = [
  { name: 'bold', text: '**bold**', from: 2, to: 6, full: '**bold**' },
  { name: 'italic', text: '*word*', from: 1, to: 5, full: '*word*' },
  { name: 'link', text: '[label](https://example.com)', from: 1, to: 6, full: '[label](https://example.com)' },
  { name: 'code', text: '`code`', from: 1, to: 5, full: '`code`' },
  { name: 'nested', text: '**a *b* c**', from: 2, to: 9, full: '**a *b* c**' },
  { name: 'partial', text: '**bold**', from: 3, to: 5, full: 'ol' },
  { name: 'multiline', text: '**a\nb**', from: 2, to: 5, full: '**a\r\nb**' },
];
for (const mode of ['live', 'source']) for (const reverse of [false, true]) for (const c of cutCases)
  test(`IA06 synth cut/paste exact range, bytes and root history: ${mode}/${c.name}/reverse=${reverse}`, async ({ page }) => {
    const prefix = 'lead\n\n';
    await boot(page, '\uFEFFlead\r\n\r\n' + c.text.replaceAll('\n', '\r\n') + '\r\ntail', mode);
    const start = prefix.length + c.from, end = prefix.length + c.to;
    await select(page, reverse ? end : start, reverse ? start : end);
    const before = await state(page);
    const expectedCopy = mode === 'live' ? c.full : c.text.slice(c.from, c.to).replaceAll('\n', '\r\n');
    const expanded = mode === 'live' && c.name !== 'partial';
    const cutFrom = expanded ? prefix.length : start, cutTo = expanded ? prefix.length + c.text.length : end;
    const copied = await page.evaluate(() => {
      const s = (window as any).nativeTransport.session, transfer = new DataTransfer();
      s.view.contentDOM.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: transfer }));
      return transfer.getData('text/plain');
    });
    expect(copied).toBe(expectedCopy);
    const cut = await state(page);
    expect(cut.snapshot.text).toBe(before.snapshot.text.slice(0, cutFrom) + before.snapshot.text.slice(cutTo));
    expect(cut.selection).toEqual({ anchor: cutFrom, head: cutFrom });
    expect(cut.commits).toHaveLength(1);
    expect(cut.commits[0].patches).toEqual([{ from: cutFrom, to: cutTo, insert: '', eols: [] }]);
    await page.evaluate(text => {
      const s = (window as any).nativeTransport.session, transfer = new DataTransfer(); transfer.setData('text/plain', text);
      s.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, copied);
    const pasted = await state(page);
    expect(pasted.bytes).toEqual(before.bytes); expect(pasted.commits).toHaveLength(2);
    expect(pasted.selection).toEqual({ anchor: cutTo, head: cutTo });
    await command(page, 'undo'); expect((await state(page)).bytes).toEqual(cut.bytes);
    await command(page, 'undo'); expect((await state(page)).bytes).toEqual(before.bytes);
    expect((await state(page)).selection).toEqual(before.selection);
    await command(page, 'redo'); expect((await state(page)).bytes).toEqual(cut.bytes);
    await command(page, 'redo'); expect((await state(page)).bytes).toEqual(before.bytes);
  });

for (const c of [
  { name: 'live ordinary paragraph join', mode: 'live', raw: '\uFEFFAlpha\r\n\rBeta', at: 7, want: 'AlphaBeta', caret: 5 },
  { name: 'source character deletion', mode: 'source', raw: '\uFEFFAlpha\r\n\rBeta', at: 7, want: 'Alpha\nBeta', caret: 6 },
  { name: 'extra blank line', mode: 'live', raw: 'Alpha\n\n\nBeta', at: 8, want: 'Alpha\n\nBeta', caret: 7 },
  { name: 'math literal marker', mode: 'live', raw: '$$\n- value\n$$', at: 5, want: '$$\n-value\n$$', caret: 4 },
  { name: 'fenced code literal marker', mode: 'live', raw: '```\n- value\n```', at: 6, want: '```\n-value\n```', caret: 5 },
  { name: 'ordinary list fallback', mode: 'live', raw: '- value', at: 2, want: 'value', caret: 0 },
]) test(`session Backspace owner: ${c.name}`, async ({ page }) => {
  await boot(page, c.raw, c.mode); await select(page, c.at);
  const before = await state(page);
  await page.keyboard.press('Backspace');
  const after = await state(page);
  expect(after.snapshot.text).toBe(c.want); expect(after.selection).toEqual({ anchor: c.caret, head: c.caret });
  expect(after.commits).toHaveLength(1);
  await command(page, 'undo'); expect((await state(page)).bytes).toEqual(before.bytes);
  expect((await state(page)).selection).toEqual(before.selection);
});

for (const guard of ['composing', 'locked']) test(`session Backspace and cut respect ${guard} ownership`, async ({ page }) => {
  await boot(page, 'Alpha\n\nBeta'); await select(page, 7);
  if (guard === 'locked') await command(page, 'setReadOnly', { value: true });
  else await page.evaluate(() => (window as any).nativeTransport.session.beginComposition());
  const before = await state(page);
  await page.keyboard.press('Backspace');
  expect((await state(page)).snapshot).toEqual(before.snapshot);
  expect((await state(page)).selection).toEqual(before.selection);
  const provisional = await page.evaluate(() => (window as any).nativeTransport.session.state.doc.toString());
  expect(provisional).toBe(before.snapshot.text);
  await select(page, 0, 5);
  const blockedCut = await page.evaluate(() => {
    const api = window as any, dom = api.nativeTransport.session.view.contentDOM;
    const transfer = new DataTransfer(); transfer.setData('text/plain', 'existing clipboard');
    const event = new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: transfer });
    const dispatched = dom.dispatchEvent(event);
    return { dispatched, prevented: event.defaultPrevented, clipboard: transfer.getData('text/plain'),
      nativeWrites: api.nativeMessages.filter((m: any) => m.type === 'clipboardWrite').length };
  });
  expect(blockedCut).toEqual({ dispatched: false, prevented: true, clipboard: 'existing clipboard', nativeWrites: 0 });
  expect((await state(page)).snapshot).toEqual(before.snapshot);
});

test('IA05 synth compositionend drains pending DOM input before publishing or a queued mode switch', async ({ page }) => {
  await boot(page, '\uFEFFab\r\ntail'); await select(page, 1);
  const before = await state(page);
  const barrier = await page.evaluate(() => {
    const s = (window as any).nativeTransport.session, dom = s.view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const pos = s.view.domAtPos(1);
    if (pos.node.nodeType !== Node.TEXT_NODE) throw new Error('Expected mounted text node');
    pos.node.nodeValue = 'a中b';
    document.getSelection()!.collapse(pos.node, 2);
    dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '中', isComposing: true }));
    s.setMode('source'); // Must remain deferred through the final DOM flush.
    const barrier = s.barrier();
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    return barrier;
  });
  expect(barrier).toEqual({ snapshot: before.snapshot, selection: before.selection, composing: true });
  await expect.poll(async () => (await state(page)).barrier.composing).toBe(false);
  const after = await state(page);
  expect(after.snapshot).toEqual({ text: 'a中b\ntail', eols: ['\r\n'], bom: true, revision: 1 });
  expect(after.commits).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).nativeTransport.session.getMode())).toBe('source');
  await command(page, 'undo'); expect((await state(page)).bytes).toEqual(before.bytes);
});

for (const cancelled of [false, true]) for (const queuedMode of [false, true])
test(`IA05 final DOM after compositionend drains before completion (cancelled=${cancelled}, queuedMode=${queuedMode})`, async ({ page }) => {
  await boot(page, '\uFEFFab\r\ntail', 'source'); await select(page, 1);
  const before = await state(page);
  await page.evaluate(({ cancelled, queuedMode }) => {
    const s = (window as any).nativeTransport.session, dom = s.view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    s.view.dispatch({ changes: { from: 1, insert: '拼' }, selection: { anchor: 2 }, userEvent: 'input.type.compose.start' });
    if (queuedMode) s.setMode('live');
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: cancelled ? '' : '中' }));
    // Browser default input can mutate the DOM after compositionend handlers,
    // before the event task's mutation-observer checkpoint.
    const pos = s.view.domAtPos(1);
    if (pos.node.nodeType !== Node.TEXT_NODE) throw new Error('Expected mounted text node');
    pos.node.nodeValue = cancelled ? 'ab' : 'a中b';
    document.getSelection()!.collapse(pos.node, cancelled ? 1 : 2);
    dom.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: cancelled ? '' : '中' }));
  }, { cancelled, queuedMode });
  await expect.poll(async () => (await state(page)).barrier.composing).toBe(false);
  const after = await state(page);
  expect(after.snapshot).toEqual({ ...before.snapshot, text: cancelled ? 'ab\ntail' : 'a中b\ntail', revision: cancelled ? 0 : 1 });
  expect(after.commits).toHaveLength(cancelled ? 0 : 1);
  expect(await page.evaluate(() => (window as any).nativeTransport.session.getMode())).toBe(queuedMode ? 'live' : 'source');
  if (!cancelled) {
    await command(page, 'undo'); expect((await state(page)).bytes).toEqual(before.bytes);
    expect((await state(page)).selection).toEqual(before.selection);
    await command(page, 'redo'); expect((await state(page)).snapshot.text).toBe('a中b\ntail');
  } else expect(after.bytes).toEqual(before.bytes);
});

for (const name of ['undo', 'format', 'find'])
test(`IA05 queued ${name} waits through a new mounted composition`, async ({ page }) => {
  await boot(page, '\uFEFFab\r\ntail', 'source'); await select(page, 1);
  const during = await page.evaluate(async name => {
    const api = window as any, s = api.nativeTransport.session, dom = s.view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    s.view.dispatch({ changes: { from: 1, insert: '中' }, selection: { anchor: 2 }, userEvent: 'input.type.compose.start' });
    api.queuedOutcome = 'pending';
    api.queuedCommand = s.command(name, name === 'format' ? { kind: 'bold' } : name === 'find' ? { query: 'tail' } : undefined)
      .then(() => { api.queuedOutcome = 'resolved'; }, (error: unknown) => { api.queuedOutcome = String(error); });
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    await Promise.resolve(); await Promise.resolve();
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    s.view.dispatch({ changes: { from: 2, insert: '文' }, selection: { anchor: 3 }, userEvent: 'input.type.compose.start' });
    await Promise.resolve(); await Promise.resolve();
    return { outcome: api.queuedOutcome, provisional: s.state.doc.toString(), selection: s.selection(), barrier: s.barrier() };
  }, name);
  expect(during.outcome).toBe('pending'); expect(during.provisional).toBe('a中文b\ntail');
  expect(during.selection).toEqual({ anchor: 3, head: 3 });
  expect(during.barrier).toMatchObject({ composing: true, snapshot: { text: 'a中b\ntail', revision: 1 } });
  await page.evaluate(() => {
    const dom = (window as any).nativeTransport.session.view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文' }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).queuedOutcome)).toBe('resolved');
  const after = await state(page);
  expect(after.barrier.composing).toBe(false);
  if (name === 'undo') {
    expect(after.commits).toHaveLength(3); expect(after.commits[2].reason).toBe('undo');
    expect(after.snapshot.text).not.toBe('a中文b\ntail');
  } else if (name === 'format') {
    expect(after.snapshot.text).toBe('a中文****b\ntail'); expect(after.commits).toHaveLength(3);
  } else {
    expect(after.snapshot.text).toBe('a中文b\ntail'); expect(after.commits).toHaveLength(2);
    expect(after.selection).toEqual({ anchor: 5, head: 9 });
  }
});

test('IA05 synth consecutive compositions do not inherit an earlier end callback', async ({ page }) => {
  await boot(page, 'ab'); await select(page, 1);
  const between = await page.evaluate(async () => {
    const s = (window as any).nativeTransport.session, dom = s.view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    s.view.dispatch({ changes: { from: 1, insert: '中' }, selection: { anchor: 2 }, userEvent: 'input.type.compose.start' });
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    // Let CM's final flush microtask run; no elapsed timeout is an input boundary.
    await Promise.resolve(); await Promise.resolve();
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    s.view.dispatch({ changes: { from: 2, insert: '文' }, selection: { anchor: 3 }, userEvent: 'input.type.compose.start' });
    return s.barrier();
  });
  expect(between).toEqual({ snapshot: { text: 'a中b', eols: [], bom: false, revision: 1 }, selection: { anchor: 2, head: 2 }, composing: true });
  await expect.poll(async () => (await state(page)).barrier).toEqual(between);
  await page.evaluate(() => (window as any).nativeTransport.session.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文' })));
  await expect.poll(async () => (await state(page)).barrier.composing).toBe(false);
  expect((await state(page)).commits).toHaveLength(2);
  expect((await state(page)).snapshot.text).toBe('a中文b');
});
