import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

it('builds portable offline renderer resources including four Open Sans faces and font licenses', async () => {
  const directory = await mkdtemp('/private/tmp/ret-render-build-');
  temporary.push(directory);
  const { buildWeb } = await import('../../scripts/build-web.mjs');
  await buildWeb({ outdir: directory, entry: path.resolve('web/src/render-entry.ts') });
  const files = await readdir(directory);
  expect(files).toEqual(expect.arrayContaining(['index.html', 'app.js', 'renderer.js', 'styles', 'fonts', 'licenses']));
  expect((await readdir(path.join(directory, 'fonts'))).filter(file => file.startsWith('open-sans-'))).toHaveLength(4);
  expect((await readFile(path.join(directory, 'licenses', 'Open-Sans-OFL.txt'), 'utf8'))).toContain('SIL OPEN FONT LICENSE');
  expect((await readFile(path.join(directory, 'licenses', 'KaTeX-LICENSE.txt'), 'utf8'))).toContain('Permission is hereby granted');
  const css = await readFile(path.join(directory, 'styles', 'katex.css'), 'utf8');
  expect(css).toContain('../fonts/KaTeX');
  expect(css).not.toMatch(/https?:\/\//);
  const bundle = await readFile(path.join(directory, 'renderer.js'), 'utf8');
  expect(bundle).toContain('renderMarkdown');
});

it('selects main.ts when present and uses the renderer fallback otherwise', async () => {
  const directory = await mkdtemp('/private/tmp/ret-render-entry-');
  temporary.push(directory);
  const { selectEntry } = await import('../../scripts/build-web.mjs');
  await writeFile(path.join(directory, 'render-entry.ts'), 'export {};');
  expect(await selectEntry(directory)).toBe(path.join(directory, 'render-entry.ts'));
  await writeFile(path.join(directory, 'main.ts'), 'export {};');
  expect(await selectEntry(directory)).toBe(path.join(directory, 'main.ts'));
});
