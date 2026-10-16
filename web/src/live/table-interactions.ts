import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import type { LiveOptions } from '../editor/live-contract';
import type { Cell } from './tables';

const tables=new WeakMap<EditorView,Set<()=>void>>();
/** Widget lifecycle registration; callbacks never dispatch into the root. */
export function observeTable(view:EditorView,refresh:()=>void):()=>void {
  let listeners=tables.get(view);
  if(!listeners) tables.set(view,listeners=new Set());
  listeners.add(refresh);
  queueMicrotask(()=>{if(listeners.has(refresh)) refresh();});
  return ()=>{listeners.delete(refresh);};
}

/** Inverse raw UTF-16 map. A partial escaped pipe selects its visible pipe. */
export function cellOffset(cell:Cell,position:number,side:-1|1):number {
  let low=0,high=cell.offsets.length;
  while(low<high) {const mid=(low+high)>>>1;if(cell.offsets[mid]<position) low=mid+1;else high=mid;}
  let at=Math.min(cell.text.length,low);
  if(side<0 && at>0 && cell.offsets[at]>position) at--;
  // Never create a mini selection boundary inside an astral character.
  if(at>0 && at<cell.text.length && /[\uD800-\uDBFF]/.test(cell.text[at-1]) && /[\uDC00-\uDFFF]/.test(cell.text[at])) at+=side;
  return at;
}

export const tableHits=StateEffect.define<readonly {from:number;to:number}[]>();
export const tableHitField=StateField.define<DecorationSet>({
  create:()=>Decoration.none,
  update:(value,tr)=>{
    value=value.map(tr.changes);
    for(const effect of tr.effects) if(effect.is(tableHits)) value=Decoration.set(effect.value.filter(r=>r.to>r.from).map(r=>Decoration.mark({class:'cm-table-search-hit'}).range(r.from,r.to)),true);
    return value;
  },
  provide:field=>EditorView.decorations.from(field),
});

/** Install with the live factory. Defer until CM finishes updating replacement DOM. */
export function tableInteractions(options:LiveOptions):Extension {
  return [ViewPlugin.fromClass(class {
    private pending=false;
    private dead=false;
    constructor(readonly view:EditorView) {this.update();}
    update():void {
      if(this.pending) return;
      this.pending=true;
      queueMicrotask(()=>{
        this.pending=false;
        if(this.dead || options.getMode()!=='live' || options.composition().composing) return;
        tables.get(this.view)?.forEach(refresh=>refresh());
      });
    }
    destroy():void {this.dead=true;}
  }),EditorView.baseTheme({
    '.cm-live-table [data-table-match]':{boxShadow:'inset 0 0 0 2px var(--link, #4183c4)'},
    '.cm-live-table .cm-table-search-hit':{backgroundColor:'#ffe08a',color:'#24292f',borderRadius:'2px'},
    '.cm-live-menu':{position:'fixed',zIndex:'1000',display:'flex',flexDirection:'column',flexWrap:'nowrap',gap:'2px',margin:'0',padding:'4px',maxWidth:'calc(100vw - 16px)',maxHeight:'calc(100vh - 16px)',overflowY:'auto',border:'1px solid var(--border, #dfe2e5)',borderRadius:'6px',backgroundColor:'var(--body-bg, #fff)',color:'var(--body-fg, #24292f)',boxShadow:'0 4px 16px #0003'},
    '.cm-live-menu button':{font:'inherit',color:'inherit',backgroundColor:'transparent',textAlign:'left',whiteSpace:'nowrap',border:'0',borderRadius:'3px',padding:'5px 12px'},
    '.cm-live-menu button:focus':{outline:'2px solid var(--link, #4183c4)',outlineOffset:'-2px'},
  })];
}
