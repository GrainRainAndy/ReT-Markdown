import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {rawCssPlugin,chromiumFallbackPath} from '../../scripts/web-tooling.mjs';

let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
  const result=await build({entryPoints:['web/test/acceptance-table-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
  bundle=result.outputFiles[0].text;
  styles=(await Promise.all(['typography','palette'].map(name=>readFile(`web/styles/${name}.css`,'utf8')))).join('\n');
  styles+=(await readFile('node_modules/katex/dist/katex.min.css','utf8')).replace(/@font-face\{[^}]*\}/g,'');
});
test.beforeEach(async({page})=>{
  const failures:string[]=[];errors.set(page,failures);page.on('pageerror',error=>failures.push(error.message));
  await page.setContent('<main></main>');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});

const raw='\ufeffbefore😀\r\n\r| H $x+1$ | H $x+1$ |\n| --- | --- |\r\n| 😀a\\| $x+1$ then $x+1$ | 😀b\\| $x+1$ |\n\nafter';
const source='before😀\n\n| H $x+1$ | H $x+1$ |\n| --- | --- |\n| 😀a\\| $x+1$ then $x+1$ | 😀b\\| $x+1$ |\n\nafter';
const host=(cell:string)=>`[data-live-cell="${cell}"]`;
const boot=(page:Page,text:string)=>page.evaluate(text=>(window as any).boot(text),text);
const state=(page:Page)=>page.evaluate(()=>(window as any).tableState());
const bytes=(page:Page)=>page.evaluate(()=>(window as any).bytes());
const command=(page:Page,name:string,args?:unknown)=>page.evaluate(({name,args})=>(window as any).command(name,args),{name,args});
async function settle(page:Page) {
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
}
async function glyphPoint(page:Page,cell:string,formula:number,glyph:string,side:'before'|'after'='after') {
  return page.locator(`${host(cell)} .katex-html`).nth(formula).evaluate((element,{glyph,side})=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      const at=node.textContent!.indexOf(glyph);if(at<0) continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+glyph.length);
      const box=range.getBoundingClientRect();
      if(box.width>0&&box.height>0) return {x:box.left+box.width*(side==='before'?.1:.9),y:(box.top+box.bottom)/2};
    }
    throw new Error(`Missing rendered glyph ${glyph}`);
  },{glyph,side});
}
async function observeGesture(page:Page) {
  await page.evaluate(()=>{
    const api=window as any;api.tableMathEvents=[];
    for(const type of ['mousedown','mouseup','click']) document.addEventListener(type,event=>{
      api.tableMathEvents.push({type,prevented:event.defaultPrevented});
    });
  });
}
async function expectCaret(page:Page,cell:string,absolute:number,local:number) {
  await settle(page);
  expect((await state(page)).selection).toEqual({anchor:absolute,head:absolute});
  expect(await page.evaluate(cell=>(window as any).cellSelection(cell),cell)).toEqual({anchor:local,head:local,text:''});
  await expect(page.locator(`${host(cell)} .cm-content`)).toBeFocused();
}
async function expectInsertAndUndo(page:Page,original:string,text:string,at:number) {
  expect((await state(page)).snapshot.text).toBe(text);
  expect((await state(page)).commits).toBe(0);expect((await state(page)).status.canUndo).toBe(false);
  await page.keyboard.insertText('Z');
  expect((await state(page)).snapshot.text).toBe(text.slice(0,at)+'Z'+text.slice(at));
  expect((await state(page)).commits).toBe(1);
  await command(page,'undo');
  expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(original)));
  expect((await state(page)).status.canUndo).toBe(false);
}

// Independent full-document and mini-view positions include the astral prefix
// and the table's removed escape before each visible pipe.
for(const sample of [
  {name:'first header',cell:'0:0',formula:0,absolute:18,local:6},
  {name:'identical second header',cell:'0:1',formula:0,absolute:28,local:6},
  {name:'first body occurrence after escaped pipe',cell:'1:0',formula:0,absolute:58,local:9},
  {name:'second occurrence in the same body cell',cell:'1:0',formula:1,absolute:69,local:20},
  {name:'identical formula in another body cell',cell:'1:1',formula:0,absolute:83,local:9},
]) test(`table formula click maps ${sample.name} before native focus replaces the DOM`,async({page})=>{
  await boot(page,raw);await settle(page);
  const point=await glyphPoint(page,sample.cell,sample.formula,'1');await observeGesture(page);
  await page.mouse.click(point.x,point.y);
  await expectCaret(page,sample.cell,sample.absolute,sample.local);
  const events=await page.evaluate(()=>(window as any).tableMathEvents);
  expect(events.find((event:any)=>event.type==='mousedown')?.prevented).toBe(true);
  await test.info().attach('completed-table-formula-gesture',{contentType:'application/json',body:JSON.stringify(events,null,2)});
  await expectInsertAndUndo(page,raw,source,sample.absolute);
});

for(const sample of [
  {name:'fraction denominator',formula:'$\\frac{12}{34}+x^2$',glyph:'4',offset:13,local:18},
  {name:'superscript',formula:'$x^{12}+y$',glyph:'2',offset:6,local:11},
  {name:'Greek command',formula:'$\\alpha+1$',glyph:'α',offset:7,local:12},
  {name:'escaped pipe inside the formula',formula:'$a\\|b+1$',glyph:'1',offset:7,local:11},
] as const) test(`table formula maps the raw ${sample.name} boundary`,async({page})=>{
  const prefix='before😀\n\n| H |\n| --- |\n| 😀a\\| ';
  const text=prefix+sample.formula+' |\n\nafter';
  const original='\ufeff'+text.replaceAll('\n','\r\n');
  await boot(page,original);await settle(page);
  const point=await glyphPoint(page,'1:0',0,sample.glyph);await page.mouse.click(point.x,point.y);
  await expectCaret(page,'1:0',prefix.length+sample.offset,sample.local);
  await expectInsertAndUndo(page,original,text,prefix.length+sample.offset);
});

test('a formula click transfers an existing mini editor without first mirroring its zero caret',async({page})=>{
  await boot(page,raw);await page.locator(host('1:0')).click();await settle(page);
  const point=await glyphPoint(page,'1:1',0,'1');await page.mouse.click(point.x,point.y);
  await expectCaret(page,'1:1',83,9);
  await expect(page.locator(`${host('1:0')} .cm-content`)).toHaveCount(0);
  await expectInsertAndUndo(page,raw,source,83);
});

test('modified, non-primary and canceled mousedown leave the formula mapping untouched',async({page})=>{
  await boot(page,raw);await settle(page);const point=await glyphPoint(page,'1:0',1,'1');
  const result=await page.locator(`${host('1:0')} .katex-html`).nth(1).evaluate((element,point)=>{
    const api=window as any,before=api.tableState().selection;
    const options=[{button:1},{button:2},{shiftKey:true},{ctrlKey:true},{altKey:true},{metaKey:true}];
    const events=options.map(options=>new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:point.x,clientY:point.y,...options}));
    const canceled=new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:point.x,clientY:point.y});canceled.preventDefault();events.push(canceled);
    for(const event of events) element.dispatchEvent(event);
    return {before,after:api.tableState().selection,prevented:events.map(event=>event.defaultPrevented),connected:element.isConnected};
  },point);
  expect(result.after).toEqual(result.before);expect(result.connected).toBe(true);
  expect(result.prevented).toEqual([false,false,false,false,false,false,true]);
  expect((await state(page)).commits).toBe(0);
});

test('an unmapped cell click and keyboard host focus keep their ordinary behavior',async({page})=>{
  await boot(page,raw);
  await page.locator(host('1:0')).focus();
  await expectCaret(page,'1:0',48,0);
  await page.locator(host('0:1')).click();
  await expect(page.locator(`${host('0:1')} .cm-content`)).toBeFocused();
  expect((await state(page)).commits).toBe(0);expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('formula mapping does not steal focus from table search projections',async({page})=>{
  await boot(page,raw);await page.evaluate(()=>(window as any).tablePanel());
  const input=page.locator('.cm-search input[name="search"]');
  await input.fill('x+1');await input.press('ArrowRight');await input.press('Enter');await settle(page);
  await expect(input).toBeFocused();await expect(page.locator('.cm-table-search-hit')).not.toHaveCount(0);
  expect((await state(page)).commits).toBe(0);expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('clicking another cell formula during composition retains the marked mini editor',async({page})=>{
  await boot(page,raw);await page.locator(host('1:0')).click();await page.evaluate(()=>(window as any).tableCompose());
  const before=(await state(page)).selection,point=await glyphPoint(page,'1:1',0,'1');
  await page.mouse.click(point.x,point.y);await settle(page);
  expect(await page.evaluate(()=>(window as any).markedDOM===document.querySelector('[data-live-cell="1:0"] .cm-content'))).toBe(true);
  await expect(page.locator(`${host('1:0')} .cm-content`)).toBeFocused();
  await expect(page.locator(`${host('1:1')} .cm-content`)).toHaveCount(0);
  expect((await state(page)).selection).toEqual(before);expect((await state(page)).status.composing).toBe(true);
  expect((await state(page)).commits).toBe(0);
  await page.evaluate(()=>(window as any).tableEndCompose());
  await expect.poll(async()=>(await state(page)).commits).toBe(1);
  await command(page,'undo');expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('a table formula cannot take focus from a composing root editor',async({page})=>{
  await boot(page,raw);
  await page.evaluate(()=>{
    const view=(window as any).session.view;view.focus();
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  });
  const before=(await state(page)).selection,point=await glyphPoint(page,'1:0',1,'1');
  await page.mouse.click(point.x,point.y);await settle(page);
  expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
  await expect(page.locator('.cm-live-table .cm-content')).toHaveCount(0);
  expect((await state(page)).selection).toEqual(before);expect((await state(page)).status.composing).toBe(true);
  await page.evaluate(()=>(window as any).session.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await expect.poll(async()=>(await state(page)).status.composing).toBe(false);
  expect((await state(page)).commits).toBe(0);expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('read-only formula clicks preserve source and the root history',async({page})=>{
  await boot(page,raw);await command(page,'setReadOnly',{value:true});await settle(page);
  const point=await glyphPoint(page,'1:0',1,'1');await observeGesture(page);await page.mouse.click(point.x,point.y);await settle(page);
  await page.keyboard.insertText('Z');
  expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(raw)));
  expect((await state(page)).status.readOnly).toBe(true);expect((await state(page)).commits).toBe(0);
  expect((await state(page)).status.canUndo).toBe(false);
  expect(await page.evaluate(()=>(window as any).tableMathEvents.find((event:any)=>event.type==='mousedown').prevented)).toBe(false);
});
