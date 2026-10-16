import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { liveExtensions } from '../src/live/decorations';
import { syntaxSpans, isActive } from '../src/live/syntax';
import { netPatch } from '../src/live/composition';
import type { LiveOptions } from '../src/editor/live-contract';

describe('live source projections', () => {
  it('publishes a factory usable by the root session', () => {
    const options: LiveOptions = { getSource: () => ({text:'# title',eols:[],bom:false}), apply:()=>{}, resolveImage:()=>null, getMode:()=> 'live', composition:()=>({composing:false,range:null}) };
    expect(() => EditorState.create({ doc:'# title', extensions:liveExtensions(options) })).not.toThrow();
  });
  it('maps heading, inline, list, quote and fences to original UTF-16', () => {
    const text = '# 😀 **bold**\n\n- item\n\n> quote\n\n```js\nx\n```';
    const spans = syntaxSpans(text);
    expect(spans.find(s=>s.kind==='strong')).toMatchObject({from:5,to:13,marks:[{from:5,to:7},{from:11,to:13}]});
    for (const kind of ['heading','list','quote','code']) expect(spans.some(s=>s.kind===kind)).toBe(true);
    expect(spans.find(s=>s.kind==='heading')?.marks.map(r=>text.slice(r.from,r.to))).toEqual(['# ']);
  });
  it('matches math/image renderer scope and excludes code/escaped dollars', () => {
    const text = '😀 $x^2$ ` $ignored$ ` \\$cash\n\n$$\nx+y\n$$\n\n![a](local.png)';
    expect(syntaxSpans(text).filter(s=>s.kind==='math').map(s=>text.slice(s.from,s.to))).toEqual(['$x^2$','$$\nx+y\n$$']);
    expect(syntaxSpans(text).filter(s=>s.kind==='image').map(s=>text.slice(s.from,s.to))).toEqual(['![a](local.png)']);
  });
  it('reveals complete active spans for selections, boundary cursors and preedit', () => {
    const span = {from:4,to:10};
    expect(isActive(span,[{from:0,to:5}],null)).toBe(true);
    expect(isActive(span,[{from:10,to:10}],null)).toBe(true);
    expect(isActive(span,[{from:0,to:0}],{from:6,to:7})).toBe(true);
    expect(isActive(span,[{from:0,to:0}],null)).toBe(false);
  });
  it('composition computes one net patch without splitting emoji', () => {
    expect(netPatch('a😀z','a😁中文z',5)).toEqual({from:6,to:8,insert:'😁中文',eols:[]});
    expect(netPatch('same','same',0)).toBeNull();
  });
});

it('table math is owned by the table widget, without overlapping root replacements',()=>{
 const text='| A |\n| - |\n| $x$ |';
 expect(syntaxSpans(text).map(s=>s.kind)).toEqual(['table']);
});

it('L3 inline renderer helper shares table tokens, document references and exact issue offsets',async()=>{
 const renderer=await import('../src/render/markdown');
 expect(renderer).toHaveProperty('renderTableCells');
 const {renderTableCells}=renderer;
 const text='😀 prefix\n\n| A | B | C |\n| - | - | - |\n| # title | - item | --- |\n| **bold** `code` $x$ | [label][ref] | ![a][pic] |\n\n[ref]: https://example.com "title"\n[pic]: missing.png';
 const {parseTable}=await import('../src/live/tables');
 const table=parseTable(text,{from:text.indexOf('| A'),to:text.indexOf('\n\n[ref]')})!;
 const rows=renderTableCells(text,table.from);
 expect(rows[1].map(c=>c.html)).toEqual(['# title','- item','---']);
 const html=rows[2][0].html;
 expect(html).toContain('<strong>bold</strong>');expect(html).toContain('<code>code</code>');expect(html).toContain('class="katex"');
 expect(rows[2][1].html).toBe('<a href="https://example.com" title="title">label</a>');
 const image=rows[2][2];
 expect(image.issues).toEqual([{kind:'image',message:'Missing local image: missing.png',from:text.indexOf('![a]'),to:text.indexOf('![a]')+9}]);
 expect(renderer.renderMarkdown(text).issues).toEqual(image.issues);
});


it('L3 table inline helper preserves repeated math/image offsets through CRLF and escaped pipes',async()=>{
 const {renderTableCells}=await import('../src/render/markdown');
 const text='😀\r\n\r\n| Other |\r\n| - |\r\n| ![skip](skip.png) |\r\n\r\n| A | B |\r\n| - | - |\r\n| \\| ![a](same.png) $\\badcmd$ | ![a](same.png) $\\badcmd$ |';
 const rows=renderTableCells(text,text.indexOf('| A'));
 expect(rows).toHaveLength(2);expect(rows[1]).toHaveLength(2);
 const image1=text.indexOf('![a]'),math1=text.indexOf('$\\badcmd$');
 const image2=text.indexOf('![a]',image1+1),math2=text.indexOf('$\\badcmd$',math1+1);
 expect(rows[1].map(c=>c.issues.map(i=>({kind:i.kind,from:i.from,to:i.to})))).toEqual([
  [{kind:'image',from:image1,to:image1+14},{kind:'math',from:math1,to:math1+9}],
  [{kind:'image',from:image2,to:image2+14},{kind:'math',from:math2,to:math2+9}],
 ]);
});
