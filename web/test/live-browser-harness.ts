import { createSession } from '../src/editor/session';
import { renderMarkdown } from '../src/render/markdown';
import { decodeSource, encodeSource } from '../src/editor/source';
import { liveExtensions } from '../src/live/decorations';
import type { Commit } from '../src/protocol';
const api = window as any;
api.boot = (text:string) => {
  api.session?.destroy(); document.body.innerHTML='<main id="editor" class="markdown-body"></main>';
  api.commits=[] as Commit[];
  api.session=createSession({...decodeSource(new TextEncoder().encode(text)),revision:0}, c=>api.commits.push(c),{liveExtensions});
  api.session.attach(document.querySelector('#editor')!);
  api.session.setMode('live');
  api.session.dispatch({selection:{anchor:api.session.state.doc.length}});
};
api.select = (anchor:number,head=anchor) => {api.session.dispatch({selection:{anchor,head}});api.session.view.focus();};
api.snapshot = () => api.session.snapshot();
api.command = (name:string,args?:unknown) => api.session.command(name,args);

api.render = renderMarkdown;
api.bytes = () => Array.from(encodeSource(api.session.snapshot()));
