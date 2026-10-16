import { netPatch } from './composition';
import type { Range, Source, Patch, EOL } from '../protocol';
export interface Cell extends Range { text:string; offsets:number[]; start:number; end:number }
export interface TableRow extends Range { cells:Cell[] }
export type ColumnAlignment = 'left' | 'center' | 'right' | null;
export interface Table extends Range { rows:TableRow[]; separator:TableRow; alignments:ColumnAlignment[] }
/** row 0 is the header; insertRow positions start at 1. Deleting header removes the table. */
export type TableAction = {type:'editCell';row:number;column:number;text:string}|{type:'insertRow';row:number}|{type:'deleteRow';row:number}|{type:'insertColumn';column:number}|{type:'deleteColumn';column:number};

function rowAt(text:string, from:number, to:number):TableRow|null {
  const pipes:number[]=[];
  for(let p=from;p<to;p++) if(text[p]==='|') {
    // Match markdown-it 15's escapedSplit: only the immediately preceding
    // character matters, including runs of two or more backslashes.
    if(text[p-1]!=='\\') pipes.push(p);
  }
  if(!pipes.length) return null;
  const left = !text.slice(from,pipes[0]).trim(), right = !text.slice(pipes.at(-1)!+1,to).trim();
  const bounds=[left ? pipes[0]+1 : from, ...pipes.slice(left?1:0,right?-1:undefined).map(p=>p+1)];
  const ends=[...pipes.slice(left?1:0,right?-1:undefined),right?pipes.at(-1)!:to];
  const cells:Cell[]=bounds.map((start,i)=>{
    const end=ends[i]; const raw=text.slice(start,end);
    const lead=raw.trim() ? raw.match(/^[ \t]*/)![0].length : Math.floor(raw.length / 2);
    const trail=raw.trim() ? raw.match(/[ \t]*$/)![0].length : raw.length-lead;
    const a=start+lead, b=Math.max(a,end-trail); let display=''; const offsets:number[]=[];
    for(let p=a;p<b;p++) {
      // GFM removes the escape before a pipe even inside a code span.
      if(text[p]==='\\' && text[p+1]==='|') { offsets.push(p); display+='|'; p++; }
      else { offsets.push(p); display+=text[p]; }
    }
    offsets.push(b);
    return {from:a,to:b,start,end,text:display,offsets};
  });
  return {from,to,cells};
}

export function parseTable(text:string, range:Range):Table|null {
  if(!Number.isInteger(range.from)||!Number.isInteger(range.to)||range.from<0||range.to>text.length||range.to<=range.from||
    range.from>0 && text[range.from-1]!=='\n'||range.to<text.length && text[range.to]!=='\n') return null;
  let at=range.from; const lines:TableRow[]=[];
  for(const line of text.slice(range.from,range.to).split('\n')) {
    if (/^( {4}|\t)/.test(line)) return null;
    const row=rowAt(text,at,at+line.length); if(!row) return null;
    lines.push(row); at+=line.length+1;
  }
  if(lines.length<2) return null;
  const count=lines[0].cells.length;
  if(!count || lines.some(r=>r.cells.length!==count) || lines[1].cells.some(c=>!/^:?-+:?$/.test(c.text))) return null;
  const alignments:ColumnAlignment[]=lines[1].cells.map(c=>c.text.endsWith(':') ? c.text.startsWith(':') ? 'center' : 'right' : c.text.startsWith(':') ? 'left' : null);
  return {...range,rows:[lines[0],...lines.slice(2)],separator:lines[1],alignments};
}
export function cellPosition(cell:Cell,offset:number):number {
  return cell.offsets[Math.max(0,Math.min(cell.text.length,offset))];
}
export function tableTab(row:number,column:number,rows:number,columns:number,backwards:boolean):{exit:'before'|'after'}|{row:number;column:number} {
  const next=row*columns+column+(backwards?-1:1);
  return next<0 ? {exit:'before'} : next>=rows*columns ? {exit:'after'} : {row:Math.floor(next/columns),column:next%columns};
}
function index(value:number,max:number):void {if(!Number.isInteger(value)||value<0||value>max) throw new Error('Invalid table index');}
function eolAt(source:Source,pos:number):EOL {
  const line=source.text.slice(0,pos).split('\n').length-1;
  return source.eols[line] ?? source.eols[line-1] ?? '\n';
}
export function tablePatches(source:Source,range:Range,action:TableAction):Patch[] {
  const table=parseTable(source.text,range); if(!table) throw new Error('Malformed table: edit in source mode');
  const patch=(from:number,to:number,insert=''):Patch=>({from,to,insert,eols:Array.from(insert.matchAll(/\n/g),()=>eolAt(source,from))});
  const columns=table.rows[0].cells.length;
  if(action.type==='editCell') {
    index(action.row,table.rows.length-1); index(action.column,columns-1);
    if(/[\n\r]/.test(action.text)) throw new Error('Multiline cell input: use source mode; input is retained below');
    const cell=table.rows[action.row].cells[action.column];
    const insert=action.text.replace(/\|/g,'\\|');
    const change=netPatch(source.text.slice(cell.from,cell.to),insert,cell.from);
    return change ? [change] : [];
  }
  if(action.type==='insertRow') {
    index(action.row,table.rows.length); if(action.row===0) throw new Error('Insert body rows after header');
    const row='|'+Array(columns).fill('  |').join('');
    const at=action.row===table.rows.length ? table.to : table.rows[action.row].from;
    return [patch(at,at,action.row===table.rows.length?'\n'+row:row+'\n')];
  }
  if(action.type==='deleteRow') {
    index(action.row,table.rows.length-1);
    if(action.row===0) return [patch(table.from,table.to)];
    const row=table.rows[action.row];
    return row.to===table.to ? [patch(row.from-1,row.to)] : [patch(row.from,row.to+1)];
  }
  index(action.column,columns-(action.type==='deleteColumn'?1:0));
  if(action.type==='deleteColumn' && columns===1) return [patch(table.from,table.to)];
  return [table.rows[0],table.separator,...table.rows.slice(1)].map(row=>{
    const c=action.column;
    if(action.type==='insertColumn') {
      const value=row===table.separator?' --- ':'  ';
      const at=c===columns ? row.cells[c-1].end : row.cells[c].start;
      // An empty first/last cell needs an explicit outer pipe, otherwise GFM
      // interprets its separator as the outer border and loses the new column.
      const leading=c===0 && at===row.from ? '|' : '';
      const trailing=c===columns && at===row.to ? '|' : '';
      return patch(at,at,c===columns?'|'+value+trailing:leading+value+'|');
    }
    const keepBorder=columns===2 && row.cells[0].start===row.from && row.cells.at(-1)!.end===row.to ? '|' : '';
    return c===columns-1 ? patch(row.cells[c-1].end,row.cells[c].end,keepBorder) : patch(row.cells[c].start,row.cells[c+1].start,keepBorder);
  });
}
