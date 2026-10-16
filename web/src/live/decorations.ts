import { StateEffect, StateField, type EditorState, type Range as CMRange, type RangeSet } from '@codemirror/state';
import { BlockWrapper, Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { LiveExtensionFactory, LiveOptions } from '../editor/live-contract';
import { renderMarkdown, renderInlineContexts, type InlineContextResult } from '../render/markdown';
import { indexedContains, isActive, syntaxSpans, type SyntaxSpan } from './syntax';
import { parseTable } from './tables';
import { TableWidget } from './cell-widget';
import { tableInteractions } from './table-interactions';

const refresh=StateEffect.define<null>();
class RenderWidget extends WidgetType {
  constructor(readonly span:SyntaxSpan,readonly source:string,readonly options:LiveOptions,readonly rendered?:string) {super();}
  eq(other:RenderWidget):boolean {return this.options===other.options && this.source===other.source && this.rendered===other.rendered && this.span.from===other.span.from;}
  toDOM(view:EditorView):HTMLElement {
    const dom=document.createElement(this.span.block||this.span.kind==='rule'?'div':'span');dom.className=`cm-live-${this.span.kind}${this.span.display?' cm-live-math-block':''}`;
    dom.innerHTML=this.rendered??renderMarkdown(this.source,{resolveImage:this.options.resolveImage}).html;
    dom.setAttribute('aria-label',`${this.span.kind}: ${this.source}`);dom.tabIndex=0;
    const reveal=()=>{view.dispatch({selection:{anchor:Math.min(this.span.to,this.span.from+1)}});view.focus();};
    dom.addEventListener('click',reveal);dom.addEventListener('keydown',e=>{if((e as KeyboardEvent).key==='Enter') reveal();});
    return dom;
  }
  ignoreEvent():boolean {return true;}
}

class PrefixWidget extends WidgetType {
  constructor(readonly label:string,readonly kind:string) {super();}
  eq(other:PrefixWidget):boolean {return this.label===other.label && this.kind===other.kind;}
  toDOM():HTMLElement {
    const dom=document.createElement('span');dom.className=`cm-live-${this.kind}-marker`;
    dom.textContent=this.label;return dom;
  }
  ignoreEvent():boolean {return false;}
}

class LiteralWidget extends WidgetType {
  constructor(readonly span:SyntaxSpan,readonly html:string) {super();}
  eq(other:LiteralWidget):boolean {return this.span.from===other.span.from&&this.span.to===other.span.to&&this.html===other.html;}
  toDOM(view:EditorView):HTMLElement {
    const dom=document.createElement('span');dom.className=`cm-live-${this.span.kind}`;dom.innerHTML=this.html;
    dom.tabIndex=0;dom.setAttribute('aria-label',`Reveal ${this.span.kind} source`);
    const reveal=(at:number)=>{view.dispatch({selection:{anchor:at}});view.focus();};
    dom.addEventListener('click',event=>{const box=dom.getBoundingClientRect();reveal(event.clientX<box.x+box.width/2?this.span.from:this.span.to);});
    dom.addEventListener('keydown',event=>{if(event.key==='Enter') {event.preventDefault();reveal(this.span.from);}});
    return dom;
  }
  ignoreEvent():boolean {return true;}
}
interface Projection {decorations:DecorationSet;wrappers:RangeSet<BlockWrapper>}
const emptyProjection:Projection={decorations:Decoration.none,wrappers:BlockWrapper.set([])};

function project(state:EditorState,options:LiveOptions,spans:readonly SyntaxSpan[],contexts:ReadonlyMap<SyntaxSpan,InlineContextResult>):Projection {
  if(options.getMode()!=='live') return emptyProjection;
  const text=state.doc.toString(),selection=state.selection.ranges,composition=options.composition().range;
  const items:CMRange<Decoration>[]=[],wrappers:CMRange<BlockWrapper>[]=[];
  const activeQuote=indexedContains(spans.filter(q=>q.kind==='quote'&&isActive(q,selection,composition)));
  const gaps=spans.filter(span=>span.kind==='gap'&&!isActive(span,selection,composition)&&!activeQuote(span));
  const hiddenGaps=new Set(gaps),coveredByGap=indexedContains(gaps);
  const wrap=(span:SyntaxSpan,classes:string,rank:number)=>{
    wrappers.push(BlockWrapper.create({tagName:'div',attributes:{class:classes},rank}).range(state.doc.lineAt(span.from).from,span.to));
  };
  const breaks=(span:SyntaxSpan)=>{for(const range of span.breaks??[]) items.push(Decoration.replace({widget:new PrefixWidget(' ','soft-break')}).range(range.from,range.to));};
  for(const span of spans) {
    if(span.kind==='gap') {
      // Keep the LF/CM line boundary: replacing it also swallows the next
      // line's decorations and can rebuild an adjacent focused table widget.
      if(hiddenGaps.has(span)) items.push(Decoration.line({class:'cm-live-gap'}).range(span.from));
      continue;
    }
    if(span.kind==='table') {
      const table=parseTable(text,span);
      // Cell mini-views can display only ranges contained in one content cell.
      // Keep separator syntax, pipes and cross-cell selections in the root DOM
      // so source-wide find results remain visible without changing the source.
      const reveal=table && selection.some(range=>(range.from===range.to
        ? range.from>table.from && range.from<table.to
        : range.from<table.to && range.to>table.from)
        && !table.rows.some(row=>row.cells.some(cell=>range.from>=cell.from && range.to<=cell.to)));
      if(table&&!reveal) items.push(Decoration.replace({widget:new TableWidget(table,text.slice(span.from,span.to),options,text),block:true}).range(span.from,span.to));
      continue;
    }
    const active=isActive(span,selection,composition);
    if(span.kind==='paragraph') {
      wrap(span,`cm-live-paragraph${span.quoted?' cm-live-quoted-paragraph':''}`,20);
      if(!active&&!activeQuote(span)) breaks(span);
      continue;
    }
    if(span.kind==='heading'&&span.setext) {
      wrap(span,`cm-live-heading cm-live-h${span.level} cm-live-setext-heading`,30);
      if(!active) {
        breaks(span);
        const mark=span.marks[0];
        // Join the hidden underline to the text line, rather than decorating a
        // second empty CM line with heading margins and a duplicate border.
        items.push(Decoration.replace({}).range(state.doc.lineAt(mark.from).from-1,mark.to));
      }
      continue;
    }
    if(span.kind==='quote') wrap(span,'cm-live-quote',90-(span.depth??0));
    if(['image','math','rule'].includes(span.kind)) {
      if(!active) items.push(Decoration.replace({widget:new RenderWidget(span,text.slice(span.from,span.to),options,contexts.get(span)?.html),block:span.block||span.kind==='rule'}).range(span.from,span.to));
      continue;
    }
    if(span.kind==='hard-break') {
      if(!active) for(const mark of span.marks) items.push(Decoration.replace({}).range(mark.from,mark.to));
      continue;
    }
    if(span.kind==='escape'||span.kind==='entity') {
      if(!active) items.push(Decoration.replace({widget:new LiteralWidget(span,renderMarkdown(text.slice(span.from,span.to)).html.replace(/^<p>([\s\S]*)<\/p>\n$/,'$1'))}).range(span.from,span.to));
      continue;
    }
    if(['heading','list','code'].includes(span.kind)) {
      let from=state.doc.lineAt(span.from).from;
      do {
        let classes=`cm-live-${span.kind}${span.level?` cm-live-h${span.level}`:''}`;
        if(span.kind==='code') {
          const first=from===state.doc.lineAt(span.from).from,last=state.doc.lineAt(from).to===span.to;
          if(first) classes+=' cm-live-code-first';if(last) classes+=' cm-live-code-last';
          if(!active&&(first||last&&text.slice(from,span.to).trim().match(/^(?:`{3,}|~{3,})$/))) classes+=' cm-live-code-delimiter';
        }
        items.push(Decoration.line({class:classes}).range(from));
        from=state.doc.lineAt(from).to+1;
      } while(from<span.to);
    } else if(span.kind!=='quote') {
      const href=span.kind==='link'?contexts.get(span)?.href:null;
      if(span.kind==='link'&&!href) continue;
      items.push(Decoration.mark({class:`cm-live-${span.kind}`,attributes:href?{'data-live-link':href,title:'Cmd-click to open link'}:undefined}).range(span.from,span.to));
    }
    if(!active) span.marks.forEach((mark,index)=>{
      if(coveredByGap(mark)) return;
      const label=span.labels?.[index];
      if(mark.to>mark.from) items.push(Decoration.replace({widget:label?new PrefixWidget(label,span.kind):undefined}).range(mark.from,mark.to));
    });
  }
  return {decorations:Decoration.set(items,true),wrappers:BlockWrapper.set(wrappers,true)};
}

/** Install once on the root session; mode is observed through the published adapter. */
export const liveExtensions:LiveExtensionFactory = options => {
  let document:EditorState['doc']|undefined,spans:SyntaxSpan[]=[];
  let contexts=new Map<SyntaxSpan,InlineContextResult>();
  const projectState=(state:EditorState)=>{
    if(options.getMode()!=='live') return emptyProjection;
    if(state.doc!==document) {
      document=state.doc;
      const text=document.toString();spans=syntaxSpans(text);
      const relevant=spans.filter(span=>['image','link','math'].includes(span.kind));
      const results=relevant.length?renderInlineContexts(text,relevant,{resolveImage:options.resolveImage}):[];
      contexts=new Map(relevant.map((span,i)=>[span,results[i]]));
    }
    return project(state,options,spans,contexts);
  };
  const field=StateField.define<Projection>({
    create:state=>projectState(state),
    update:(value,tr)=>{
      // Mapping existing decorations preserves the actual marked-text DOM. In particular
      // do not rebuild a replacement widget when its source changes provisionally.
      if(options.composition().composing) return {decorations:value.decorations.map(tr.changes),wrappers:value.wrappers.map(tr.changes)};
      if(!tr.docChanged&&!tr.selection&&!tr.reconfigured&&!tr.effects.some(effect=>effect.is(refresh))) return value;
      return projectState(tr.state);
    },
    provide:field=>[EditorView.decorations.from(field,value=>value.decorations),EditorView.blockWrappers.from(field,value=>value.wrappers)],
  });
  return [field,EditorView.updateListener.of(update=>{
    if(options.getMode()!=='live'||!update.transactions.some(tr=>tr.isUserEvent('select.search'))) return;
    const selection=update.state.selection;
    // Revealing a distant block changes the virtual viewport's line heights.
    // CM can exhaust its bounded measure pass with the search scroll pending.
    // Listeners run after CM schedules that pass; resume measurement next frame
    // using its public API, without another selection/history transaction.
    requestAnimationFrame(()=>{
      if(update.view.dom.isConnected&&update.view.state.selection.eq(selection)
        &&options.getMode()==='live'&&!options.composition().composing) update.view.requestMeasure();
    });
  }),EditorView.domEventHandlers({compositionend:(_event,view)=>{
    setTimeout(()=>{if(view.dom.isConnected && !options.composition().composing) view.dispatch({effects:refresh.of(null)});},1);return false;
  }}),EditorView.baseTheme({
    '.cm-live-gap':{display:'none'},
    '.cm-live-paragraph':{margin:'.8em 0'},
    // Keep CM's caret buffers, but do not let their baseline-aligned 1em
    // image height enlarge the frozen Setext heading line box.
    '.cm-live-setext-heading .cm-widgetBuffer':{height:'0'},
    '.cm-live-paragraph > .cm-line, .cm-live-setext-heading > .cm-line':{padding:'0'},
    '.cm-live-quote > .cm-live-paragraph:first-child':{marginTop:'0'},
    '.cm-live-quote > .cm-live-paragraph:last-child':{marginBottom:'0'},
    '.cm-live-heading':{fontWeight:'700',lineHeight:'1.4',marginTop:'1rem',marginBottom:'1rem'},
    '.cm-live-h1':{fontSize:'2.25em',lineHeight:'1.2'},
    '.cm-live-h2':{fontSize:'1.75em',lineHeight:'1.225'},
    '.cm-live-h3':{fontSize:'1.5em',lineHeight:'1.43'},
    '.cm-live-h4':{fontSize:'1.25em'},'.cm-live-h5, .cm-live-h6':{fontSize:'1em'},
    '.cm-live-h1, .cm-live-h2':{paddingBottom:'.3em',borderBottom:'1px solid var(--heading-border, #eee)'},
    '.cm-live-strong':{fontWeight:'700'},'.cm-live-emphasis':{fontStyle:'italic'},'.cm-live-strike':{textDecoration:'line-through'},
    '.cm-live-link':{color:'var(--link, #4183c4)'},
    '.cm-live-inline-code, .cm-live-code':{
      fontFamily:'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize:'.9em',border:'1px solid var(--code-border, #e7eaed)',borderRadius:'3px',
    },
    '.cm-live-inline-code':{padding:'0 2px',backgroundColor:'var(--inline-bg, #f3f4f4)'},
    '.cm-live-code':{backgroundColor:'var(--block-bg, #f8f8f8)',borderWidth:'0 1px',borderRadius:'0',padding:'0 10px'},
    '.cm-live-code-first':{borderTopWidth:'1px',borderTopLeftRadius:'3px',borderTopRightRadius:'3px',marginTop:'15px',paddingTop:'8px'},
    '.cm-live-code-last':{borderBottomWidth:'1px',borderBottomLeftRadius:'3px',borderBottomRightRadius:'3px',marginBottom:'15px',paddingBottom:'6px'},
    '.cm-live-code-delimiter':{fontSize:'0',lineHeight:'0'},
    '.cm-live-quote':{borderLeft:'4px solid var(--border, #dfe2e5)',padding:'0 15px',color:'var(--muted, #777)'},
    '.cm-live-list':{paddingLeft:'30px'},
    '.cm-live-math, .cm-live-image':{display:'inline-block',maxWidth:'100%',verticalAlign:'middle',cursor:'text'},
    '.cm-live-math-block':{display:'block',width:'100%',textAlign:'center',margin:'.8em 0'},
    '.cm-live-math-block .katex-display':{margin:'0',textAlign:'center'},
    '.cm-live-rule':{display:'block'},
    '.cm-live-escape, .cm-live-entity':{cursor:'text',whiteSpace:'normal'},
    '.cm-live-math p, .cm-live-image p':{display:'inline',margin:'0'},
    '.cm-live-image img':{maxWidth:'100%'},
    '.cm-live-table':{position:'relative',overflowX:'auto',margin:'.8em 0'},
    '.cm-live-table table':{borderCollapse:'collapse',width:'auto',maxWidth:'100%'},
    '.cm-live-table th, .cm-live-table td':{border:'1px solid var(--border, #dfe2e5)',padding:'6px 13px',verticalAlign:'top'},
    '.cm-live-table th, .cm-live-table tr:nth-child(even)':{backgroundColor:'var(--block-bg, #f8f8f8)'},
    '.cm-live-table p':{margin:'0'},
    '.cm-live-table .cm-editor':{backgroundColor:'transparent',minWidth:'3em',outline:'none'},
    '.cm-live-table .cm-scroller':{fontFamily:'inherit'},
    '.cm-live-table .cm-content':{padding:'0'},'.cm-live-table .cm-line':{padding:'0'},
    '.cm-live-guidance':{padding:'.5em',border:'1px solid #b85',whiteSpace:'normal'},
    '.cm-live-rejected-input':{display:'block',width:'95%',minHeight:'4em',color:'inherit',backgroundColor:'transparent'},
  }),tableInteractions(options)];
};
