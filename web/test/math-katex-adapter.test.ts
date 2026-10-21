import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
const dependency = vi.hoisted(() => ({ version: '0.19.0' }));
vi.mock('katex/package.json', () => ({ get version() { return dependency.version; } }));
import { renderMappedMath } from '../src/render/math-katex';
import { _htmlGroupBuilders } from 'katex/src/defineFunction.ts';

const source = { from: 0, starts: [1], ends: [2] };
afterEach(() => { dependency.version = '0.19.0'; });

describe('pinned KaTeX private adapter', () => {
  it('bundles and runs the exact private source exports in the browser without a second engine', async () => {
    const result = await build({ entryPoints: ['web/src/render/math-katex.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'mathAdapter', platform: 'browser', target: ['safari17', 'chrome120'], metafile: true });
    const compiled = new Function(result.outputFiles[0].text + '\nreturn mathAdapter;')() as typeof import('../src/render/math-katex');
    expect(compiled.renderMappedMath('x', false, false, source)).toContain('data-math-map="[[0,1,1,2]]"');
    expect(Object.keys(result.metafile.inputs).some(path => path.includes('katex/dist/katex'))).toBe(false);
  });

  it('disables precision, retaining native output, when the dependency version changes', () => {
    const supported = renderMappedMath('x', false, false, source);
    expect(supported).toContain('data-math-map="[[0,1,1,2]]"');
    dependency.version = '0.20.0';
    const fallback = renderMappedMath('x', false, false, source);
    expect(fallback).not.toContain('data-math-');
    expect(fallback).toBe(supported.replace(/ data-math-(?:start|end|map)="[^"]*"/g, ''));
  });

  it('restores native builders after an exception, with no map leaked into the next render', () => {
    const native = _htmlGroupBuilders.mathord;
    const failure = () => { throw new Error('dependency builder failure'); };
    try {
      _htmlGroupBuilders.mathord = failure;
      expect(() => renderMappedMath('x', false, false, source)).toThrow('dependency builder failure');
      expect(_htmlGroupBuilders.mathord).toBe(failure);
    } finally { _htmlGroupBuilders.mathord = native; }
    expect(renderMappedMath('x', false, false, { from: 10, starts: [15], ends: [16] })).toContain('data-math-map="[[0,1,5,6]]"');
    expect(_htmlGroupBuilders.mathord).toBe(native);
  });
});
