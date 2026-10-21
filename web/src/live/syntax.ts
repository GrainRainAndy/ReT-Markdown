import type { SyntaxNode } from '@lezer/common';
import { structureContext } from '../editor/structure';
import type { Range } from '../protocol';

export interface SyntaxSpan extends Range {
  kind: string;
  marks: Range[];
  level?: number;
  labels?: string[];
  breaks?: Range[];
  setext?: boolean;
  block?: boolean;
  display?: boolean;
  quoted?: boolean;
  depth?: number;
  fence?: { opening: Range; closing: Range | null; body: Range; ownsEOF: boolean };
}

export function isActive(span: Range, selection: readonly Range[], composition: Range | null): boolean {
  return [...selection, ...(composition ? [composition] : [])].some(r =>
    r.from === r.to ? r.from >= span.from && r.from <= span.to : r.from < span.to && r.to > span.from);
}

/** Indexed containment without merging disjoint/nested source ranges. */
export function indexedContains(ranges:readonly Range[]):(range:Range)=>boolean {
  const sorted=ranges.map(r=>({from:r.from,to:r.to})).sort((a,b)=>a.from-b.from);
  const ends:number[]=[];
  for(const range of sorted) ends.push(Math.max(range.to,ends.at(-1)??-1));
  return range=>{
    let low=0,high=sorted.length;
    while(low<high) {const mid=(low+high)>>>1;if(sorted[mid].from<=range.from) low=mid+1;else high=mid;}
    return low>0 && ends[low-1]>=range.to;
  };
}

function descendants(node:SyntaxNode,name:string):SyntaxNode[] {
  const found:SyntaxNode[]=[];
  for(let child=node.firstChild;child;child=child.nextSibling) {
    if(child.name===name) found.push(child);
    found.push(...descendants(child,name));
  }
  return found;
}
function softBreaks(text:string,from:number,to:number,node:SyntaxNode):Range[] {
  const hard=descendants(node,'HardBreak');const result:Range[]=[];
  for(let at=from;at<to;at++) if(text[at]==='\n' && !hard.some(r=>r.from<=at && r.to>at)) result.push({from:at,to:at+1});
  return result;
}
function orderedLabel(node:SyntaxNode,text:string):string {
  const list=node.parent!;const first=list.firstChild?.getChild('ListMark');
  const start=first ? Number(text.slice(first.from,first.to).match(/^\d+/)?.[0]??1) : 1;
  let index=0;
  for(let item=list.firstChild;item;item=item.nextSibling) {
    if(item.from===node.from) break;
    if(item.name==='ListItem') index++;
  }
  return `${start+index}. `;
}

/** Positions are UTF-16 in the original LF text; no HTML-to-source inference. */
export function syntaxSpans(text: string): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [];
  const { tree, maths: mathRanges, fences }=structureContext(text);
  const byOpening=new Map(fences.map(fence=>[fence.opening.from,fence]));
  const seenFences=new Set<number>(),coveredByFenceBody=indexedContains(fences.map(fence=>fence.bodyRange));
  const codeSpan=(fence:typeof fences[number],info:Range[]=[]):SyntaxSpan=>{
    const marks=[fence.opening,...info,...(fence.closing?[fence.closing]:[])];
    return {from:fence.opening.from,to:fence.to,kind:'code',marks,labels:undefined,
      fence:{opening:fence.opening,closing:fence.closing,body:fence.bodyRange,ownsEOF:fence.ownsEOF}};
  };
  tree.iterate({ enter(node) {
    const name = node.name;
    if(name==='FencedCode') {
      const opening=node.node.getChildren('CodeMark')[0];
      const fence=opening&&byOpening.get(opening.from);
      if(fence) {
        seenFences.add(fence.opening.from);
        const lineEnd=text.indexOf('\n',fence.opening.to);
        const info=node.node.getChildren('CodeInfo').filter(mark=>mark.to<=(lineEnd<0?text.length:lineEnd))
          .map(mark=>({from:mark.from,to:mark.to}));
        spans.push(codeSpan(fence,info));
      }
      // Renderer-owned code has no inline/block children in the live projection.
      return false;
    }
    if(coveredByFenceBody(node)) return false;
    const paragraph=name==='Paragraph' && ['Document','Blockquote'].includes(node.node.parent?.name??'');
    const kind = /^ATXHeading|^SetextHeading/.test(name) ? 'heading' : paragraph ? 'paragraph' : ({
      StrongEmphasis:'strong', Emphasis:'emphasis', Strikethrough:'strike', InlineCode:'inline-code',
      Task:'task', ListItem:'list', Blockquote:'quote', Image:'image', Link:'link', Table:'table',
      HorizontalRule:'rule',Escape:'escape',Entity:'entity',HardBreak:'hard-break',
    } as Record<string,string>)[name];
    if (!kind) return;
    const marks:Range[] = [];
    const marker=(child:SyntaxNode)=>{
      let to=child.to;
      if(['HeaderMark','ListMark','QuoteMark'].includes(child.name)) while(text[to]===' '||text[to]==='\t') to++;
      marks.push({from:child.from,to});
    };
    for(let child=node.node.firstChild;child;child=child.nextSibling) {
      if(/^(HeaderMark|EmphasisMark|StrikethroughMark|CodeMark|CodeInfo|ListMark|TaskMarker|LinkMark|URL|LinkTitle)$/.test(child.name)) marker(child);
    }
    if(kind==='hard-break') marks.push({from:node.from,to:node.to-1});
    let depth=0;
    if(kind==='quote') {
      for(let parent=node.node.parent;parent;parent=parent.parent) if(parent.name==='Blockquote') depth++;
      for(const child of descendants(node.node,'QuoteMark')) {
        let owner=child.parent;while(owner && owner.name!=='Blockquote') owner=owner.parent;
        if(owner?.from===node.from && owner.to===node.to) marker(child);
      }
    }
    const labels=kind==='list' ? marks.map(()=>node.node.getChild('Task') ? '' : node.node.parent?.name==='OrderedList' ? orderedLabel(node.node,text) : '• ')
      : kind==='task' ? marks.map(mark=>/x/i.test(text.slice(mark.from,mark.to))?'☑ ':'☐ ') : undefined;
    const setext=name.startsWith('SetextHeading');
    spans.push({from:node.from,to:node.to,kind,marks,labels,
      ...kind==='heading'?{level:Number(name.at(-1)),setext}: {},
      ...kind==='paragraph'?{quoted:node.node.parent?.name==='Blockquote',breaks:softBreaks(text,node.from,node.to,node.node)}:{},
      ...setext?{breaks:softBreaks(text,node.from,text.lastIndexOf('\n',marks[0].from-1),node.node)}:{},
      ...kind==='quote'?{depth}:{},
    });
    if(['code','inline-code','image','table'].includes(kind)) return false;
  } });
  for(const fence of fences) if(!seenFences.has(fence.opening.from)) {
    const end=text.indexOf('\n',fence.opening.to),lineEnd=end<0?text.length:end;
    let from=fence.opening.to;while(from<lineEnd&&(text[from]===' '||text[from]==='\t')) from++;
    spans.push(codeSpan(fence,from<lineEnd?[{from,to:lineEnd}]:[]));
  }
  const coveredByTable=indexedContains(spans.filter(s=>s.kind==='table'));
  for(const {from,to,closed,block,display} of mathRanges) {
    if(closed&&!coveredByTable({from,to})) spans.push({kind:'math',from,to,marks:[],block,display});
  }
  // Collapse only source-only inter-block blank lines, never opaque source/code.
  const roots:SyntaxNode[]=[];
  for(let root=tree.topNode.firstChild;root;root=root.nextSibling) roots.push(root);
  const coveredByQuote=indexedContains(spans.filter(s=>s.kind==='quote'));
  const opaque=indexedContains(spans.filter(s=>s.kind==='code'||s.kind==='table'));
  let rootIndex=0;
  for(let from=0;from<text.length;) {
    const newline=text.indexOf('\n',from),to=newline<0?text.length:newline+1;
    const line=text.slice(from,newline<0?to:newline);
    while(rootIndex<roots.length && roots[rootIndex].to<=from) rootIndex++;
    const outside=rootIndex===roots.length || roots[rootIndex].from>from;
    const quotedBlank=/^ {0,3}(?:>[ \t]*)+$/.test(line) && coveredByQuote({from,to:to-1})
      && !opaque({from,to:to-1});
    if((outside&&!line.trim()||quotedBlank)&&to>from) spans.push({kind:'gap',from,to,marks:[]});
    from=to;
  }
  const maths=spans.filter(s=>s.kind==='math'),coveredByMath=indexedContains(maths);
  return spans.filter(s=>s.kind==='math'||!coveredByMath(s))
    .sort((a,b)=>a.from-b.from||b.to-a.to);
}
