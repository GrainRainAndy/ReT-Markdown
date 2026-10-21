import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {rawCssPlugin,chromiumFallbackPath} from '../../scripts/web-tooling.mjs';

let bundle:string,styles:string;
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
  const result=await build({entryPoints:['web/test/final-live-browser-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
  bundle=result.outputFiles[0].text;
  styles=(await Promise.all(['typography','palette','print'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
  styles+=(await readFile('node_modules/katex/dist/katex.min.css','utf8')).replace(/@font-face\{[^}]*\}/g,'');
});

test.beforeEach(async({page})=>{
  await page.setContent('<main id="editor"></main>');await page.addStyleTag({content:styles});
  await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});
  await page.addScriptTag({content:bundle});
});

// Observe real DOM selection changes without repairing the selection under test.
async function observeGesture(page:Page) {
  await page.evaluate(()=>{
    const api=window as any;api.mathEvents=[];api.rawSelectionChanges=0;
    document.addEventListener('selectionchange',()=>api.rawSelectionChanges++);
    for(const type of ['mousedown','mouseup','click']) document.addEventListener(type,event=>{
      api.mathEvents.push({type,prevented:event.defaultPrevented});
    });
  });
}
async function settledSelection(page:Page) {
  return page.evaluate(async()=>{
    const api=window as any;
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    return api.nativeTransport.session.selection();
  });
}
async function glyphPoint(page:Page,glyph:string,side:'before'|'after') {
  return page.locator('.cm-live-math .katex-html').evaluate((el,{glyph,side})=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      const at=node.textContent!.indexOf(glyph);if(at<0)continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);
      const box=range.getBoundingClientRect();
      return {x:box.left+box.width*(side==='before'?.1:.9),y:(box.top+box.bottom)/2};
    }
    throw new Error(`No rendered glyph ${glyph}`);
  },{glyph,side});
}
async function clickGlyph(page:Page,glyph:string,side:'before'|'after') {
  const point=await glyphPoint(page,glyph,side);
  await observeGesture(page);
  await page.mouse.click(point.x,point.y);
}

test('clicking the trailing side of rendered 1 edits before the closing math delimiter',async({page})=>{
  const source='before😀\n\n行内 $x+1$ 后文\n\nend';
  const raw='\ufeffbefore😀\r\n\r行内 $x+1$ 后文\n\nend';
  await page.evaluate(raw=>(window as any).bootNative(raw),raw);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await clickGlyph(page,'1','after');
  const end=source.indexOf('$x+1$')+4;
  await expect.poll(()=>page.evaluate(()=>(window as any).nativeTransport.session.selection())).toEqual({anchor:end,head:end});
  expect(await settledSelection(page)).toEqual({anchor:end,head:end});
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source);
  await page.keyboard.insertText('2');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.replace('$x+1$','$x+12$'));
  await test.info().attach('completed-gesture-and-input',{contentType:'application/json',body:JSON.stringify(await page.evaluate(()=>{
    const api=window as any;return {events:api.mathEvents,selectionChanges:api.rawSelectionChanges,selection:api.nativeTransport.session.selection(),text:api.nativeTransport.session.snapshot().text};
  }),null,2)});
  await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('clicking the operator gap maps to the adjacent source boundary',async({page})=>{
  const source='before😀\n\n行内 $x+1$ 后文\n\nend';
  const raw='\ufeffbefore😀\r\n\r行内 $x+1$ 后文\n\nend';
  await page.evaluate(raw=>(window as any).bootNative(raw),raw);
  const point=await page.locator('.cm-live-math .katex-html').evaluate(el=>{
    const boxes:Record<string,DOMRect>={};
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) for(const glyph of ['+','1']) {
      const at=node.textContent!.indexOf(glyph);if(at<0)continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);
      boxes[glyph]=range.getBoundingClientRect();
    }
    const plus=boxes['+'],one=boxes['1'];
    return {x:(plus.right+one.left)/2,y:(Math.max(plus.top,one.top)+Math.min(plus.bottom,one.bottom))/2,gap:one.left-plus.right};
  });
  expect(point.gap,'KaTeX operator spacing must be a real non-text gap').toBeGreaterThan(0);
  await page.mouse.click(point.x,point.y);
  const at=source.indexOf('$x+1$')+3;
  expect(await settledSelection(page)).toEqual({anchor:at,head:at});
  await page.keyboard.insertText('2');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.replace('$x+1$','$x+21$'));
  await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
});

for(const sample of [
  {name:'leading side of 1',formula:'$x+1$',glyph:'1',side:'before',offset:3,result:'$x+21$',zoom:1},
  {name:'leading side inside a multi-digit text node',formula:'$12+345$',glyph:'4',side:'before',offset:5,result:'$12+3245$',zoom:1},
  {name:'trailing side inside inline double dollars at 75% zoom',formula:'$$12+345$$',glyph:'4',side:'after',offset:7,result:'$$12+3425$$',zoom:.75},
  {name:'trimmed block with exact raw content offset',formula:'$$\n  12+345  \n$$',glyph:'4',side:'after',offset:10,result:'$$\n  12+3425  \n$$',zoom:1},
] as const) test(`math glyph mapping: ${sample.name}`,async({page})=>{
  const source=`😀\n\n${sample.formula.includes('\n')?'':'行内 '}${sample.formula}\n\nend`,at=source.indexOf('$')+sample.offset;
  await page.evaluate(raw=>(window as any).bootNative(raw),source);
  if(sample.zoom!==1) await page.evaluate(zoom=>(window as any).nativeCommand('setZoom',{zoom}),sample.zoom);
  await clickGlyph(page,sample.glyph,sample.side);
  expect(await settledSelection(page)).toEqual({anchor:at,head:at});
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.status().canUndo)).toBe(false);
  await page.keyboard.insertText('2');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.replace(sample.formula,()=>sample.result));
  await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(source)));
});

for(const sample of [
  {name:'ignored internal whitespace',formula:'$x +1$'},
  {name:'quoted simple block with container prefixes',formula:'> $$\n> x+1\n> $$'},
  {name:'F08 quoted complex fraction',formula:'> $$\n> \\frac{1}{2}\n> $$'},
] as const) test(`source-mapped math replaces the earlier fallback: ${sample.name}`,async({page})=>{
  const source=`😀\n\n${sample.formula}\n\nend`,at=source.indexOf('1')+1;
  await page.evaluate(raw=>(window as any).bootNative(raw),source);
  await clickGlyph(page,'1','after');
  expect(await settledSelection(page)).toEqual({anchor:at,head:at});
  expect(await page.evaluate(()=>(window as any).mathEvents.find((event:any)=>event.type==='mousedown')?.prevented)).toBe(true);
  await page.keyboard.insertText('2');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.slice(0,at)+'2'+source.slice(at));
});

test('Enter handler on math, image and rule preserves the original reveal position',async({page})=>{
  for(const [formula,selector] of [['$x+1$','.cm-live-math'],['![x](missing.png)','.cm-live-image'],['---','.cm-live-rule']]) {
    const source=`😀\n\n${formula}\n\nend`,at=5;
    await page.evaluate(raw=>(window as any).bootNative(raw),source);
    await page.locator(selector).focus();await page.locator(selector).dispatchEvent('keydown',{key:'Enter'});
    await observeGesture(page);
    expect(await settledSelection(page)).toEqual({anchor:at,head:at});
    await page.keyboard.insertText('2');
    expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.slice(0,at)+'2'+source.slice(at));
  }
});

test('mapping leaves modified, non-primary and already-canceled mousedown on the fallback path',async({page})=>{
  await page.evaluate(raw=>(window as any).bootNative(raw),'before\n\n$x+1$\n\nend');
  const point=await glyphPoint(page,'1','after');
  const result=await page.locator('.cm-live-math').evaluate((el,point)=>{
    const api=window as any,before=api.nativeTransport.session.selection();
    const cases=[{button:1},{button:2},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}];
    const events=cases.map(options=>new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:point.x,clientY:point.y,...options}));
    const canceled=new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:point.x,clientY:point.y});canceled.preventDefault();events.push(canceled);
    for(const event of events) el.dispatchEvent(event);
    return {before,after:api.nativeTransport.session.selection(),prevented:events.map(e=>e.defaultPrevented),connected:el.isConnected};
  },point);
  expect(result.after).toEqual(result.before);expect(result.connected).toBe(true);
  expect(result.prevented).toEqual([false,false,false,false,false,false,true]);
});
