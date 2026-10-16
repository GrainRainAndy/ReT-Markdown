import './final-live-browser-harness';
import {renderMarkdown} from '../src/render/markdown';
const api=window as any;
api.projectionReference=()=>{
 document.querySelector('#reference')?.remove();
 const host=document.createElement('section');host.id='reference';host.className='markdown-body';
 host.innerHTML=renderMarkdown(api.nativeTransport.session.snapshot().text).html;document.body.append(host);
};
