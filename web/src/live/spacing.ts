import type {EditorState, Range, RangeSet} from '@codemirror/state';
import {BlockWrapper, type EditorView} from '@codemirror/view';

export interface SpacingBlock {
  from:number;
  to:number;
  kind:string;
  rank:number;
}
interface Block extends SpacingBlock {children:Block[];before:number;after:number}

// A small set of positive CSS lengths. Union represents collapsed margins;
// CSS max resolves em/rem at the editor's actual zoom, without DOM reads.
const paragraph=1,heading=2,code=4;
const spacingWrappers=new WeakSet<BlockWrapper>();
function length(margin:number):string {
  const values=[...(margin&paragraph?['.8em']:[]),...(margin&heading?['1rem']:[]),...(margin&code?['15px']:[])];
  return values.length>1?`max(${values.join(',')})`:values[0]??'0px';
}

/** A virtual block gap already includes the heights of omitted wrappers.
 * Only emit spacing at a real rendered block start, including CM's extra
 * selection blocks outside the main viewport. These are public height-map
 * queries, not DOM measurements or a second measure/update loop.
 */
export function visibleSpacing(view:EditorView,wrappers:RangeSet<BlockWrapper>):RangeSet<BlockWrapper> {
  const {from,to}=view.viewport,{anchor,head}=view.state.selection.main;
  const a=view.lineBlockAt(anchor),h=anchor===head?a:view.lineBlockAt(head);
  return wrappers.update({filter:(pos,_end,value)=>!spacingWrappers.has(value)
    ||pos>=from&&pos<=to||pos>=a.from&&pos<=a.to||pos>=h.from&&pos<=h.to});
}

/** Move only margins outside CM's measured block boxes into wrapper insets.
 * Quote children form their own collapsing scope. Source-only hidden lines
 * have zero extent; visible source lines interrupt margin collapse normally.
 * Sorting is O(n log n), and each block/source line is visited once afterward.
 */
export function blockSpacing(state:EditorState,blocks:SpacingBlock[],hiddenLines:ReadonlySet<number>,extraLines:ReadonlySet<number>=new Set()):{wrappers:Range<BlockWrapper>[];bottom:string} {
  const root:Block={from:0,to:state.doc.length,kind:'root',rank:100,children:[],before:0,after:0};
  const stack=[root];
  blocks.sort((a,b)=>a.from-b.from||b.to-a.to||b.rank-a.rank);
  for(const block of blocks) {
    while(stack.length>1&&block.from>stack.at(-1)!.to) stack.pop();
    const margin=block.kind==='paragraph'||block.kind==='table'||block.kind==='math'?paragraph
      :block.kind==='heading'||block.kind==='rule'?heading:block.kind==='code'?code:0;
    const node:Block={...block,children:[],before:margin,after:block.kind==='rule'?0:margin};
    stack.at(-1)!.children.push(node);
    if(block.kind==='quote') stack.push(node);
  }
  const wrappers:Range<BlockWrapper>[]=[];
  function layout(parent:Block):void {
    const children:Block[]=[];
    let pos=parent.from;
    const sourceUntil=(end:number)=>{
      while(pos<=end) {
        const line=state.doc.lineAt(pos);
        // Extra editable blanks contribute their real CM line height without
        // splitting one collapsed paragraph margin into two separate margins.
        if(!hiddenLines.has(line.from)&&!extraLines.has(line.from)) children.push({from:line.from,to:line.to,kind:'source',rank:0,children:[],before:0,after:0});
        pos=line.to+1;
      }
    };
    for(const child of parent.children) {
      sourceUntil(child.from-1);
      if(child.kind==='quote') layout(child);
      if(parent.kind==='quote'&&child.kind==='paragraph') {
        // Match the original direct-child :first-child/:last-child rules,
        // including hidden source lines that still occupy a DOM child slot.
        if(child.from===parent.from) child.before=0;
        if(child.to===parent.to) child.after=0;
      }
      children.push(child);
      pos=state.doc.lineAt(child.to).to+1;
    }
    sourceUntil(parent.to);
    if(!children.length) return;
    if(parent.kind==='quote') {
      parent.before=children[0].before;
      parent.after=children.at(-1)!.after;
    }
    let previous=0;
    for(let i=0;i<children.length;i++) {
      const child=children[i],inset=parent.kind==='quote'&&i===0?0:previous|child.before;
      if(inset) {
        const wrapper=BlockWrapper.create({tagName:'div',rank:child.rank+.5,
        // CM caches wrappers by attributes (rank is not part of equality).
        // A disappearing source-gap frame must not be reused around a live
        // table: moving its existing DOM to that frame blurs the cell editor.
          attributes:{class:'cm-live-spacing','data-live-spacing':`${child.kind}:${child.from}`,style:`padding-top:${length(inset)}`}});
        spacingWrappers.add(wrapper);
        wrappers.push(wrapper.range(child.from,child.to));
      }
      previous=child.after;
    }
    if(parent.kind==='root') parent.after=previous;
  }
  layout(root);
  // A terminal wrapper's bottom inset has no following CM leaf to receive
  // it. Content padding is measured separately by CM and keeps EOF editable.
  return {wrappers,bottom:length(root.after)};
}
