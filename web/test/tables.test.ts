import { describe, it, expect } from 'vitest';
import { parseTable, tablePatches, cellPosition, tableTab } from '../src/live/tables';
import { applyPatches, decodeSource, encodeSource } from '../src/editor/source';
const source = (text:string) => decodeSource(new TextEncoder().encode(text));
const text='before\n\n| A | B |\n| :--- | ---: |\n| 😀a\\|b | `c\\|d` |\n\nafter';
const range={from:8,to:text.indexOf('\n\nafter')};
describe('mapped table transactions',()=>{
 it('unescapes pipes in code and preserves UTF-16 boundary maps',()=>{
  const t=parseTable(text,range)!;
  expect(t.rows[1].cells.map(c=>c.text)).toEqual(['😀a|b','`c|d`']);
  const c=t.rows[1].cells[0];
  expect(cellPosition(c,4)).toBe(text.indexOf('b |'));
 });
 it('changes only target cell contents and keeps BOM, mixed EOL and padding',()=>{
  const s=source('\ufeff'+text.replace('before\n','before\r\n').replace('| A | B |\n','| A | B |\r'));
  const patches=tablePatches(s,range,{type:'editCell',row:1,column:0,text:'中文|😀'});
  expect(patches).toEqual([{from:text.indexOf('😀'),to:text.indexOf('😀')+6,insert:'中文\\|😀',eols:[]}]);
  const result=applyPatches(s,patches);
  expect(result.text).toBe(text.replace('😀a\\|b','中文\\|😀'));
  expect(result.eols).toEqual(s.eols); expect(result.bom).toBe(true);
  expect(encodeSource(result)[0]).toBe(239);
 });
 it('retains surrounding padding when an emptied cell is typed into again',()=>{
  const s=source('| a | b |\n| - | - |\n| old | right |');
  const empty=applyPatches(s,tablePatches(s,{from:0,to:s.text.length},{type:'editCell',row:1,column:0,text:''}));
  const next=applyPatches(empty,tablePatches(empty,{from:0,to:empty.text.length},{type:'editCell',row:1,column:0,text:'x'}));
  expect(next.text).toBe('| a | b |\n| - | - |\n| x | right |');
 });
 it('refuses multiline edits instead of deleting input',()=>{
  expect(()=>tablePatches(source(text),range,{type:'editCell',row:1,column:0,text:'a\nb'})).toThrow(/multiline|source mode/i);
 });
 it('inserts and removes a row with local EOL inheritance',()=>{
  const s=source('| a | b |\r\n| - | - |\r| c | d |'); const r={from:0,to:s.text.length};
  const p=tablePatches(s,r,{type:'insertRow',row:2});
  const next=applyPatches(s,p);
  expect(next.text).toBe('| a | b |\n| - | - |\n| c | d |\n|  |  |');
  expect(next.eols).toEqual(['\r\n','\r','\r']);
  expect(applyPatches(next,tablePatches(next,{from:0,to:next.text.length},{type:'deleteRow',row:2}))).toEqual(s);
 });
 it('last body row deletion leaves a valid header table',()=>{
  const s=source('| a |\n| - |\n| b |');
  const next=applyPatches(s,tablePatches(s,{from:0,to:s.text.length},{type:'deleteRow',row:1}));
  expect(next.text).toBe('| a |\n| - |'); expect(parseTable(next.text,{from:0,to:next.text.length})).not.toBeNull();
 });
 it('column operations touch only the table; last column removes it explicitly',()=>{
  const s=source(text); const next=applyPatches(s,tablePatches(s,range,{type:'insertColumn',column:1}));
  expect(next.text).toBe(text.replace('| A | B |','| A |  | B |').replace('| :--- | ---: |','| :--- | --- | ---: |').replace('| 😀a\\|b | `c\\|d` |','| 😀a\\|b |  | `c\\|d` |'));
  const removed=applyPatches(next,tablePatches(next,{from:8,to:next.text.indexOf('\n\nafter')},{type:'deleteColumn',column:1}));
  expect(removed).toEqual(s);
  const one=source('pre\n\n| a |\n| - |\n\npost');
  expect(applyPatches(one,tablePatches(one,{from:5,to:16},{type:'deleteColumn',column:0})).text).toBe('pre\n\n\n\npost');
 });
 it('irregular, incomplete, unescaped code pipes and stale ranges fall back to source',()=>{
  for(const t of ['| a | b |\n| - | - |\n| c |','| a |\n| nope |','| a |\n| - |\n| `a|b` |']) expect(parseTable(t,{from:0,to:t.length})).toBeNull();
  expect(parseTable('x\n| a |\n| - |',{from:3,to:15})).toBeNull();
 });
 it('Tab visits existing cells and exits boundaries without expanding',()=>{
  expect(tableTab(0,0,2,2,true)).toEqual({exit:'before'});
  expect(tableTab(1,1,2,2,false)).toEqual({exit:'after'});
  expect(tableTab(0,1,2,2,false)).toEqual({row:1,column:0});
 });
});

it('small cell changes produce a minimal raw patch without rewriting escaped code',()=>{
 const s=source('| a |\n| - |\n| `c\\|d` |');
 expect(tablePatches(s,{from:0,to:s.text.length},{type:'editCell',row:1,column:0,text:'`c|dx`'}))
  .toEqual([{from:19,to:19,insert:'x',eols:[]}]);
});
it('adding empty boundary columns to an unbordered table keeps those columns',()=>{
 for(const column of [0,2]) {
  const s=source('a | b\n- | -\nc | d');
  const next=applyPatches(s,tablePatches(s,{from:0,to:s.text.length},{type:'insertColumn',column}));
  const table=parseTable(next.text,{from:0,to:next.text.length});
  expect(table?.rows.map(row=>row.cells.map(c=>c.text))).toEqual(column===0?[['','a','b'],['','c','d']]:[['a','b',''],['c','d','']]);
 }
});
it('deleting down to one column in an unbordered table leaves a valid table',()=>{
 const s=source('a | b\n- | -\nc | d');
 for(const column of [0,1]) {
  const next=applyPatches(s,tablePatches(s,{from:0,to:s.text.length},{type:'deleteColumn',column}));
  expect(parseTable(next.text,{from:0,to:next.text.length})?.rows.map(r=>r.cells[0].text)).toEqual(column===0?['b','d']:['a','c']);
 }
});

it.each([1,2,3])('L1 matches immediate-backslash pipe splitting for a run of %i',async(count)=>{
 const {renderMarkdown}=await import('../src/render/markdown');
 const slashes='\\'.repeat(count);
 const text=`| A | B |\n| - | - |\n| left${slashes}|right | \`c${slashes}|d\` |`;
 const table=parseTable(text,{from:0,to:text.length});
 expect(table?.rows[1].cells.map(c=>c.text)).toEqual([`left${'\\'.repeat(count-1)}|right`,`\`c${'\\'.repeat(count-1)}|d\``]);
 // The pinned renderer must also keep exactly two cells, including the code-span pipe.
 expect(renderMarkdown(text).html.match(/<td>/g)).toHaveLength(2);
 const s=source(text),display=`left${slashes}|right`;
 const patches=tablePatches(s,{from:0,to:text.length},{type:'editCell',row:1,column:0,text:display});
 const next=applyPatches(s,patches);
 expect(parseTable(next.text,{from:0,to:next.text.length})?.rows[1].cells[0].text).toBe(display);
 expect(patches.every(p=>p.from>=text.indexOf('left') && p.to<=text.indexOf(' | `'))).toBe(true);
});

it('L2 derives left, center, right and default column alignment from the source separator',()=>{
 const text='| a | b | c | d |\n| :-- | :-: | --: | --- |\n| 1 | 2 | 3 | 4 |';
 expect(parseTable(text,{from:0,to:text.length})?.alignments).toEqual(['left','center','right',null]);
});
