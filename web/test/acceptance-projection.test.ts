import {expect,it} from 'vitest';
import {syntaxSpans} from '../src/live/syntax';

it('AC3 maps HR, every quote prefix, ordered counters and decoded-literal source ranges',()=>{
 const text='---\n\n> first\n> second\n\n5. a\n1. b\n1. c\n\n😀 \\*lit\\* &amp; &#65; &#x1F600; `&amp;`';
 const spans=syntaxSpans(text);
 expect(spans.filter(s=>s.kind==='rule').map(s=>text.slice(s.from,s.to))).toEqual(['---']);
 expect(spans.find(s=>s.kind==='quote')?.marks.map(m=>text.slice(m.from,m.to))).toEqual(['> ','> ']);
 expect(spans.filter(s=>s.kind==='list').flatMap(s=>s.labels??[])).toEqual(['5. ','6. ','7. ']);
 expect(spans.filter(s=>s.kind==='escape').map(s=>text.slice(s.from,s.to))).toEqual(['\\*','\\*']);
 expect(spans.filter(s=>s.kind==='entity').map(s=>text.slice(s.from,s.to))).toEqual(['&amp;','&#65;','&#x1F600;']);
});

it('AC4 distinguishes the source underline of Setext from its editable text',()=>{
 const text='Title\nmore\n===\n\nbody';
 expect(syntaxSpans(text).find(s=>s.kind==='heading')).toMatchObject({from:0,to:14,setext:true,marks:[{from:11,to:14}]});
});

it('AC9 maps top-level paragraphs and only soft source breaks, keeping hard breaks and code opaque',()=>{
 const text='a\nsoft\n\nsecond  \nhard\n\n```txt\n&amp;\n\n---\n```';
 const spans=syntaxSpans(text);
 expect(spans.filter(s=>s.kind==='paragraph').map(s=>({from:s.from,to:s.to,breaks:s.breaks}))).toEqual([
  {from:0,to:6,breaks:[{from:1,to:2}]},{from:8,to:21,breaks:[]},
 ]);
 expect(spans.filter(s=>s.kind==='entity'||s.kind==='rule')).toEqual([]);
});

it('AP1 excludes the final quoted Setext underline LF from soft text breaks',()=>{
 const heading=syntaxSpans('> Title\n> more\n> ===\n\nend').find(s=>s.kind==='heading');
 expect(heading?.breaks).toEqual([{from:7,to:8}]);
 expect(heading?.marks).toEqual([{from:17,to:20}]);
});

it('AP2 maps hard-break markers separately from their retained source LF',()=>{
 for(const marker of ['\\','  ']) {
  const source=`hard${marker}\nbreak\n\nend`;
  expect(syntaxSpans(source).find(s=>s.kind==='hard-break')).toMatchObject({from:4,to:5+marker.length,marks:[{from:4,to:4+marker.length}]});
 }
 expect(syntaxSpans('`hard\\\nbreak`').filter(s=>s.kind==='hard-break')).toEqual([]);
});
