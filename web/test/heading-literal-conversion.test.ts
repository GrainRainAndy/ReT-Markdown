import { expect, it } from 'vitest';
import { createSession } from '../src/editor/session';
import { decodeSource, encodeSource } from '../src/editor/source';
import { renderMarkdown } from '../src/render/markdown';

for (const prefix of ['', '> ']) for (const level of [3, 6]) for (const sample of [
  { body: 'Beta ###', source: 'Beta \\###', html: 'Beta ###' },
  { body: 'Beta # #', source: 'Beta # \\#', html: 'Beta # #' },
  { body: 'Beta \\###', source: 'Beta \\###', html: 'Beta ###' },
  { body: 'Beta `###`', source: 'Beta `###`', html: 'Beta <code>###</code>' },
]) it(`preserves literal trailing hashes in Setext → H${level}: ${prefix}${sample.body}`, async () => {
  const text = `${prefix}Alpha\n${prefix}${sample.body}\n${prefix}=====\n\ntail`;
  let eol = 0;
  const raw = '\uFEFF' + text.replace(/\n/g, () => ['\r\n', '\n', '\r'][eol++ % 3]);
  const original = new TextEncoder().encode(raw), s = createSession({ ...decodeSource(original), revision: 0 }, () => {});
  try {
    s.setMode('live'); s.dispatch({ selection: { anchor: text.indexOf('Beta') } });
    await s.command('format', { kind: 'heading', level });
    expect(s.snapshot().text).toBe(`${prefix}${'#'.repeat(level)} Alpha ${sample.source}\n\ntail`);
    expect(renderMarkdown(s.snapshot().text).html).toContain(`<h${level}>Alpha ${sample.html}</h${level}>`);
    const changed = encodeSource(s.snapshot());
    await s.command('undo'); expect(encodeSource(s.snapshot())).toEqual(original);
    await s.command('redo'); expect(encodeSource(s.snapshot())).toEqual(changed);
  } finally { s.destroy(); }
});
