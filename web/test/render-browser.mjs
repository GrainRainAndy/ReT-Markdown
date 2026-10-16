import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { chromiumFallbackPath } from '../../scripts/web-tooling.mjs';

// Run after build:web. No fixtures are generated or modified by this check.
const root = path.resolve('build/web');
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const fixture = relative === '/renderer-check.html';
  const file = fixture ? path.resolve('web/test/renderer-check.html') : path.resolve(root, `.${relative === '/' ? '/index.html' : relative}`);
  if (!fixture && !file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.RET_CHROMIUM || chromiumFallbackPath() });
try {
  const page = await browser.newPage();
  const external = [], errors = [], failed = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(`${origin}/renderer-check.html`);
  await page.evaluate(async () => {
    const { renderMarkdown } = await import('/renderer.js');
    const sample = '# Heading\n\nBody **bold** *italic* ***both*** $x^2$.\n\n> quote\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n![remote](https://never.test/a.png)';
    document.querySelector('.markdown-body').innerHTML = renderMarkdown(sample).html;
    await document.fonts.ready;
  });
  for (const [width, maxWidth] of [[1000, 860], [1399, 860], [1400, 1024], [1799, 1024], [1800, 1200]]) {
    await page.setViewportSize({ width, height: 1000 });
    const style = await page.locator('.markdown-body').evaluate(element => {
      const s = getComputedStyle(element), h = getComputedStyle(element.querySelector('h1'));
      return { width: element.getBoundingClientRect().width, padding: s.paddingLeft, bottom: s.paddingBottom, fontSize: s.fontSize, lineHeight: s.lineHeight, heading: h.fontSize, color: s.color };
    });
    assert.equal(style.width, maxWidth);
    assert.equal(style.padding, '30px');
    assert.equal(style.bottom, '100px');
    assert.equal(style.fontSize, '16px');
    assert.equal(style.lineHeight, '25.6px');
    assert.equal(style.heading, '36px');
    assert.equal(style.color, 'rgb(51, 51, 51)');
  }
  assert.equal(await page.evaluate(() => document.fonts.check('16px "Open Sans"')), true);
  assert.equal(await page.evaluate(() => document.fonts.check('italic 700 16px "Open Sans"')), true);
  assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('KaTeX') && font.status === 'loaded')), true);
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.notEqual(await page.locator('.markdown-body').evaluate(element => getComputedStyle(element).color), 'rgb(51, 51, 51)');
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const print = await page.locator('.markdown-body').evaluate(element => ({ padding: getComputedStyle(element).padding, color: getComputedStyle(element).color, font: getComputedStyle(element).fontSize }));
  assert.deepEqual(print, { padding: '0px', color: 'rgb(51, 51, 51)', font: '13px' });
  assert.equal(await page.locator('pre').evaluate(element => getComputedStyle(element).breakInside), 'avoid-page');
  await page.evaluate(async () => {
    const { renderMarkdown } = await import('/renderer.js');
    document.querySelector('.markdown-body').innerHTML = renderMarkdown('```text\n' + ('verylongidentifier'.repeat(100) + '\n').repeat(200) + '```\n\n| A | B |\n| - | - |\n' + ('| ' + 'word'.repeat(100) + ' | cell |\n').repeat(120)).html;
  });
  const overflows = await page.locator('pre, table').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.tagName));
  assert.deepEqual(overflows, []);
  const breaks = await page.locator('pre, table').evaluateAll(elements => elements.map(element => getComputedStyle(element).breakInside));
  assert.deepEqual(breaks, ['auto', 'auto']);
  await mkdir('/private/tmp/ret-renderer-checks', { recursive: true });
  const pdf = await page.pdf({ path: '/private/tmp/ret-renderer-checks/overflow.pdf', format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }, displayHeaderFooter: false, printBackground: true });
  assert.ok(pdf.byteLength > 10000);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  console.log('PASS browser: five width boundaries, offline fonts/resources, dark/print colors, long-code/table wrapping and multi-page PDF');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
