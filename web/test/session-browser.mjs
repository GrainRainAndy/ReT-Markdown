import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
const browser = await chromium.launch({ executablePath: process.env.RET_CHROMIUM || chromiumFallbackPath() });
try {
  const page = await browser.newPage(); const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
  await page.addInitScript(() => {
    window.retEditorBootstrap = { documentID: 'browser-doc', sessionID: 'browser-session' };
    window.posts = [];
    window.webkit = { messageHandlers: { ret: { postMessage: e => window.posts.push(e) } } };
    let sequence = 0;
    window.message = (type, payload, replyTo) => ({ v: 1, ...window.retEditorBootstrap, id: `native-${++sequence}`, type, payload, ...(replyTo ? { replyTo } : {}) });
  });
  await page.goto(pathToFileURL(path.resolve(process.env.RET_EDITOR_WEB || 'build/web', 'index.html')).href);
  await page.waitForFunction(() => window.retEditor && window.posts.some(e => e.type === 'ready'));
  const original = { text: 'a\nb\nc\n尾', eols: ['\r\n', '\r', '\n'], bom: true, revision: 0 };
  assert.equal((await page.evaluate(async snapshot => window.retEditor.receive(window.message('load', { snapshot, mode: 'source', selection: { anchor: snapshot.text.length, head: snapshot.text.length }, assetBase: '', assets: {}, appearance: 'light', zoom: 1 })), original)).type, 'loaded');
  await page.locator('.cm-content').focus(); await page.keyboard.type('!');
  assert.equal(await page.evaluate(() => window.retEditor.session.snapshot().text), original.text + '!');
  const styles = await page.evaluate(async () => {
    const session = window.retEditor.session, dom = session.view.contentDOM;
    await window.retEditor.receive(window.message('command', { name: 'setMode', args: { mode: 'live' } }));
    await window.retEditor.receive(window.message('command', { name: 'setAppearance', args: { appearance: 'dark' } }));
    const before = getComputedStyle(session.view.dom).fontSize;
    await window.retEditor.receive(window.message('command', { name: 'setZoom', args: { zoom: 1.25 } }));
    return { sameDOM: dom === session.view.contentDOM, focused: document.activeElement === dom, before, after: getComputedStyle(session.view.dom).fontSize };
  });
  assert.deepEqual(styles, { sameDOM: true, focused: true, before: '16px', after: '20px' });
  const undo = await page.evaluate(async () => {
    await window.retEditor.receive(window.message('command', { name: 'undo' }));
    return window.retEditor.receive(window.message('barrier', { purpose: 'save' }));
  });
  assert.deepEqual(undo.payload.snapshot, { ...original, revision: 2 });
  const paste = await page.evaluate(async () => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', 'plain\r\n**md**'); transfer.setData('text/html', '<h1>wrong</h1>');
    window.retEditor.session.view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
    await Promise.resolve(); return window.retEditor.session.snapshot();
  });
  assert.equal(paste.text, original.text + 'plain\n**md**');
  assert.deepEqual(paste.eols, [...original.eols, '\r\n']);
  const composition = await page.evaluate(async () => {
    const session = window.retEditor.session;
    session.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    session.view.dispatch({ changes: { from: session.state.doc.length, insert: '拼' }, userEvent: 'input.type.compose.start' });
    const barrier = await window.retEditor.receive(window.message('barrier', { purpose: 'close' }));
    session.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
    return { barrier: barrier.payload, final: session.snapshot() };
  });
  assert.deepEqual(composition.barrier.snapshot, paste); assert.equal(composition.barrier.composing, true);
  assert.equal(composition.final.text, paste.text + '拼');
  assert.equal(composition.final.revision, paste.revision + 1);
  const image = await page.evaluate(async () => {
    const session = window.retEditor.session, before = session.snapshot();
    const requests = window.posts.filter(e => e.type === 'assetRequest').length;
    const response = await window.retEditor.receive(window.message('command', { name: 'insertImage', args: { destinations: ['报告.assets/图 1.png', '../other(2).png'], destination: 'ignored.png', alt: '' } }));
    const inserted = session.snapshot();
    await window.retEditor.receive(window.message('command', { name: 'undo' }));
    return { before, inserted, undo: session.snapshot(), response: response.type, extraChooser: window.posts.filter(e => e.type === 'assetRequest').length - requests };
  });
  const live = await page.evaluate(async () => {
    const session = window.retEditor.session;
    const end = session.state.doc.length;
    await window.retEditor.receive(window.message('command', { name: 'revealRange', args: { from: end, to: end } }));
    session.edit([{ from: end, to: end, insert: '\n\n**wired**\n\n', eols: ['\n', '\n', '\n', '\n'] }]);
    session.dispatch({ selection: { anchor: 0 } });
    return { strong: !!session.view.dom.querySelector('.cm-live-strong'), text: session.view.contentDOM.textContent };
  });
  assert.equal(live.strong, true); assert.ok(live.text.includes('wired')); assert.ok(!live.text.includes('**wired**'));
  assert.equal(image.response, 'result'); assert.equal(image.extraChooser, 0);
  assert.equal(image.inserted.revision, image.before.revision + 1);
  assert.ok(image.inserted.text.includes('![](<报告.assets/图%201.png>)\n![](<../other(2).png>)'));
  assert.deepEqual({ ...image.undo, revision: image.before.revision }, image.before);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS local file:// editor: classic bundle, native bootstrap/ready, real typing, shared undo/EOL/BOM, plain paste, focused settings, 16px zoom, synthetic composition barrier, atomic native multi-image insertion without chooser, zero network');
} finally { await browser.close(); }
