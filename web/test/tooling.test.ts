import { afterEach, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { rawCssPlugin } from '../../scripts/web-tooling.mjs';

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

it('bundles raw CSS verbatim and preserves the original bytes for source-file reporting', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ret-css-tooling-'));
  folders.push(folder);
  const file = path.join(folder, '中文.css');
  const css = '\uFEFF.note::before { content: "中文 \\"引号\\" \\\\ 路径"; }\r\n';
  const bytes = Buffer.concat([Buffer.from(css), Buffer.from([0xff])]);
  await writeFile(file, bytes);
  const report: Record<string, { bytes: number; sha256: string }> = {};
  const reads: { file: string; bytes: Uint8Array }[] = [];
  const output = await build({
    stdin: { contents: 'import css from "./中文.css?raw"; globalThis.css = css;', resolveDir: folder },
    bundle: true, write: false, format: 'iife', plugins: [rawCssPlugin({ onRead(absolutePath, original) {
      reads.push({ file: absolutePath, bytes: original });
      report[path.relative(folder, absolutePath)] = { bytes: original.length, sha256: createHash('sha256').update(original).digest('hex') };
    } })],
  });
  const context: { css?: string } = {};
  runInNewContext(output.outputFiles[0].text, context);
  expect(context.css).toBe(css + '\uFFFD');
  expect(reads).toHaveLength(1); expect(reads[0].file).toBe(file);
  expect(Array.from(reads[0].bytes)).toEqual(Array.from(await readFile(file)));
  expect(report).toEqual({ '中文.css': { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
});

it('rejects inline imports by default and bundles both query forms when explicitly enabled', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ret-css-tooling-'));
  folders.push(folder);
  await writeFile(path.join(folder, 'fixture.css'), '.note { color: red; }\n');
  const options = {
    stdin: { contents: 'import inline from "./fixture.css?inline"; import raw from "./fixture.css?raw"; globalThis.css = [inline, raw];', resolveDir: folder },
    bundle: true, write: false as const, format: 'iife' as const, logLevel: 'silent' as const,
  };
  // A failing plugin resolution must be a real build error, not an ignored query.
  await expect(build({ ...options, plugins: [rawCssPlugin()] })).rejects.toThrow();
  const output = await build({ ...options, plugins: [rawCssPlugin({ inline: true })] });
  const context: { css?: string[] } = {};
  runInNewContext(output.outputFiles[0].text, context);
  expect(context.css).toEqual(['.note { color: red; }\n', '.note { color: red; }\n']);
});
