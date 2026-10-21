import { test, expect, type Page } from 'playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';

let bundle: string;
let styles: string;
const errors = new WeakMap<Page, string[]>();
test.use({ launchOptions: { executablePath: process.env.RET_CHROMIUM || chromiumFallbackPath() } });
test.beforeAll(async () => {
  const result = await build({
    entryPoints: ['web/test/live-browser-harness.ts'], bundle: true, write: false, format: 'iife',
    plugins: [rawCssPlugin()],
  });
  bundle = result.outputFiles[0].text;
  styles = (await Promise.all(['typography', 'palette'].map(name => readFile(`web/styles/${name}.css`, 'utf8')))).join('\n');
  styles += (await readFile('node_modules/katex/dist/katex.min.css', 'utf8')).replace(/@font-face\{[^}]*\}/g, '');
});
test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.setContent('<main></main>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({ content: bundle });
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const boot = (page: Page, text: string) => page.evaluate(text => (window as any).boot(text), text);
const select = (page: Page, at: number) => page.evaluate(at => (window as any).select(at), at);
const command = (page: Page, name: string, args?: unknown) => page.evaluate(({ name, args }) => (window as any).command(name, args), { name, args });
const bytes = (page: Page) => page.evaluate(() => (window as any).bytes());

for (const { name, start, continuation } of [
  { name: 'quote', start: '> ', continuation: '> ' },
  { name: 'nested quote', start: '> > ', continuation: '> > ' },
  { name: 'list', start: '- ', continuation: '  ' },
]) {
  const formula = (tex: string) => `${start}$$\n${continuation}${tex}\n${continuation}$$`;

  test(`F08 ${name}: live TeX equals document annotation`, async ({ page }) => {
    const source = `😀 中文\n\n${formula('\\frac{1}{2}')}\n\nend`;
    await boot(page, source);
    const result = await page.evaluate(() => {
      const reference = (window as any).render((window as any).snapshot().text);
      const referenceDOM = new DOMParser().parseFromString(reference.html, 'text/html');
      const selector = 'annotation[encoding="application/x-tex"]';
      return {
        issues: reference.issues,
        documentTex: referenceDOM.querySelector(selector)?.textContent,
        liveTex: document.querySelector('.cm-live-math')?.querySelector(selector)?.textContent,
      };
    });
    expect(result.issues).toEqual([]);
    expect(result.documentTex).toBe('\\frac{1}{2}');
    expect(result.liveTex).toBe(result.documentTex);
    await expect(page.locator('.cm-live-math .katex-display')).toHaveCount(1);
    await expect(page.locator('.cm-live-math .math-error')).toHaveCount(0);
  });

  test(`F08 ${name}: invalid formula retains document error and source coordinates`, async ({ page }) => {
    const source = `😀 中文\n\n${formula('\\oops')}\n\nend`;
    await boot(page, source);
    const result = await page.evaluate(() => {
      const api = window as any;
      const reference = api.render(api.snapshot().text);
      const referenceDOM = new DOMParser().parseFromString(reference.html, 'text/html');
      const read = (element: Element | null) => element && ({
        from: Number(element.getAttribute('data-from')), to: Number(element.getAttribute('data-to')),
        source: element.textContent, message: element.getAttribute('title'), tag: element.tagName,
      });
      return { issues: reference.issues, documentError: read(referenceDOM.querySelector('.math-error')), liveError: read(document.querySelector('.cm-live-math .math-error')) };
    });
    const from = source.indexOf('$$'), to = source.lastIndexOf('$$') + 2;
    expect(result.issues).toEqual([{ kind: 'math', from, to, message: expect.stringContaining('Undefined control sequence') }]);
    expect(result.liveError).toEqual({ from, to, source: source.slice(from, to), message: result.issues[0].message, tag: 'DIV' });
    expect(result.liveError).toEqual(result.documentError);
    await expect(page.locator('.cm-live-math .math-error')).toHaveCount(1);
    await expect(page.locator('.cm-live-math .katex')).toHaveCount(0);
  });

  test(`F08 ${name}: source/reveal/caret preserve raw bytes and one root undo`, async ({ page }) => {
    const raw = `\ufeff😀 中文\r\n\r\n${formula('\\frac{1}{2}').replaceAll('\n', '\r\n')}\r\n\rend`;
    await boot(page, raw);
    const original = await bytes(page);
    expect(original).toEqual(Array.from(new TextEncoder().encode(raw)));
    const source: string = await page.evaluate(() => (window as any).snapshot().text);
    const from = source.indexOf('$$'), to = source.lastIndexOf('$$') + 2;
    const widget = page.locator('.cm-live-math');

    // Hit the actual numerator rather than the full-width display container.
    const point = await widget.locator('.katex-html').evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf('1'); if (at < 0) continue;
        const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width * .9, y: (box.top + box.bottom) / 2 };
      }
      throw new Error('Missing fraction numerator');
    });
    await page.mouse.click(point.x, point.y);
    await expect(widget).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).session.state.selection.main.head)).toBe(source.indexOf('{1}') + 2);
    expect(await page.evaluate(() => (window as any).session.view.hasFocus)).toBe(true);
    await expect(page.locator('#editor')).toContainText('\\frac{1}{2}');
    const caret = await page.evaluate(() => {
      const view = (window as any).session.view;
      const rect = view.coordsAtPos(view.state.selection.main.head);
      const box = view.dom.getBoundingClientRect();
      return rect && { visible: rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom, height: rect.bottom - rect.top };
    });
    expect(caret?.visible).toBe(true);
    expect(caret?.height).toBeGreaterThan(0);

    await select(page, source.length);
    await expect(widget).toHaveCount(1);
    await command(page, 'revealRange', { from, to });
    await expect(widget).toHaveCount(0);
    expect(await page.evaluate(() => {
      const session = (window as any).session, range = session.state.selection.main;
      return session.state.sliceDoc(range.from, range.to);
    })).toBe(source.slice(from, to));
    await command(page, 'setMode', { mode: 'source' });
    await expect(page.locator('#editor > .cm-editor')).toHaveAttribute('data-mode', 'source');
    expect(await page.locator('#editor .cm-content').innerText()).toContain(formula('\\frac{1}{2}'));
    await command(page, 'setMode', { mode: 'live' });
    await select(page, source.length);
    await expect(widget.locator('annotation[encoding="application/x-tex"]')).toHaveText('\\frac{1}{2}');
    expect(await bytes(page)).toEqual(original);
    expect(await page.evaluate(() => ({ commits: (window as any).commits.length, canUndo: (window as any).session.status().canUndo }))).toEqual({ commits: 0, canUndo: false });

    const editAt = source.indexOf('{1}') + 1;
    await select(page, editAt);
    await page.keyboard.insertText('3');
    expect(await page.evaluate(() => (window as any).snapshot().text)).toBe(source.slice(0, editAt) + '3' + source.slice(editAt));
    await select(page, source.length + 1);
    await expect(widget.locator('annotation[encoding="application/x-tex"]')).toHaveText('\\frac{31}{2}');
    await command(page, 'undo');
    expect(await bytes(page)).toEqual(original);
    expect(await page.evaluate(() => (window as any).commits.map((commit: any) => commit.reason))).toEqual(['edit', 'undo']);
    expect(await page.evaluate(() => (window as any).session.status().canUndo)).toBe(false);
  });
}
