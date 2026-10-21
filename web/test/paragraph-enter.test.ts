import {describe,it,expect} from 'vitest';
import {createSession} from '../src/editor/session';
import {decodeSource,encodeSource} from '../src/editor/source';
import {renderMarkdown} from '../src/render/markdown';
const snapshot=(raw:string)=>({...decodeSource(new TextEncoder().encode(raw)),revision:0});

describe('ordinary live paragraph Enter',()=>{
  for(const sample of [
    {name:'split in prose',text:'Alpha first paragraph.\n\nBeta second paragraph.',at:5},
    {name:'paragraph end',text:'Alpha first paragraph.\n\nBeta second paragraph.',at:22},
    {name:'end of document',text:'Alpha',at:5},
    {name:'paragraph start',text:'Alpha',at:0},
    {name:'later line in a soft-wrapped paragraph',text:'Alpha\nBeta',at:8},
  ])it(`creates a source paragraph boundary: ${sample.name}`,async()=>{
    const raw='\ufeff'+sample.text.replaceAll('\n','\r\n');
    const s=createSession(snapshot(raw),()=>{});s.setMode('live');s.dispatch({selection:{anchor:sample.at}});
    await s.command('format',{kind:'newline'});
    expect(s.snapshot().text).toBe(sample.text.slice(0,sample.at)+'\n\n'+sample.text.slice(sample.at));
    expect(s.selection()).toEqual({anchor:sample.at+2,head:sample.at+2});
    const inherited=sample.text.includes('\n')?'\r\n':'\n';
    expect(s.snapshot().eols.every(eol=>eol===inherited)).toBe(true);
    await s.command('undo');expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
  });
  it('keeps split paragraphs separate after rendering and reverses a selected replacement',async()=>{
    const raw='\ufeffAlpha chosen tail\r\n\r\nEnd';const s=createSession(snapshot(raw),()=>{});s.setMode('live');
    s.dispatch({selection:{anchor:12,head:6}});await s.command('format',{kind:'newline'});
    expect(s.snapshot().text).toBe('Alpha \n\n tail\n\nEnd');
    expect(renderMarkdown(s.snapshot().text).html.match(/<p>/g)).toHaveLength(3);
    await s.command('undo');expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
  });
  it('adds only locally inherited terminators without normalizing mixed EOLs',async()=>{
    const raw='\ufeffAlpha one\r\nNext\n\nTail\rEnd';const s=createSession(snapshot(raw),()=>{});s.setMode('live');s.dispatch({selection:{anchor:5}});
    await s.command('format',{kind:'newline'});
    expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw.replace('Alpha','Alpha\r\n\r\n')));
    await s.command('undo');expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
  });
  for(const indent of ['    ','\t',' \t'])it(`does not turn an indented prose continuation into code (${JSON.stringify(indent)})`,async()=>{
    const raw='\ufeffAlpha\r\n'+indent+'Beta';const s=createSession(snapshot(raw),()=>{});s.setMode('live');
    const at=s.snapshot().text.length;s.dispatch({selection:{anchor:at}});await s.command('format',{kind:'newline'});
    expect(s.snapshot().text).toBe('Alpha\n'+indent+'Beta\n\n');
    await s.command('undo');expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
    await s.command('redo');const position=s.selection().head;s.edit([{from:position,to:position,insert:'NEW',eols:[]}]);
    expect(renderMarkdown(s.snapshot().text).html).toContain('<p>NEW</p>');
    expect(renderMarkdown(s.snapshot().text).html).not.toContain('<pre');
  });
});

for(const mode of ['source','live'] as const)describe(`${mode} Enter preserves structural/literal context`,()=>{
  for(const [name,text,at,insert] of [
    ['source prose','Alpha',5,mode==='source'?'\n':'\n\n'],
    ['blank line','Alpha\n\nBeta',6,'\n'],
    ['fenced code','```txt\nAlpha\n```',10,'\n'],
    ['indented code','    Alpha',8,'\n    '],
    ['inline code','A `Alpha` tail',5,'\n'],
    ['image source','A ![Alpha](x.png) tail',5,'\n'],
    ['inline HTML source','A <span class="Alpha"> tail',6,'\n'],
    ['link destination','A [label](Alpha) tail',13,'\n'],
    ['quote','> Alpha',5,'\n> '],
    ['heading','# Alpha',5,'\n'],
    ['table','| A | B |\n| - | - |\n| Alpha | beta |',25,'\n'],
    ['display math','$$\nx+1\n$$',5,'\n'],
    ['unfinished display math','$$\nx+1',5,'\n'],
    ['unfinished inline math','$x+1',4,'\n'],
    ['inline math','A $x+1$ tail',5,'\n'],
    ['raw HTML','<div>\nAlpha\n</div>',9,'\n'],
    ['unordered list','- Alpha',7,'\n- '],
    ['ordered list','7. Alpha',8,'\n8. '],
    ['task list','- [x] Alpha',11,'\n- [ ] '],
  ] as const)it(name,async()=>{
    const raw='\ufeff'+text.replaceAll('\n','\r\n');const s=createSession(snapshot(raw),()=>{});s.setMode(mode);s.dispatch({selection:{anchor:at}});
    await s.command('format',{kind:'newline'});
    expect(s.snapshot().text).toBe(text.slice(0,at)+insert+text.slice(at));
    await s.command('undo');expect(encodeSource(s.snapshot())).toEqual(new TextEncoder().encode(raw));
  });
});
