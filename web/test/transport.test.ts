// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createTransport } from '../src/main';
import type { Envelope, Snapshot } from '../src/protocol';
const identity = { documentID: 'doc', sessionID: 'session' };
const initial: Snapshot = { text: 'a\nb', eols: ['\r\n'], bom: true, revision: 0 };
function harness() {
  const posts: Envelope[] = [];
  const parent = document.createElement('main'); document.body.append(parent);
  const transport = createTransport(parent, identity, e => posts.push(e));
  let id = 0;
  const message = (type: string, payload: unknown, extra = {}) => ({ v: 1, ...identity, id: `n${++id}`, type, payload, ...extra });
  const load = () => transport.receive(message('load', { snapshot: initial, mode: 'source', selection: { anchor: 0, head: 0 }, assetBase: 'ret-resource://doc/', appearance: 'light', zoom: 1 }));
  return { posts, transport, message, load };
}
afterEach(() => document.body.replaceChildren());
describe('structured v1 native transport with real CM view', () => {
  it('posts ready, loads once, emits/retains ordered commits and returns a committed barrier reply', async () => {
    const h = harness(); await Promise.resolve(); expect(h.posts[0]).toMatchObject({ ...identity, v: 1, type: 'ready', payload: {} });
    expect(await h.load()).toMatchObject({ type: 'loaded', replyTo: 'n1', payload: { revision: 0 } });
    const view = h.transport.session!.view!;
    view.dispatch({ changes: { from: 1, insert: '!' }, userEvent: 'input.type' });
    const commit = h.posts.find(e => e.type === 'commit')!;
    expect(commit.payload).toMatchObject({ base: 0, revision: 1 });
    expect(h.transport.session!.pendingCommits()).toHaveLength(1);
    await h.transport.receive(h.message('ack', { revision: 1 }, { replyTo: commit.id }));
    expect(h.transport.session!.pendingCommits()).toEqual([]);
    const barrier = await h.transport.receive(h.message('barrier', { purpose: 'save' }));
    expect(barrier).toMatchObject({ type: 'snapshot', payload: { snapshot: { ...initial, text: 'a!\nb', revision: 1 }, composing: false } });
    expect(await h.load()).toMatchObject({ type: 'error' });
    expect(h.transport.session!.view).toBe(view); h.transport.destroy();
  });
  it('deduplicates native mutations and rejects reused IDs, wrong identities and malformed envelopes', async () => {
    const h = harness(); await h.load();
    const e = h.message('applyPatches', { base: 0, patches: [{ from: 0, to: 1, insert: 'x', eols: [] }], reason: 'assets' });
    const first = await h.transport.receive(e);
    expect(await h.transport.receive(e)).toEqual(first);
    expect(h.transport.session!.snapshot().revision).toBe(1);
    expect(await h.transport.receive({ ...e, payload: { ...e.payload as object, base: 1 } })).toMatchObject({ type: 'error' });
    expect(await h.transport.receive({ ...h.message('barrier', { purpose: 'save' }), sessionID: 'other' })).toMatchObject({ type: 'error' });
    expect(await h.transport.receive({ ...h.message('barrier', { purpose: 'save' }), v: 2 })).toMatchObject({ type: 'error' });
    expect(await h.transport.receive(h.message('command', { name: 'eval', args: 'bad()' }))).toMatchObject({ type: 'error' });
    h.transport.destroy();
  });
  it('keeps provisional DOM session text out of snapshot replies and preserves focused view across settings', async () => {
    const h = harness(); await h.load(); const session = h.transport.session!; const view = session.view!;
    view.focus(); session.beginComposition();
    view.dispatch({ changes: { from: 1, insert: '拼' }, userEvent: 'input.type.compose.start' });
    const reply = await h.transport.receive(h.message('barrier', { purpose: 'close' }));
    expect(reply).toMatchObject({ type: 'snapshot', payload: { snapshot: initial, composing: true } });
    session.endComposition();
    for (const [name, args] of [['setMode', { mode: 'live' }], ['setAppearance', { appearance: 'dark' }], ['setZoom', { zoom: 1.25 }]] as const)
      await h.transport.receive(h.message('command', { name, args }));
    expect(session.view).toBe(view); expect(document.activeElement).toBe(view.contentDOM);
    h.transport.destroy();
  });
  it('waits for native rich clipboard result and freezes on a commit gap without stale reload', async () => {
    const h = harness(); await h.load(); const session = h.transport.session!;
    session.dispatch({ selection: { anchor: 0, head: 1 } });
    const copying = h.transport.receive(h.message('command', { name: 'copyRich' }));
    await Promise.resolve();
    const write = h.posts.find(e => e.type === 'clipboardWrite')!;
    expect(write.payload).toMatchObject({ text: 'a' });
    await h.transport.receive(h.message('result', { ok: true }, { replyTo: write.id }));
    expect(await copying).toMatchObject({ type: 'result', payload: { ok: true } });
    session.edit([{ from: 0, to: 1, insert: 'new', eols: [] }]);
    const resync = await h.transport.receive(h.message('resyncRequired', { expected: 0 }));
    expect(session.snapshot().text).toBe('new\nb'); expect(session.pendingCommits()).toHaveLength(1);
    expect(resync).toMatchObject({ type: 'snapshot', payload: { snapshot: { text: 'new\nb', revision: 1 } } });
    h.transport.destroy();
  });
});

it('replaces opaque asset capabilities without source changes and defers live redraw through preedit', async () => {
  const h = harness(); await h.load();
  const options: import('../src/editor/live-contract').LiveOptions[] = [];
  h.transport.installLiveExtensions(o => { options.push(o); return []; });
  expect(options.at(-1)!.resolveImage('space%20name.png')).toBeNull();
  const assets = { 'space name.png': 'ret-resource://asset/123' };
  expect(await h.transport.receive(h.message('command', { name: 'setAssets', args: { assets } }))).toMatchObject({ type: 'result', payload: { ok: true } });
  expect(options.at(-1)!.resolveImage('space%20name.png')).toBe('ret-resource://asset/123');
  expect(options.at(-1)!.resolveImage('https://example.com/image.png')).toBeNull();
  expect(h.transport.session!.snapshot()).toEqual(initial);
  h.transport.session!.beginComposition(); const count = options.length;
  await h.transport.receive(h.message('command', { name: 'setAssets', args: { assets: {} } }));
  expect(options).toHaveLength(count); h.transport.session!.endComposition();
  expect(options).toHaveLength(count + 1);
  expect(options.at(-1)!.resolveImage('space name.png')).toBeNull();
  h.transport.destroy();
});

it('uses the 16px screen base at 100% and scales to 20px at 125%', async () => {
  const h = harness(); await h.load(); const dom = h.transport.session!.view!.dom;
  expect(getComputedStyle(dom).fontSize).toBe('16px');
  await h.transport.receive(h.message('command', { name: 'setZoom', args: { zoom: 1.25 } }));
  expect(getComputedStyle(dom).fontSize).toBe('20px');
  expect(h.transport.session!.snapshot()).toEqual(initial); h.transport.destroy();
});

it('S4 resolves literal percent and space files by exact renderer-decoded identity before and after refresh', async () => {
  const h = harness(); const options: import('../src/editor/live-contract').LiveOptions[] = [];
  h.transport.installLiveExtensions(o => { options.push(o); return []; });
  const assets = { 'a%20b.png': 'ret-resource://asset/literal-percent', 'a b.png': 'ret-resource://asset/space', 'a%2520b.png': 'ret-resource://asset/literal-percent' };
  await h.transport.receive(h.message('load', { snapshot: { text: '', eols: [], bom: false, revision: 0 }, mode: 'source', selection: { anchor: 0, head: 0 }, assetBase: '', assets, appearance: 'light', zoom: 1 }));
  await h.transport.receive(h.message('command', { name: 'insertImage', args: { destinations: ['a%2520b.png', 'a%20b.png'], alt: '' } }));
  const { renderMarkdown } = await import('../src/render/markdown');
  const s = h.transport.session!, before = s.snapshot();
  expect(before.text).toBe('![](<a%2520b.png>)\n![](<a%20b.png>)');
  const render = () => renderMarkdown(s.snapshot().text, { resolveImage: options.at(-1)!.resolveImage }).html;
  expect(render().match(/<img src="[^"]+"/g)).toEqual(['<img src="ret-resource://asset/literal-percent"', '<img src="ret-resource://asset/space"']);
  await h.transport.receive(h.message('command', { name: 'setAssets', args: { assets: { 'a%20b.png': 'ret-resource://asset/new-percent', 'a b.png': 'ret-resource://asset/new-space' } } }));
  expect(render().match(/<img src="[^"]+"/g)).toEqual(['<img src="ret-resource://asset/new-percent"', '<img src="ret-resource://asset/new-space"']);
  expect(s.snapshot()).toEqual(before); h.transport.destroy();
});
