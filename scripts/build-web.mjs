import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { access, copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { rawCssPlugin } from './web-tooling.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependency = name => path.join(root, 'node_modules', name);

/** Main's editor entry takes precedence without any changes to this build script. */
export async function selectEntry(directory = path.join(root, 'web/src')) {
  const main = path.join(directory, 'main.ts');
  try { await access(main); return main; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return path.join(directory, 'render-entry.ts');
}

/** Reusable native/editor packaging hook. Does not erase the destination. */
export async function copyRendererResources(outdir) {
  await mkdir(outdir, { recursive: true });
  for (const name of ['styles', 'fonts', 'licenses']) await mkdir(path.join(outdir, name), { recursive: true });
  await copyFile(path.join(root, 'web/index.html'), path.join(outdir, 'index.html'));
  await cp(path.join(root, 'web/styles'), path.join(outdir, 'styles'), { recursive: true });
  for (const weight of [400, 700]) for (const style of ['normal', 'italic']) {
    const name = `open-sans-latin-${weight}-${style}.woff2`;
    await copyFile(path.join(dependency('@fontsource/open-sans'), 'files', name), path.join(outdir, 'fonts', name));
  }
  for (const name of await readdir(path.join(dependency('katex'), 'dist/fonts'))) {
    await copyFile(path.join(dependency('katex'), 'dist/fonts', name), path.join(outdir, 'fonts', name));
  }
  const katexCSS = await readFile(path.join(dependency('katex'), 'dist/katex.min.css'), 'utf8');
  await writeFile(path.join(outdir, 'styles/katex.css'), katexCSS.replaceAll('url(fonts/', 'url(../fonts/'));
  const notices = [
    ['@fontsource/open-sans', 'LICENSE', 'Open-Sans-OFL.txt'],
    ['katex', 'LICENSE', 'KaTeX-LICENSE.txt'],
    ['markdown-it', 'LICENSE', 'markdown-it-LICENSE.txt'],
    ['markdown-it-task-lists', 'LICENSE', 'markdown-it-task-lists-LICENSE.txt'],
    ['highlight.js', 'LICENSE', 'highlight.js-LICENSE.txt'],
  ];
  for (const [name, license, output] of notices) await copyFile(path.join(dependency(name), license), path.join(outdir, 'licenses', output));
}

/** npm run build:web → build/web/{index.html,app.js,renderer.js,styles,fonts,licenses}.
 * Build-time dependency resolution only; output has no node_modules/runtime network need.
 */
export async function buildWeb({ outdir = path.join(root, 'build/web'), entry } = {}) {
  await copyRendererResources(outdir);
  // Keep a stable optional app stylesheet URL even if the selected entry has no CSS.
  await writeFile(path.join(outdir, 'app.css'), '/* Entry-specific styles, when present. */\n');
  const common = { bundle: true, format: 'esm', platform: 'browser', target: ['safari17', 'chrome120'], plugins: [rawCssPlugin()], legalComments: 'linked', logLevel: 'warning' };
  await build({ ...common, format: 'iife', entryPoints: [entry ?? await selectEntry()], outfile: path.join(outdir, 'app.js') });
  const exportEntry = path.join(root, 'web/src/export-main.ts');
  try {
    await access(exportEntry);
    await build({ ...common, format: 'iife', entryPoints: [exportEntry], outfile: path.join(outdir, 'export.js') });
    const editorHTML = await readFile(path.join(root, 'web/index.html'), 'utf8');
    const exportHTML = editorHTML
      .replace(/<main[^>]*id="editor"[^>]*><\/main>/, '')
      .replace('<script defer src="app.js"></script>', '<script defer src="export.js"></script>')
      .replace("img-src 'self' ret-resource: file: blob: data:", 'img-src ret-resource: data:');
    await writeFile(path.join(outdir, 'export.html'), exportHTML);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await build({ ...common, entryPoints: [path.join(root, 'web/src/render/markdown.ts')], outfile: path.join(outdir, 'renderer.js') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildWeb();
  console.log('Built offline web resources in build/web');
}
