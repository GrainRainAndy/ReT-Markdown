import { test, expect, type Page } from 'playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';

let bundle: string, styles: string;
const errors = new WeakMap<Page, string[]>();
test.use({ launchOptions: { executablePath: process.env.RET_CHROMIUM || chromiumFallbackPath() } });
test.beforeAll(async () => {
  const output = await build({ entryPoints: ['web/test/final-live-browser-harness.ts'], bundle: true,
    write: false, format: 'iife', plugins: [rawCssPlugin()] });
  bundle = output.outputFiles[0].text;
  styles = (await Promise.all(['typography', 'palette', 'print'].map(name => readFile(`web/styles/${name}.css`, 'utf8')))).join('\n');
});
test.beforeEach(async ({ page }) => {
  const failures: string[] = []; errors.set(page, failures);
  page.on('pageerror', error => failures.push(error.message));
  await page.setViewportSize({ width: 940, height: 740 });
  await page.setContent('<main id="editor"></main>');
  await page.addStyleTag({ content: styles });
  await page.evaluate(() => { (window as any).webkit = { messageHandlers: { ret: { postMessage: () => {} } } }; });
  await page.addScriptTag({ content: bundle });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
const text = (page: Page) => page.evaluate(() => (window as any).nativeTransport.session.snapshot().text);
const bytes = (page: Page) => page.evaluate(() => (window as any).nativeBytes());
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const checkpoint = (page: Page) => page.evaluate(() => {
  const api = window as any, s = api.nativeTransport.session;
  return { selection: s.selection(), revision: s.snapshot().revision,
    commits: api.nativeMessages.filter((message: any) => message.type === 'commit').length };
});
async function assertModeRoundTrip(page: Page) {
  const before = await checkpoint(page), original = await bytes(page);
  for (const mode of ['source', 'live']) {
    await page.evaluate(mode => (window as any).nativeCommand('setMode', { mode }), mode);
    await settle(page);
    expect(await checkpoint(page)).toEqual(before);
    expect(await bytes(page)).toEqual(original);
  }
}
const rendered = (page: Page) => page.evaluate(() => {
  const dom = document.createElement('div'); dom.innerHTML = (window as any).nativeRender().html;
  return {
    nestedOrdered: dom.querySelector('ol > li > ol')?.getAttribute('start'),
    nestedItems: dom.querySelector('ol > li > ol')?.textContent,
    code: [...dom.querySelectorAll('pre code')].map(el => el.textContent),
    headings: [...dom.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(el => [el.tagName, el.textContent]),
  };
});

test('a nonrepresentable structural Tab preserves source, selection, history and root focus', async ({ page }) => {
  const source = '> - previous\n> - parent\n>   >>\t ```` unknown\n>   >>  \ta\tZ\n>   >>     \n>   >>last\tZ\n>   >> ````';
  await page.evaluate(raw => (window as any).bootNative(raw), '\uFEFF' + source.replaceAll('\n', '\r\n'));
  await page.evaluate(at => (window as any).nativeSelect(at), source.indexOf('parent'));
  const original = await bytes(page), before = await checkpoint(page);
  await page.keyboard.press('Tab'); await settle(page);
  expect(await bytes(page)).toEqual(original); expect(await checkpoint(page)).toEqual(before);
  expect(await page.evaluate(() => (window as any).nativeTransport.session.view.hasFocus)).toBe(true);
  await page.evaluate(() => (window as any).nativeCommand('undo'));
  expect(await bytes(page)).toEqual(original); expect(await checkpoint(page)).toEqual(before);
});

for (const sample of [
  { name: 'ordered child keeps its original number in the rendered hierarchy', source: '10. previous\n11. parent\n    - child\n12. next' },
  { name: 'quoted descendant retains literal Tab code content', source: '> - previous\n> - parent\n>   >\t\tcode\n\ntail' },
  { name: 'ordered quoted descendant retains its code block type', source: '> 10. previous\n> 11. parent\n>     >\t\tcode\n\ntail' },
  { name: 'partially Tab-indented nested fence retains its literal body', source: '> - previous\n> - parent\n>   >\t ```\n>   >\t   code\n>   >\t ```\n\ntail' },
  { name: 'a fence-like body line remains literal after container movement', source: '> - previous\n> - parent\n>   >>   ```\n>   >>\t ```\n>   >>   tail\n>   >>   ```\n\ntail' },
]) test(`real Tab: ${sample.name}`, async ({ page }) => {
  await page.evaluate(raw => (window as any).bootNative(raw), '\uFEFF' + sample.source.replaceAll('\n', '\r\n'));
  const original = await bytes(page), before = await rendered(page);
  await page.evaluate(at => (window as any).nativeSelect(at), sample.source.indexOf('parent'));
  if (sample.name.startsWith('a fence-like')) {
    const lines = await page.locator('.cm-live-code:not(.cm-live-code-delimiter)').allTextContents();
    expect(lines.some(line => line.includes('```'))).toBe(true);
  }
  await page.keyboard.press('Tab');
  const result = await rendered(page);
  expect(result.code).toEqual(before.code);
  if (sample.name.startsWith('a fence-like')) {
    const lines = await page.locator('.cm-live-code:not(.cm-live-code-delimiter)').allTextContents();
    expect(lines.some(line => line.includes('```'))).toBe(true);
  }
  if (/^(?:> )?10\./.test(sample.source)) {
    expect(result.nestedOrdered).toBe('11'); expect(result.nestedItems).toContain('parent');
    if (sample.source.includes('12. next')) expect(await text(page)).toContain('12. next');
  }
  const changed = await bytes(page);
  await assertModeRoundTrip(page);
  await page.evaluate(() => (window as any).nativeCommand('undo')); expect(await bytes(page)).toEqual(original);
  await page.evaluate(() => (window as any).nativeCommand('redo')); expect(await bytes(page)).toEqual(changed);
});

test('multiline quoted Setext converts into one rendered ATX heading and undoes exact bytes', async ({ page }) => {
  const raw = '\uFEFF> Alpha\r\n> Beta\n> =====\r\n\r\ntail';
  await page.evaluate(raw => (window as any).bootNative(raw), raw);
  const original = await bytes(page);
  await page.evaluate(() => (window as any).nativeSelect(10));
  await page.evaluate(() => (window as any).nativeCommand('format', { kind: 'heading', level: 3 }));
  expect(await text(page)).toBe('> ### Alpha Beta\n\ntail');
  expect((await rendered(page)).headings).toEqual([['H3', 'Alpha Beta']]);
  await page.getByText('tail', { exact: true }).click(); await settle(page);
  await expect(page.locator('.cm-live-h3')).toHaveCount(1);
  await page.evaluate(() => (window as any).nativeCommand('undo')); expect(await bytes(page)).toEqual(original);
  await page.evaluate(() => (window as any).nativeCommand('redo'));
  expect((await rendered(page)).headings).toEqual([['H3', 'Alpha Beta']]);
});

test('unclosed code EOF Enter/type/leave/return/undo/redo retains body rows and exact original bytes', async ({ page }) => {
  const raw = '\uFEFFtail\r\n\r\n````text\r\nx\n```\r\n';
  await page.evaluate(raw => (window as any).bootNative(raw), raw);
  const original = await bytes(page), initial = await text(page);
  await page.evaluate(() => {
    const s = (window as any).nativeTransport.session;
    (window as any).nativeSelect(s.state.doc.length);
  });
  await page.keyboard.press('Enter'); await page.keyboard.insertText('NEW');
  const expected = initial + '\nNEW';
  expect(await text(page)).toBe(expected);
  await page.getByText('tail', { exact: true }).click(); await settle(page);
  const content = page.locator('.cm-live-code').filter({ hasText: 'NEW' });
  await expect(content).toBeVisible();
  expect(await content.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  // The three-tick body row is not the closing delimiter of a four-tick fence.
  const fakeCloser = page.locator('.cm-live-code').filter({ hasText: /^```$/ });
  await expect(fakeCloser).toHaveCount(1);
  await expect(fakeCloser).not.toHaveClass(/cm-live-code-delimiter/);
  await content.click(); await settle(page);
  expect(await text(page)).toBe(expected);
  await page.evaluate(() => (window as any).nativeCommand('undo'));
  await page.evaluate(() => (window as any).nativeCommand('undo'));
  expect(await bytes(page)).toEqual(original);
  await page.evaluate(() => (window as any).nativeCommand('redo'));
  await page.evaluate(() => (window as any).nativeCommand('redo'));
  expect(await text(page)).toBe(expected);
  await assertModeRoundTrip(page);
});

for (const sample of [
  { name: 'quote', raw: '> AlphaBeta\n\ntail', at: 7, expected: '> Alpha\n> Beta\n\ntail' },
  { name: 'before quote prefix', raw: '> Alpha', at: 0, expected: '\n> Alpha' },
  { name: 'inner list in an outer list quote', raw: '- > 7. AlphaBeta\n  > 42. next\n\ntail', at: 12, expected: '- > 7. Alpha\n  > 8. Beta\n  > 42. next\n\ntail' },
  { name: 'ordered siblings', raw: '1. Alpha\n2. Beta\n3. Gamma', at: 8, expected: '1. Alpha\n2. \n2. Beta\n3. Gamma' },
  { name: 'math literal', raw: '$$\n- x\n$$\n\ntail', at: 6, expected: '$$\n- x\n\n$$\n\ntail' },
  { name: 'code literal', raw: '```text\n- x\n```\n\ntail', at: 11, expected: '```text\n- x\n\n```\n\ntail' },
]) test(`keyboard and menu newline share ${sample.name} ownership and preserve outside source`, async ({ page }) => {
  for (const route of ['keyboard', 'command']) {
    const raw = '\uFEFF' + sample.raw.replaceAll('\n', '\r\n');
    await page.evaluate(raw => (window as any).bootNative(raw), raw);
    const original = await bytes(page);
    await page.evaluate(at => (window as any).nativeSelect(at), sample.at);
    if (route === 'keyboard') await page.keyboard.press('Enter');
    else await page.evaluate(() => (window as any).nativeCommand('format', { kind: 'newline' }));
    expect(await text(page)).toBe(sample.expected);
    await page.evaluate(() => (window as any).nativeCommand('undo'));
    expect(await bytes(page)).toEqual(original);
    await page.evaluate(() => (window as any).nativeCommand('redo'));
    expect(await text(page)).toBe(sample.expected);
    await assertModeRoundTrip(page);
    expect(await text(page)).toBe(sample.expected);
  }
});

for (const gesture of ['drag forward', 'drag backward', 'shift arrows'] as const)
  test(`${gesture} replaces a real selected word, retains paragraphs after blur, and undoes exact mixed bytes`, async ({ page }) => {
    const raw = '\uFEFFAlphaBeta\r\n\r\ntail\nlast';
    await page.evaluate(raw => (window as any).bootNative(raw), raw);
    await settle(page);
    const original = await bytes(page);
    // DOM glyph ranges determine the gesture endpoints independently of CM's
    // source-to-coordinate APIs and without dispatching a test selection.
    const range = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.querySelector('.cm-content')!, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.textContent?.indexOf('AlphaBeta') ?? -1;
        if (start < 0) continue;
        const r = document.createRange(); r.setStart(node, start + 5); r.setEnd(node, start + 9);
        const box = r.getBoundingClientRect();
        return { x1: box.left + .1, x2: box.right - .1, y: box.top + box.height / 2 };
      }
      throw new Error('ordinary word glyph range missing');
    });
    if (gesture === 'shift arrows') {
      await page.mouse.click(range.x1, range.y);
      for (let n = 0; n < 4; n++) await page.keyboard.press('Shift+ArrowRight');
    } else {
      const backward = gesture === 'drag backward';
      await page.mouse.move(backward ? range.x2 : range.x1, range.y);
      await page.mouse.down();
      await page.mouse.move(backward ? range.x1 : range.x2, range.y, { steps: 8 });
      await page.mouse.up();
    }
    expect(await page.evaluate(() => {
      const s = (window as any).nativeTransport.session;
      return s.state.sliceDoc(s.state.selection.main.from, s.state.selection.main.to);
    })).toBe('Beta');
    await page.keyboard.press('Enter'); await page.keyboard.insertText('NEW');
    expect(await text(page)).toBe('Alpha\n\nNEW\n\ntail\nlast');
    await page.locator('.cm-live-paragraph').filter({hasText:'tail'}).click(); await settle(page);
    await expect(page.getByText('NEW',{exact:true})).toBeVisible();
    await page.evaluate(() => (window as any).nativeCommand('undo'));
    await page.evaluate(() => (window as any).nativeCommand('undo'));
    expect(await bytes(page)).toEqual(original);
  });
