import './live-browser-harness';
import { EditorView } from '@codemirror/view';
import { getSearchQuery, setSearchQuery, SearchQuery, findNext, findPrevious, openSearchPanel } from '@codemirror/search';
const api=window as any;
api.tableFind=(query:string)=>{const s=api.session; s.dispatch({effects:setSearchQuery.of(new SearchQuery({search:query,literal:true}))});return findNext(s.view);};
api.tablePrevious=()=>findPrevious(api.session.view);
api.tablePanel=()=>openSearchPanel(api.session.view);
api.tableState=()=>({snapshot:api.session.snapshot(),selection:api.session.selection(),status:api.session.status(),query:getSearchQuery(api.session.state).search,commits:api.commits.length});
api.cellSelection=(cell:string)=>{const element=document.querySelector(`[data-live-cell="${cell}"] .cm-content`);const view=element&&EditorView.findFromDOM(element as HTMLElement);return view?{anchor:view.state.selection.main.anchor,head:view.state.selection.main.head,text:view.state.doc.sliceString(view.state.selection.main.from,view.state.selection.main.to)}:null;};
api.tableCompose=()=>{
 const mini=EditorView.findFromDOM(document.querySelector('[data-live-cell="1:0"] .cm-content') as HTMLElement)!;
 api.markedMini=mini;api.markedDOM=mini.contentDOM;
 mini.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
 mini.dispatch({changes:{from:mini.state.doc.length,insert:'中'},selection:{anchor:mini.state.doc.length+1},userEvent:'input.type.compose'});
};
api.tableEndCompose=()=>api.markedMini.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
