import { createRequire } from 'node:module';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserExportHost, prepareExport, type ExportHost, type ExportSnapshot } from '../src/export';

function snapshot(text: string, revision = 7): ExportSnapshot {
  return { text, revision, eols: Array(text.split('\n').length - 1).fill('\n'), bom: false };
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
// Only the browser boundary is substituted. Markdown/math/image policy uses the
// real renderer; readiness sequencing and returned diagnostics are production code.
function host(overrides: Partial<ExportHost> = {}): ExportHost & { html: string } {
  const result = {
    html: '',
    mount(html: string) { result.html = html; },
    async fontsReady() {},
    async imagesReady() { return []; },
    async layoutReady() {},
    overflow() { return []; },
    ...overrides,
  };
  return result;
}

describe('frozen export preparation', () => {
  it('waits for fonts and local image decode before returning ready', async () => {
    const fonts = barrier(), images = barrier();
    const browser = host({ fontsReady: () => fonts.promise, imagesReady: async () => { await images.promise; return []; } });
    let ready = false;
    const pending = prepareExport(snapshot('![本地](a.png)'), { 'a.png': 'ret-resource://export/a' }, { host: browser }).then(value => { ready = true; return value; });
    await Promise.resolve();
    expect(ready).toBe(false);
    fonts.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);
    images.resolve();
    expect((await pending).ready).toBe(true);
    expect(browser.html).toContain('ret-resource://export/a');
  });

  it('freezes revision, source and capabilities while the editor keeps typing', async () => {
    const fonts = barrier(), input = snapshot('![old](old.png)');
    const assets = { 'old.png': 'ret-resource://export/frozen' };
    const browser = host({ fontsReady: () => fonts.promise });
    const pending = prepareExport(input, assets, { host: browser });
    input.text = 'new typing'; input.revision = 8; assets['old.png'] = 'ret-resource://export/new';
    fonts.resolve();
    expect(await pending).toMatchObject({ revision: 7, ready: true });
    expect(browser.html).toContain('ret-resource://export/frozen');
    expect(browser.html).not.toContain('new typing');
  });

  it('blocks missing local images and preserves exact UTF-16 source ranges', async () => {
    const result = await prepareExport(snapshot('😀 ![lost](missing.png)'), {}, { host: host() });
    expect(result.ready).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'image', from: 3, to: 23 })]);
  });

  it('blocks invalid and unclosed math with a revealable source range', async () => {
    for (const text of ['$\\notACommand{x}$', '$$\nx+1']) {
      const result = await prepareExport(snapshot(text), {}, { host: host() });
      expect(result.ready).toBe(false);
      expect(result.issues).toEqual([expect.objectContaining({ kind: 'math', from: 0, to: text.length })]);
    }
  });

  it('accepts remote placeholders without assigning a network image URL', async () => {
    const browser = host();
    const result = await prepareExport(snapshot('![remote](https://example.test/a.png)'), {}, { host: browser });
    expect(result).toEqual({ revision: 7, ready: true, issues: [], overflow: [] });
    expect(browser.html).toContain('remote-image');
    expect(browser.html).not.toContain('<img');
  });

  it('resolves decoded Chinese/space destinations and reference images from manifest keys', async () => {
    for (const text of ['![中](%E4%B8%AD%20%E6%96%87.png)', '![中][asset]\n\n[asset]: <%E4%B8%AD%20%E6%96%87.png>']) {
      for (const key of ['中 文.png', '%E4%B8%AD%20%E6%96%87.png']) {
        const browser = host();
        const result = await prepareExport(snapshot(text), { [key]: 'ret-resource://asset/frozen' }, { host: browser });
        expect(result.ready).toBe(true);
        expect(browser.html).toContain('<img src="ret-resource://asset/frozen"');
      }
    }
  });

  it('blocks rejected font loads and does not print fallback layout', async () => {
    const result = await prepareExport(snapshot('Text'), {}, { host: host({ async fontsReady() { throw new Error('Font decode failed'); } }) });
    expect(result.ready).toBe(false);
    expect(result.failure).toMatch(/font/i);
  });

  it('blocks a resolved local capability whose image decode fails', async () => {
    const issue = { kind: 'image' as const, from: 0, to: 11, message: 'Image decode failed' };
    const result = await prepareExport(snapshot('![x](a.png)'), { 'a.png': 'ret-resource://export/a' }, { host: host({ async imagesReady() { return [issue]; } }) });
    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(issue);
  });

  it('awaits final math layout before measuring and blocks overwide formulas', async () => {
    const layout = barrier(); let measured = false;
    const pending = prepareExport(snapshot('$$x^2$$'), {}, { host: host({ layoutReady: () => layout.promise, overflow() { measured = true; return [{ from: 0, to: 7 }]; } }) });
    await Promise.resolve();
    expect(measured).toBe(false);
    layout.resolve();
    expect(await pending).toMatchObject({ ready: false, overflow: [{ from: 0, to: 7 }] });
  });

  it('times out a stalled readiness barrier instead of hanging forever', async () => {
    const result = await prepareExport(snapshot('Text'), {}, { host: host({ fontsReady: () => new Promise(() => {}) }), timeoutMs: 10 });
    expect(result.ready).toBe(false);
    expect(result.failure).toMatch(/timed out/i);
  });

  it('rejects malformed revisions and EOL metadata before mounting', async () => {
    for (const input of [{ ...snapshot('x'), revision: -1 }, { ...snapshot('x\ny'), eols: [] }]) {
      await expect(prepareExport(input, {}, { host: host() })).rejects.toThrow();
    }
  });
});

describe('browser export source ranges', () => {
  const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
    JSDOM: new (html: string) => { window: Window & typeof globalThis };
  };
  let dom: InstanceType<typeof JSDOM>;
  let document: Document;
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
    document = dom.window.document;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
  });

  const comment = '<!--\nfirst\n\nsecond\n-->\n\n';
  const formula = '$$\\underbrace{' + 'x+'.repeat(100) + 'x}$$';

  // jsdom supplies the real DOM, not layout. Substitute only geometry at the
  // browser boundary; mount, source mapping and overflow diagnostics stay real.
  function overflowing(selector: string): ExportHost {
    vi.spyOn(dom.window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { x: 0, y: 0, left: 0, top: 0, width: this.matches(selector) ? 900 : 600,
        right: this.matches(selector) ? 900 : 600, bottom: 20, height: 20, toJSON() {} };
    });
    vi.spyOn(dom.window.HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    });
    return { ...browserExportHost(document), async fontsReady() {} };
  }

  it('reveals formula 24..242 after an atomic multiline HTML comment (R6-1)', async () => {
    const input = snapshot(comment + formula);
    const before = structuredClone(input);
    const result = await prepareExport(input, {}, { host: overflowing('.katex-display') });
    expect(result).toMatchObject({ ready: false, issues: [], overflow: [{ from: 24, to: 242 }] });
    expect(input).toEqual(before);
    expect(document.querySelector('.raw-html')?.textContent).toBe('<!--\nfirst\n\nsecond\n-->\n');
    expect(document.querySelectorAll('script, iframe, img')).toHaveLength(0);
  });

  it.each([
    ['HTML element', '<div>\nfirst\n\nsecond\n</div>\n\n', 28],
    ['task list', comment + '- [x] first\n- second\n\n', 46],
    ['table', comment + '| A | B |\n| - | - |\n| c | d |\n\n', 55],
    ['reference definition', comment + '[asset]: a.png\n\n', 40],
  ])('keeps a following formula aligned after %s', async (_name, prefix, from) => {
    const result = await prepareExport(snapshot(prefix + formula), {}, { host: overflowing('.katex-display') });
    expect(result).toMatchObject({ ready: false, issues: [], overflow: [{ from, to: from + 218 }] });
  });

  it.each([
    ['task list', '- [x] $x^2$\n- next\n', '.katex', 43],
    ['table', '| A | B |\n| - | - |\n| $x^2$ | c |\n', '.katex', 58],
  ])('reveals the containing %s for nested formula overflow after HTML', async (_name, block, selector, to) => {
    const result = await prepareExport(snapshot(comment + block), {}, { host: overflowing(selector) });
    expect(result).toMatchObject({ ready: false, issues: [], overflow: [{ from: 24, to }] });
  });

  it.each([
    ['paragraph', '![x](a.png)', 35],
    ['task list', '- [x] ![x](a.png)\n- next\n', 49],
    ['table', '| A | B |\n| - | - |\n| ![x](a.png) | c |\n', 64],
  ])('reveals the %s for a real host image decode rejection after HTML', async (_name, block, to) => {
    const browser = browserExportHost(document);
    const mount = browser.mount;
    browser.mount = (html, source) => {
      mount(html, source);
      Object.defineProperty(document.querySelector('img')!, 'decode', {
        value: async () => { throw new Error('Invalid local image bytes'); },
      });
    };
    browser.fontsReady = async () => {};
    const result = await prepareExport(snapshot(comment + block), { 'a.png': 'ret-resource://export/a' }, { host: browser });
    expect(result).toMatchObject({ ready: false, overflow: [], issues: [
      { kind: 'image', message: 'Local image decode failed', from: 24, to },
    ] });
    expect(document.querySelector('img')?.getAttribute('src')).toBe('ret-resource://export/a');
  });
});

it.skipIf(process.env.RET_EXPORT_BROWSER !== '1')('checks real browser fonts, image decode, print wrapping and formula overflow', async () => {
  const { chromium } = await import('playwright');
  const { build } = await import('esbuild');
  const { mkdtemp, readFile, writeFile, rm } = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const path = await import('node:path');
  const folder = await mkdtemp('/private/tmp/ret-export-browser-');
  const browser = await chromium.launch({ executablePath: process.env.RET_CHROMIUM
    ?? chromiumFallbackPath() });
  try {
    const { copyRendererResources } = await import('../../scripts/build-web.mjs');
    await copyRendererResources(folder);
    await build({ entryPoints: ['web/src/export-main.ts'], outfile: path.join(folder, 'export.js'), bundle: true, format: 'iife', plugins: [rawCssPlugin({ inline: true })] });
    await writeFile(path.join(folder, 'export.html'), '<!doctype html><meta charset="utf-8">'
      + ['fonts', 'katex', 'typography', 'palette', 'print'].map(name => `<link rel="stylesheet" href="styles/${name}.css">`).join('')
      + '<body><script src="export.js"></script></body>');
    const page = await browser.newPage();
    const external: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
    const load = async () => { await page.goto(pathToFileURL(path.join(folder, 'export.html')).href + `?job=${Math.random()}`); };
    await load();
    const source = '# 中文\n\n```text\nshort code\n```\n\n![local](a.png)\n\n![remote](https://never.test/x.png)\n\n$x^2$';
    const good = await page.evaluate(async ({ input }) => window.retExport.prepareExport(input, {
      'a.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    }), { input: snapshot(source) });
    expect(good.failure).toBeUndefined();
    expect(good).toMatchObject({ ready: true, overflow: [], issues: [] });
    expect(await page.locator('main').evaluate(element => ({ padding: getComputedStyle(element).padding, font: getComputedStyle(element).fontSize, color: getComputedStyle(element).backgroundColor })))
      .toEqual({ padding: '0px', font: '13px', color: 'rgb(255, 255, 255)' });
    expect(await page.locator('pre').evaluate(element => getComputedStyle(element).breakInside)).toBe('avoid-page');
    expect(external).toEqual([]);
    await load();
    const formula = '$$\\underbrace{' + 'x+'.repeat(100) + 'x}$$';
    const input = snapshot('<!--\nfirst\n\nsecond\n-->\n\n' + formula);
    const overflow = await page.evaluate(input => window.retExport.prepareExport(input, {}), input);
    expect(overflow.ready).toBe(false);
    expect(overflow.overflow).toContainEqual({ from: 24, to: 242 });
    expect(external).toEqual([]);
    await load();
    const long = '```text\n' + ('longidentifier'.repeat(70) + '\n').repeat(150) + '```\n\n| A | B |\n| - | - |\n' + '| long table content | cell |\n'.repeat(150);
    const fragmented = await page.evaluate(input => window.retExport.prepareExport(input, {}), snapshot(long));
    expect(fragmented).toMatchObject({ ready: true, overflow: [] });
    expect(await page.locator('pre').evaluate(element => getComputedStyle(element).breakInside)).toBe('auto');
    expect(await page.evaluate(() => window.retExport.validation().minimumPages)).toBeGreaterThan(1);
    await load();
    const badImage = await page.evaluate(input => window.retExport.prepareExport(input, { 'a.png': 'data:image/png;base64,AAAA' }), snapshot('![x](a.png)'));
    expect(badImage.ready).toBe(false);
    expect(badImage.issues).toEqual([expect.objectContaining({ kind: 'image', from: 0, to: 11 })]);
    await page.route('**/fonts/**', route => route.abort());
    await load();
    const badFont = await page.evaluate(input => window.retExport.prepareExport(input, {}), snapshot('font test'));
    expect(badFont.ready).toBe(false);
    expect(badFont.failure).toMatch(/font|network/i);
  } finally { await browser.close(); await rm(folder, { recursive: true, force: true }); }
}, 30_000);
