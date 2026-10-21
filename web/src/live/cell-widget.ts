import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, WidgetType } from '@codemirror/view';
import { defaultKeymap, undo, redo } from '@codemirror/commands';
import { getSearchQuery } from '@codemirror/search';
import type { LiveOptions } from '../editor/live-contract';
import { applyPatches } from '../editor/source';
import { renderTableCells, type RenderResult } from '../render/markdown';
import { cellPosition, parseTable, tablePatches, tableTab, type Table, type TableAction } from './tables';
import { cellOffset, observeTable, tableHitField, tableHits } from './table-interactions';
import { mathHitOffset } from './math-hit';

const controllers = new WeakMap<HTMLElement, TableController>();
interface CellEditor { host:HTMLElement; row:number; column:number; view?:EditorView; syncing:boolean; composing:boolean }

export class TableWidget extends WidgetType {
  constructor(readonly table:Table,readonly raw:string,readonly options:LiveOptions,readonly documentText:string) {super();}
  eq(other:TableWidget):boolean {return this.options===other.options && this.documentText===other.documentText && this.table.from===other.table.from && this.raw===other.raw;}
  toDOM(parent:EditorView):HTMLElement {
    const controller=new TableController(parent,this.table,this.options,this.documentText);
    controllers.set(controller.dom,controller); return controller.dom;
  }
  updateDOM(dom:HTMLElement):boolean {
    const controller=controllers.get(dom); if(!controller) return false;
    controller.update(this.table,this.documentText); return true;
  }
  destroy(dom:HTMLElement):void {controllers.get(dom)?.destroy();controllers.delete(dom);}
  ignoreEvent():boolean {return true;}
}

/** Only the active cell owns a mini-view. Its document is never a second undo stack. */
class TableController {
  readonly dom=document.createElement('div');
  private readonly grid=document.createElement('table');
  private cells:CellEditor[]=[];
  private menu?:HTMLElement;
  private closeMenu?:()=>void;
  private unobserve:()=>void;
  private guidance?:HTMLElement;
  private deferred:TableAction[]=[];
  private dead=false;
  private exitPosition=-1;
  private rendered:RenderResult[][];
  constructor(private parent:EditorView,private table:Table,private options:LiveOptions,documentText:string) {
    this.rendered=renderTableCells(documentText,table.from,{resolveImage:options.resolveImage});
    this.dom.className='cm-live-table'; this.dom.contentEditable='false';
    this.grid.setAttribute('aria-label','Editable Markdown table');this.dom.append(this.grid);this.build();
    this.unobserve=observeTable(parent,()=>this.projectSelection());
  }
  private build():void {
    this.closeMenu?.();
    this.cells.forEach(c=>c.view?.destroy());this.cells=[];this.grid.replaceChildren();
    this.table.rows.forEach((row,r)=>{
      const tr=document.createElement('tr');this.grid.append(tr);
      row.cells.forEach((cell,c)=>{
        const host=document.createElement(r===0?'th':'td');host.dataset.liveCell=`${r}:${c}`;
        host.style.textAlign=this.table.alignments[c] ?? '';
        host.tabIndex=0;host.setAttribute('aria-label',`Row ${r+1}, column ${c+1}`);
        const entry:CellEditor={host,row:r,column:c,syncing:false,composing:false};
        this.cells.push(entry);this.paint(entry,cell.text);tr.append(host);
        host.addEventListener('mousedown',event=>this.mathMouseDown(entry,event));
        host.addEventListener('click',()=>this.focus(entry));
        host.addEventListener('focus',()=>this.focus(entry));
        host.addEventListener('contextmenu',event=>{event.preventDefault();this.context(entry,event);});
      });
    });
  }
  private paint(cell:CellEditor,_text:string):void {
    const html=this.rendered[cell.row][cell.column].html;
    cell.host.innerHTML=html || '<br>';
  }
  private mathMouseDown(cell:CellEditor,event:MouseEvent):void {
    if(this.dead || event.defaultPrevented) return;
    // Native host focus would end the marked mini-view's ownership before click.
    if(this.options.composition().composing || this.cells.some(c=>c.composing)) {
      if(!cell.view?.hasFocus) event.preventDefault();
      return;
    }
    if(event.button!==0 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || this.parent.state.readOnly || cell.view) return;
    const wrapper=event.target instanceof Element ? event.target.closest<HTMLElement>('[data-math-from][data-math-to]') : null;
    if(!wrapper || !cell.host.contains(wrapper)) return;
    const from=Number(wrapper.dataset.mathFrom),to=Number(wrapper.dataset.mathTo);
    const c=this.table.rows[cell.row].cells[cell.column],source=this.options.getSource().text;
    if(!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<c.from || to>c.to || to<=from || to>source.length) return;
    const offset=mathHitOffset(wrapper,source.slice(from,to),false,event.clientX,event.clientY);
    if(offset===null || !Number.isSafeInteger(offset) || offset<0 || offset>to-from) return;
    // Resolve against the original raw range before focus destroys rendered math.
    // cellOffset also removes table pipe escapes from the mini-view coordinate.
    const local=cellOffset(c,from+offset,-1);
    event.preventDefault();this.focus(cell,true,local);
  }
  update(table:Table,documentText:string):void {
    const shape=table.rows.length!==this.table.rows.length || table.rows[0].cells.length!==this.table.rows[0].cells.length;
    this.table=table;
    if(this.cells.some(c=>c.composing)) return;
    this.rendered=renderTableCells(documentText,table.from,{resolveImage:this.options.resolveImage});
    if(shape) {this.build();return;}
    for(const cell of this.cells) {
      cell.host.style.textAlign=table.alignments[cell.column] ?? '';
      const text=table.rows[cell.row].cells[cell.column].text;
      if(cell.view) {
        if(cell.view.state.doc.toString()!==text) {
          cell.syncing=true;
          cell.view.dispatch({changes:{from:0,to:cell.view.state.doc.length,insert:text},selection:{anchor:Math.min(cell.view.state.selection.main.head,text.length)},annotations:Transaction.addToHistory.of(false)});
          cell.syncing=false;
        }
      } else this.paint(cell,text);
    }
  }
  /** Root search keeps ownership of focus and history; only the mini projection changes. */
  private projectSelection():void {
    if(this.dead || this.options.composition().composing || this.cells.some(c=>c.composing)) return;
    const state=this.parent.state,selection=state.selection.main,query=getSearchQuery(state);
    if(!selection.empty||selection.head!==this.exitPosition) this.exitPosition=-1;
    const matches:{from:number;to:number}[]=[];
    if(query.valid) {
      const cursor=query.getCursor(state,this.table.from,this.table.to);
      for(let next=cursor.next();!next.done;next=cursor.next()) matches.push(next.value);
    }
    const selected=this.cells.find(entry=>{
      const c=this.table.rows[entry.row].cells[entry.column];
      return (!selection.empty||this.parent.hasFocus&&selection.head!==this.exitPosition)
        && selection.from>=c.from && selection.to<=c.to;
    });
    if(selected) this.focus(selected,false);
    for(const cell of this.cells) {
      const c=this.table.rows[cell.row].cells[cell.column];
      const hits=matches.filter(r=>r.from<c.to && r.to>c.from).map(r=>({from:cellOffset(c,Math.max(c.from,r.from),-1),to:cellOffset(c,Math.min(c.to,r.to),1)}));
      cell.host.toggleAttribute('data-table-match',hits.length>0);
      if(!cell.view) continue;
      // A projected caret/search range or actual mini focus owns editing.
      // Once both leave, repaint immediately rather than retaining raw TeX
      // until a later cell activation happens to destroy this mini-view.
      if(cell!==selected && !cell.view.hasFocus && !this.menu?.contains(document.activeElement)) {
        cell.view.destroy();cell.view=undefined;this.paint(cell,c.text);continue;
      }
      const local=cell===selected ? {
        anchor:cellOffset(c,selection.anchor,selection.anchor>selection.head?1:-1),
        head:cellOffset(c,selection.head,selection.head>selection.anchor?1:-1),
      } : undefined;
      cell.syncing=true;
      try {cell.view.dispatch({selection:local,effects:tableHits.of(hits),annotations:Transaction.addToHistory.of(false)});}
      finally {cell.syncing=false;}
    }
    // Collapsing an expanded source selection may recreate this widget. Its
    // root caret is inside replaced DOM, so hand keyboard input to the mapped
    // mini caret after setting its selection. Search-panel focus stays owned.
    if(selected && selection.empty && this.parent.hasFocus) selected.view?.focus();
  }
  private focus(cell:CellEditor,takeFocus=true,offset?:number):void {
    if(this.dead || (this.options.composition().composing || this.cells.some(c=>c.composing)) && !cell.composing) return;
    if(takeFocus) this.exitPosition=-1;
    if(!cell.view) {
      for(const other of this.cells) if(other!==cell && other.view && !other.composing) {
        other.view.destroy();other.view=undefined;this.paint(other,this.table.rows[other.row].cells[other.column].text);
      }
      cell.host.replaceChildren();
      const text=this.table.rows[cell.row].cells[cell.column].text;
      cell.view=new EditorView({parent:cell.host,state:EditorState.create({doc:text,extensions:[
        EditorView.lineWrapping,
        tableHitField,
        EditorView.contentAttributes.of({'aria-label':cell.host.getAttribute('aria-label')!}),
        keymap.of([
          {key:'Tab',run:()=>this.navigate(cell,false)}, {key:'Shift-Tab',run:()=>this.navigate(cell,true)},
          {key:'Mod-z',run:()=>this.history(cell,false)}, {key:'Mod-Shift-z',run:()=>this.history(cell,true)}, {key:'Mod-y',run:()=>this.history(cell,true)},
          {key:'Escape',run:()=>{this.exit(this.table.to);return true;}},
          {key:'Enter',run:()=>{this.reject('\n');return true;}},
          {key:'Mod-/',run:()=>{this.parent.contentDOM.dispatchEvent(new KeyboardEvent('keydown',{key:'/',code:'Slash',metaKey:true,bubbles:true,cancelable:true}));return true;}},
          ...defaultKeymap,
        ]),
        EditorState.transactionFilter.of(tr=>{
          if(tr.docChanged && /[\n\r]/.test(tr.newDoc.toString())) {this.reject(tr.newDoc.toString());return [];}
          return tr;
        }),
        EditorView.updateListener.of(update=>{
          if(cell.syncing) return;
          if(update.docChanged) this.commit(cell);
          else if(update.selectionSet && !cell.composing) this.mirrorSelection(cell);
        }),
        EditorView.domEventHandlers({
          blur:()=>{
            // Observe the completed focus handoff, including focus moving to
            // a non-editor control, which produces no root transaction.
            queueMicrotask(()=>this.projectSelection());return false;
          },
          compositionstart:()=>{
            cell.composing=true;this.mirrorSelection(cell);
            // The session recognizes this annotation and opens its composition barrier.
            // Do not send compositionstart to the root DOM: the native marked node
            // belongs to the mini-view, not to the root's block replacement tile.
            this.parent.dispatch({userEvent:'input.type.compose',annotations:Transaction.addToHistory.of(false)});return false;
          },
          compositionend:()=>{
            this.parent.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
            // Final DOM mutations are observed by the mini-view in this event turn.
            // Root preedit already contains every local patch; its barrier commits once
            // before queued undo/mode commands. Never race a later apply against them.
            setTimeout(()=>{
              cell.composing=false;
              if(this.dead) return;
              // Root refresh can run while the mini composition flag still
              // protects marked DOM. Rebuild that skipped cache before the
              // first static repaint, not in a later root refresh.
              this.update(this.table,this.options.getSource().text);
              for(const action of this.deferred.splice(0)) this.run(action);
              this.projectSelection();
            },0);return false;
          },
          copy:event=>this.clipboard(cell,event,false),
          cut:event=>this.clipboard(cell,event,true),
          paste:event=>{
            const text=event.clipboardData?.getData('text/plain');if(text===undefined) return false;
            event.preventDefault();
            if(/[\n\r]/.test(text)) this.reject(text);
            else cell.view!.dispatch(cell.view!.state.replaceSelection(text));
            return true;
          },
        }),
      ]})});
    }
    if(offset!==undefined) {
      // Install the target locally before focusing/mirroring. A root dispatch at
      // the mini-view's initial zero caret can rebuild the widget and race focus.
      cell.syncing=true;
      try {cell.view.dispatch({selection:{anchor:offset},annotations:Transaction.addToHistory.of(false)});}
      finally {cell.syncing=false;}
    }
    if(takeFocus) {cell.view.focus();this.mirrorSelection(cell);}
  }
  private clipboard(cell:CellEditor,event:ClipboardEvent,cut:boolean):boolean {
    if(cut && (cell.composing || this.options.composition().composing || this.parent.state.readOnly)) {
      event.preventDefault();return true;
    }
    const selection=cell.view!.state.selection.main;
    if(selection.empty) return false;
    const c=this.table.rows[cell.row].cells[cell.column];
    const raw=this.options.getSource().text.slice(cellPosition(c,selection.from),cellPosition(c,selection.to));
    event.preventDefault();
    if(!event.clipboardData) return true; // Never delete if the source payload cannot be written.
    event.clipboardData.setData('text/plain',raw);
    if(cut) cell.view!.dispatch({...cell.view!.state.replaceSelection(''),userEvent:'delete.cut'});
    return true;
  }
  private mirrorSelection(cell:CellEditor):void {
    if(!cell.view || this.dead) return;
    const c=this.table.rows[cell.row]?.cells[cell.column];if(!c) return;
    const {anchor,head}=cell.view.state.selection.main;
    this.parent.dispatch({selection:{anchor:cellPosition(c,anchor),head:cellPosition(c,head)},annotations:Transaction.addToHistory.of(false)});
  }
  private commit(cell:CellEditor):void {this.commitText(cell,cell.view!.state.doc.toString());}
  private commitText(cell:CellEditor,text:string):void {
    try {
      const source=this.options.getSource();
      // Table positions are updated on every parent transaction before any later input.
      const patches=tablePatches(source,this.table,{type:'editCell',row:cell.row,column:cell.column,text});
      const c=this.table.rows[cell.row].cells[cell.column];
      const head=cell.view?.state.selection.main.head ?? text.length;
      const at=c.from+text.slice(0,head).replace(/\|/g,'\\|').length;
      if(patches.length) {
        const candidate=applyPatches(source,patches);
        const nextTable=parseTable(candidate.text,{from:this.table.from,to:this.table.to+candidate.text.length-source.text.length});
        if(!nextTable) throw new Error('Cell input is not a valid table; use source mode. Input retained.');
        if(cell.composing) {
          // apply() deliberately rejects composition. Project provisional local changes
          // through the root CM dispatcher, exactly like root typing, so sourceHistory
          // and the root composition barrier remain the sole history/commit owner.
          this.parent.dispatch({changes:patches.map(p=>({from:p.from,to:p.to,insert:p.insert})),
            selection:{anchor:at,head:at},userEvent:'input.type.compose'});
          this.table=nextTable;
        } else this.options.apply(patches,{selection:{anchor:at,head:at},userEvent:'input.table'});
      }
    } catch(error) {this.reject(text,error instanceof Error?error.message:String(error));}
  }
  private navigate(cell:CellEditor,backwards:boolean):boolean {
    if(cell.composing || this.options.composition().composing) return true;
    const next=tableTab(cell.row,cell.column,this.table.rows.length,this.table.rows[0].cells.length,backwards);
    if('exit' in next) this.exit(next.exit==='before'?this.table.from:this.table.to);
    else this.focus(this.cells.find(c=>c.row===next.row && c.column===next.column)!);
    return true;
  }
  private exit(at:number):void {
    // Optional edge pipes can make a cell endpoint equal the table endpoint.
    // Preserve explicit Tab/Escape exit instead of handing focus straight back.
    this.exitPosition=at;
    this.parent.dispatch({selection:{anchor:at},annotations:Transaction.addToHistory.of(false)});this.parent.focus();
  }
  private history(cell:CellEditor,forward:boolean):boolean {
    if(cell.composing || this.options.composition().composing) return true;
    (forward?redo:undo)(this.parent);return true;
  }
  private reject(text:string,message='Multiline cells require source mode. Your input is retained here for copying.'):void {
    this.guidance?.remove();this.guidance=document.createElement('div');this.guidance.className='cm-live-guidance';
    this.guidance.setAttribute('role','alert');const label=document.createElement('p');label.textContent=message;
    const retained=document.createElement('textarea');retained.className='cm-live-rejected-input';retained.value=text;
    retained.setAttribute('aria-label','Retained input — copy into source mode');
    this.guidance.append(label,retained);this.dom.append(this.guidance);
  }
  private context(cell:CellEditor,event:MouseEvent):void {
    this.closeMenu?.();const menu=document.createElement('div');this.menu=menu;
    menu.className='cm-live-menu';menu.setAttribute('role','menu');
    const choices:[string,TableAction][]=[
      ['Insert row above',{type:'insertRow',row:Math.max(1,cell.row)}], ['Insert row below',{type:'insertRow',row:cell.row+1}],
      ['Delete row',{type:'deleteRow',row:cell.row}], ['Insert column left',{type:'insertColumn',column:cell.column}],
      ['Insert column right',{type:'insertColumn',column:cell.column+1}], ['Delete column',{type:'deleteColumn',column:cell.column}],
    ];
    for(const [label,action] of choices) {
      const button=document.createElement('button');button.textContent=label;button.setAttribute('role','menuitem');
      button.addEventListener('mousedown',e=>e.preventDefault());
      button.tabIndex=-1;
      button.addEventListener('click',()=>{this.closeMenu?.();this.run(action);});menu.append(button);
    }
    const dismiss=()=>this.closeMenu?.();
    const outside=(e:Event)=>{if(e.target instanceof Node && !menu.contains(e.target)) dismiss();};
    const keydown=(e:KeyboardEvent)=>{
      if(e.key==='Escape') {e.preventDefault();e.stopPropagation();dismiss();this.focus(cell);return;}
      if(e.key==='Tab') {e.preventDefault();e.stopPropagation();dismiss();this.focus(cell);return;}
      const buttons=Array.from(menu.querySelectorAll('button'));
      const at=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=e.key==='ArrowDown'?(at+1)%buttons.length:e.key==='ArrowUp'?(at+buttons.length-1)%buttons.length:e.key==='Home'?0:e.key==='End'?buttons.length-1:-1;
      if(next>=0) {e.preventDefault();buttons[next].focus();}
    };
    this.closeMenu=()=>{
      document.removeEventListener('pointerdown',outside,true);
      document.removeEventListener('focusin',outside,true);
      document.removeEventListener('keydown',keydown,true);
      window.removeEventListener('resize',dismiss);
      window.removeEventListener('blur',dismiss);
      this.parent.scrollDOM.removeEventListener('scroll',dismiss);
      menu.remove();this.menu=undefined;this.closeMenu=undefined;
      queueMicrotask(()=>this.projectSelection());
    };
    // Sibling of the root scroller: no table layout contribution or horizontal clipping.
    this.parent.dom.append(menu);
    const rect=menu.getBoundingClientRect(),cellRect=cell.host.getBoundingClientRect();
    menu.style.left=`${Math.max(8,Math.min(event.clientX||cellRect.left,window.innerWidth-rect.width-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(event.clientY||cellRect.bottom,window.innerHeight-rect.height-8))}px`;
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('focusin',outside,true);
    document.addEventListener('keydown',keydown,true);
    window.addEventListener('resize',dismiss);
    window.addEventListener('blur',dismiss);
    this.parent.scrollDOM.addEventListener('scroll',dismiss);
    menu.querySelector('button')!.focus();
  }
  private run(action:TableAction):void {
    if(this.cells.some(c=>c.composing)||this.options.composition().composing) {this.deferred.push(action);return;}
    try {
      const patches=tablePatches(this.options.getSource(),this.table,action);
      this.options.apply(patches,{selection:{anchor:this.table.from,head:this.table.from},userEvent:'input.table.structure'});
      if(this.parent.dom.isConnected) this.parent.focus();
    } catch(error) {this.reject('',error instanceof Error?error.message:String(error));}
  }
  destroy():void {
    const focused=this.cells.some(c=>c.view?.hasFocus) || !!this.menu?.contains(document.activeElement);
    this.dead=true;this.unobserve();this.closeMenu?.();this.cells.forEach(c=>c.view?.destroy());
    if(focused) queueMicrotask(()=>{if(this.parent.dom.isConnected) this.parent.focus();});
  }
}
