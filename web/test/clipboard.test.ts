import { describe, it, expect } from 'vitest';
import { clipboardPayload, pastePayload, sourceSelection } from '../src/editor/clipboard';
import { createSession } from '../src/editor/session';
import { decodeSource } from '../src/editor/source';

const source = (raw: string) => decodeSource(new TextEncoder().encode(raw));
describe('source-based clipboard', () => {
  it('expands full live inline contents to hidden markers but source copy remains exact', () => {
    const s = source('before **bold** after');
    expect(sourceSelection(s, { anchor: 9, head: 13 }, 'live')).toBe('**bold**');
    expect(sourceSelection(s, { anchor: 9, head: 13 }, 'source')).toBe('bold');
    expect(sourceSelection(s, { anchor: 10, head: 12 }, 'live')).toBe('ol');
    expect(sourceSelection(source('[label](https://example.com)'), { anchor: 1, head: 6 }, 'live')).toBe('[label](https://example.com)');
  });
  it('preserves selected raw EOLs and never includes the file BOM', () => {
    expect(sourceSelection(source('\uFEFFa\r\nb\rc'), { anchor: 0, head: 5 }, 'source')).toBe('a\r\nb\rc');
  });
  it('copies source by default, plain visible text, or HTML and a text fallback', () => {
    const s = source('**bold**'); const selection = { anchor: 0, head: 8 };
    expect(clipboardPayload(s, selection, 'source', 'source')).toEqual({ text: '**bold**' });
    expect(clipboardPayload(s, selection, 'source', 'plain')).toEqual({ text: 'bold' });
    const rich = clipboardPayload(s, selection, 'source', 'rich');
    expect(rich.text).toBe('bold'); expect(rich.html).toContain('<strong>bold</strong>');
  });
  it('prefers raw plain text over rich HTML and routes image-only paste to native', () => {
    expect(pastePayload({ text: '**a**\r\nb', html: '<b>other</b>', hasImage: true })).toEqual({ kind: 'text', source: source('**a**\r\nb') });
    expect(pastePayload({ text: null, html: '<script>bad()</script>', hasImage: false })).toEqual({ kind: 'none' });
    expect(pastePayload({ text: null, hasImage: true })).toEqual({ kind: 'image' });
  });
  it('uses real session copy and paste commands without copy history, and one paste undo', async () => {
    const writes: { text: string; html?: string }[] = [];
    const s = createSession({ ...source('**bold**'), revision: 0 }, () => {}, { writeClipboard: p => { writes.push(p); } });
    s.dispatch({ selection: { anchor: 0, head: 8 } });
    await s.command('copySource'); await s.command('copyPlain'); await s.command('copyRich');
    expect(writes.map(p => p.text)).toEqual(['**bold**', 'bold', 'bold']); expect(writes[2].html).toContain('<strong>');
    expect(s.snapshot().revision).toBe(0);
    await s.paste({ text: 'raw\r\n**md**', html: '<h1>ignored</h1>' });
    expect(s.snapshot()).toMatchObject({ text: 'raw\n**md**', eols: ['\r\n'], revision: 1 });
    await s.command('undo'); expect(s.snapshot().text).toBe('**bold**');
  });
});

describe('S3 reference definitions outside the copied selection', () => {
  it('copies the valid reference after an executable definition without changing source or history', async () => {
    const original = { ...source('[label][ref]\r\n\r\n[ref]: javascript:alert%281%29\n\n[ref]: https://example.com/valid'), revision: 0 };
    const writes: { text: string; html?: string }[] = [];
    const s = createSession(original, () => {}, { writeClipboard: p => { writes.push(p); } });
    s.setMode('live'); s.dispatch({ selection: { anchor: 1, head: 6 } });
    await s.command('copySource'); await s.command('copyPlain'); await s.command('copyRich');
    expect(writes[0]).toEqual({ text: '[label][ref]' });
    expect(writes[1]).toEqual({ text: 'label' });
    expect(writes[2].text).toBe('label');
    const html = writes[2].html!;
    const body = html.slice(html.indexOf('</style>') + 8);
    expect(body).toContain('<p><a href="https://example.com/valid">label</a></p>');
    expect(body).not.toContain('javascript:'); expect(body).not.toContain('[ref]:');
    expect(s.snapshot()).toEqual(original); expect(s.status().canUndo).toBe(false);
  });
  it.each(['[label][ref]', '[label][]', '[label]'])('converts %s in document context while keeping source copy exact', async fragment => {
    const original = { ...source(`${fragment}\r\n\r\n[ref]: https://example.com\n[label]: https://example.com`), revision: 0 };
    const writes: { text: string; html?: string }[] = [];
    const s = createSession(original, () => {}, { writeClipboard: p => { writes.push(p); } });
    s.setMode('live'); s.dispatch({ selection: { anchor: 1, head: 6 } });
    await s.command('copySource'); await s.command('copyPlain'); await s.command('copyRich');
    expect(writes[0]).toEqual({ text: fragment });
    expect(writes[1]).toEqual({ text: 'label' });
    expect(writes[2].text).toBe('label'); expect(writes[2].html).toContain('<a href="https://example.com">label</a>');
    expect(s.snapshot()).toEqual(original); expect(s.status().canUndo).toBe(false);
  });
  it.each(['![alt][image]', '![alt][]', '![alt]'])('converts reference image %s with local capability and text fallback', fragment => {
    const original = source(`${fragment}\n\n[image]: local.png\n[alt]: local.png`), selection = { anchor: 2, head: 5 };
    expect(clipboardPayload(original, selection, 'live', 'source')).toEqual({ text: fragment });
    expect(clipboardPayload(original, selection, 'live', 'plain')).toEqual({ text: 'alt' });
    const seen: string[] = [];
    const rich = clipboardPayload(original, selection, 'live', 'rich', { resolveImage: d => { seen.push(d); return 'ret-resource://asset/local'; } });
    expect(rich.text).toBe('alt'); expect(rich.html).toContain('<img src="ret-resource://asset/local" alt="alt">'); expect(seen).toEqual(['local.png']);
  });
});

describe('S3-R1 parsed reference context inside multiline containers', () => {
  const cases = [
    { definition: '> [ref]: https://example.com\n>   "title"', anchor: '<a href="https://example.com" title="title">label</a>' },
    { definition: '> [ref]:\n>   https://example.com', anchor: '<a href="https://example.com">label</a>' },
  ];
  it.each(cases)('keeps container definition $definition invisible while preserving destination/title', async ({ definition, anchor }) => {
    const original = { ...source(`${definition}\r\n>\r\n> [label][ref]\n\nordinary text`), revision: 0 };
    const writes: { text: string; html?: string }[] = [];
    const s = createSession(original, () => {}, { writeClipboard: p => { writes.push(p); } });
    const from = original.text.indexOf('[label]') + 1;
    s.setMode('live'); s.dispatch({ selection: { anchor: from, head: from + 5 } });
    await s.command('copySource'); await s.command('copyPlain'); await s.command('copyRich');
    expect(writes[0]).toEqual({ text: '[label][ref]' });
    expect(writes[1]).toEqual({ text: 'label' }); expect(writes[2].text).toBe('label');
    const richBody = writes[2].html!.slice(writes[2].html!.indexOf('</style>') + 8);
    expect(richBody).toContain(anchor);
    expect(richBody).not.toContain('<blockquote>'); expect(richBody).not.toContain('<p>"title"');
    expect(richBody).not.toContain('[ref]:');
    expect(s.snapshot()).toEqual(original); expect(s.status().canUndo).toBe(false);
  });
  it.each(cases)('does not leak $definition into unrelated ordinary text copy', ({ definition }) => {
    const original = source(`${definition}\n>\n> [label][ref]\n\nordinary text`), from = original.text.indexOf('ordinary');
    const selection = { anchor: from, head: from + 13 };
    expect(clipboardPayload(original, selection, 'live', 'source')).toEqual({ text: 'ordinary text' });
    expect(clipboardPayload(original, selection, 'live', 'plain')).toEqual({ text: 'ordinary text' });
    const rich = clipboardPayload(original, selection, 'live', 'rich');
    const html = rich.html!;
    expect(rich.text).toBe('ordinary text'); expect(html.slice(html.indexOf('</style>') + 8)).toMatch(/><p>ordinary text<\/p>\n<\/div>$/);
  });
});

it('retains parsed first-definition precedence and escaped title/URL semantics across containers', () => {
  const original = source('[label][ref]\n\n> - [ref]:\n>     <https://example.com/?a=&amp;copy;>\n>     "a \\\\ b &quot;c&quot;"\n\n[ref]: https://wrong.test "wrong"');
  const selection = { anchor: 1, head: 6 };
  expect(clipboardPayload(original, selection, 'live', 'plain')).toEqual({ text: 'label' });
  const rich = clipboardPayload(original, selection, 'live', 'rich');
  expect(rich.html).toContain('<a href="https://example.com/?a=&amp;copy;" title="a \\ b &quot;c&quot;">label</a>');
  expect(rich.text).toBe('label');
});
