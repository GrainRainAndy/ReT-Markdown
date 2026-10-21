import { test, expect, type Page } from 'playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';

let bundle: string, styles: string;
test.use({ launchOptions: { executablePath: process.env.RET_CHROMIUM || chromiumFallbackPath() } });
test.beforeAll(async () => {
  const result = await build({ entryPoints: ['web/test/final-live-browser-harness.ts'], bundle: true, write: false, format: 'iife', plugins: [rawCssPlugin()] });
  bundle = result.outputFiles[0].text;
  styles = (await Promise.all(['typography', 'palette', 'print'].map(name => readFile(`web/styles/${name}.css`, 'utf8')))).join('\n');
  styles += (await readFile('node_modules/katex/dist/katex.min.css', 'utf8')).replace(/@font-face\{[^}]*\}/g, '');
});
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 940, height: 740 });
  await page.setContent('<main id="editor"></main>');
  await page.addStyleTag({ content: styles });
  await page.evaluate(() => { (window as any).webkit = { messageHandlers: { ret: { postMessage: () => {} } } }; });
  await page.addScriptTag({ content: bundle });
});

const headings = '# ATX 标题\n\n甲段正文在标题之后。\n\nSetext 标题\n===========\n\n乙段正文在下划线标题之后。\n\n尾部停靠。\n';
const code = '# 代码上下文\n\n丙段位于围栏之前。\n\n```javascript\nconst answer = 42;\n```\n\n丁段位于围栏之后。\n\n尾部停靠。\n';
const quote = '# 引用上下文\n\n> 外层引用\n>\n> > 戊段嵌套引用正文。\n> > 第二行引用。\n\n己段回到普通正文。\n\n尾部停靠。\n';
const finalParagraph = '# 末段上下文\n\nSetext 标题\n-----------\n\n```text\n围栏内容\n```\n\n庚段没有尾换行，😀仍保留';
const longDocument = Array.from({ length: 28 }, (_, i) =>
  `## 第 ${i} 节\n\n${i === 16 ? '辛段滚动后的唯一正文。' : `普通段落 ${i}，用于越过初始可见区域。`}\n\n`).join('') + '最后停靠。';

// Source offsets are independently derived from these LF fixtures. The raw
// input deliberately also carries a BOM, CRLF, CR and LF, including no final LF.
const rawFixture = (source: string) => '\ufeff' + source.split('\n').map((line, i, lines) =>
  line + (i === lines.length - 1 ? '' : ['\r\n', '\n', '\r'][i % 3])).join('');
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

async function boot(page: Page, source: string, mode: 'live' | 'source', zoom = 1) {
  await page.evaluate(({ raw, mode }) => (window as any).bootNative(raw, {}, mode), { raw: rawFixture(source), mode });
  await page.evaluate(zoom => (window as any).nativeCommand('setZoom', { zoom }), zoom);
  await settle(page);
  expect(await page.evaluate(() => (window as any).nativeTransport.session.snapshot().text)).toBe(source);
}

// Never ask CM for coordinates or a position oracle. Find the first glyph in
// actual rendered text and click its leading tenth, away from caret midpoints.
async function glyphBox(page: Page, target: string) {
  return page.evaluate(target => {
    const content = document.querySelector('#editor > .cm-editor > .cm-scroller > .cm-content')!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(target);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + 1);
      const box = range.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return { x: box.left + box.width * .1, y: (box.top + box.bottom) / 2 };
    }
    return null;
  }, target);
}

async function scrollToGlyph(page: Page, target: string) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('.cm-scroller')!.scrollTop = 0;
  });
  await settle(page);
  const initial = await glyphBox(page, target);
  expect(initial === null || initial.y > 740, 'target starts below the viewport').toBe(true);
  await page.mouse.move(470, 370);
  // Bounded real wheel scrolling also exercises CM viewport remeasurement.
  for (let i = 0; i < 24; i++) {
    const point = await glyphBox(page, target);
    if (point && point.y >= 100 && point.y <= 640) return;
    await page.mouse.wheel(0, point && point.y < 100 ? -350 : 350);
    await settle(page);
  }
  throw new Error(`Wheel scrolling did not expose ${target}`);
}

async function clickEditUndo(page: Page, source: string, target: string) {
  const expected = source.indexOf(target);
  expect(expected).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(target, expected + 1), 'target must identify one source position').toBe(-1);
  const point = await glyphBox(page, target);
  expect(point, `visible DOM glyph for ${target}`).not.toBeNull();
  expect(point!.x).toBeGreaterThan(0); expect(point!.x).toBeLessThan(940);
  expect(point!.y).toBeGreaterThan(0); expect(point!.y).toBeLessThan(740);
  await page.mouse.click(point!.x, point!.y);
  const selection = await page.evaluate(() => (window as any).nativeTransport.session.selection());
  console.log(JSON.stringify({ target, expected, selection, point }));
  // Soft checks retain the edit/undo evidence even on the current hit-test RED.
  expect.soft(selection, `DOM click must land before ${target}`).toEqual({ anchor: expected, head: expected });
  await page.keyboard.insertText('中');
  expect.soft(await page.evaluate(() => (window as any).nativeTransport.session.snapshot().text), `local insertion at ${target}`)
    .toBe(source.slice(0, expected) + '中' + source.slice(expected));
  await page.evaluate(() => (window as any).nativeCommand('undo'));
  expect(await page.evaluate(() => (window as any).nativeBytes()), 'one Undo restores original BOM and every EOL byte')
    .toEqual(Array.from(new TextEncoder().encode(rawFixture(source))));
  await settle(page);
}

test('live: ordinary body after ATX and Setext headings', async ({ page }) => {
  await boot(page, headings, 'live');
  for (const target of ['甲段', '乙段']) await clickEditUndo(page, headings, target);
});

test('live: ordinary body before and after fenced code', async ({ page }) => {
  await boot(page, code, 'live');
  for (const target of ['丙段', '丁段']) await clickEditUndo(page, code, target);
});

test('live: nested quote text and following ordinary body', async ({ page }) => {
  await boot(page, quote, 'live');
  for (const target of ['戊段', '己段']) await clickEditUndo(page, quote, target);
});

for (const zoom of [.75, 1.5]) test(`live: long document after wheel scroll at zoom ${zoom}`, async ({ page }) => {
  await boot(page, longDocument, 'live', zoom);
  await scrollToGlyph(page, '辛段');
  await clickEditUndo(page, longDocument, '辛段');
});

test('live: final paragraph without trailing LF, local edit and one Undo', async ({ page }) => {
  expect(finalParagraph.endsWith('\n')).toBe(false);
  await boot(page, finalParagraph, 'live');
  await clickEditUndo(page, finalParagraph, '庚段');
});

test('source control: same DOM clicks, local edits, BOM/EOL Undo and scrolled zooms', async ({ page }) => {
  for (const [source, targets] of [
    [headings, ['甲段', '乙段']], [code, ['丙段', '丁段']],
    [quote, ['戊段', '己段']], [finalParagraph, ['庚段']],
  ] as const) {
    await boot(page, source, 'source');
    for (const target of targets) await clickEditUndo(page, source, target);
  }
  for (const zoom of [.75, 1.5]) {
    await boot(page, longDocument, 'source', zoom);
    await scrollToGlyph(page, '辛段');
    await clickEditUndo(page, longDocument, '辛段');
  }
});
