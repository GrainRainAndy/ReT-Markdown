import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {rawCssPlugin,chromiumFallbackPath} from '../../scripts/web-tooling.mjs';

let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
  const result=await build({entryPoints:['web/test/acceptance-projection-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
  bundle=result.outputFiles[0].text;
  styles=(await Promise.all(['typography','palette','print'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
});
test.beforeEach(async({page})=>{
  const failures:string[]=[];errors.set(page,failures);
  page.on('pageerror',error=>failures.push(error.message));
  page.on('console',message=>{if(message.type()==='error') failures.push(message.text());});
  await page.setViewportSize({width:940,height:740});
  await page.setContent('<main id="editor"></main>');
  await page.addStyleTag({content:styles});
  await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});
  await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const boot=async(page:Page,text:string,mode='live')=>{
  await page.evaluate(({text,mode})=>(window as any).bootNative(text,{},mode),{text,mode});await settle(page);
};
const select=async(page:Page,pos:number)=>{await page.evaluate(p=>(window as any).nativeSelect(p),pos);await settle(page);};
const bytes=(page:Page)=>page.evaluate(()=>(window as any).nativeBytes());
const command=async(page:Page,name:string,args?:unknown)=>{await page.evaluate(({name,args})=>(window as any).nativeCommand(name,args),{name,args});await settle(page);};

// Actual DOM glyphs/line boxes determine mouse coordinates independently of CM.
const glyph=(page:Page,text:string)=>page.evaluate(text=>{
  const root=document.querySelector('#editor .cm-content')!;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()) {
    const at=node.textContent!.indexOf(text);if(at<0) continue;
    const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);
    const rect=range.getBoundingClientRect();
    if(rect.width&&rect.height) return {left:rect.left,top:rect.top,bottom:rect.bottom,width:rect.width};
  }
  return null;
},text);
const emptyRows=(page:Page)=>page.locator('#editor > .cm-editor > .cm-scroller > .cm-content .cm-line').evaluateAll(lines=>
  lines.filter(el=>!el.textContent?.trim()).map(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return {top:r.top,bottom:r.bottom,height:r.height,left:r.left+parseFloat(s.paddingLeft),padding:s.paddingLeft};
  }));
const paragraphGap=async(page:Page)=>{
  const a=(await page.locator('.cm-live-paragraph').filter({hasText:'Alpha'}).boundingBox())!;
  const b=(await page.locator('.cm-live-paragraph').filter({hasText:'Beta'}).boundingBox())!;
  return b.y-a.y-a.height;
};

test('ordinary paragraph baseline stays collapsed; each extra blank adds exactly one editable line',async({page})=>{
  await boot(page,'Alpha\n\nBeta\n\nTail');
  await page.evaluate(()=>(window as any).projectionReference());
  const a=(await page.locator('#reference p').filter({hasText:'Alpha'}).boundingBox())!;
  const b=(await page.locator('#reference p').filter({hasText:'Beta'}).boundingBox())!;
  const baseline=b.y-a.y-a.height;
  expect(await paragraphGap(page)).toBeCloseTo(baseline,1);
  const lineHeight=await page.locator('#editor .cm-scroller').evaluate(el=>parseFloat(getComputedStyle(el).lineHeight));
  for(const extra of [1,2,4]) {
    const source='Alpha'+'\n'.repeat(extra+2)+'Beta\n\nTail';
    await boot(page,source);
    const original=await bytes(page);
    expect(await paragraphGap(page)).toBeCloseTo(baseline+extra*lineHeight,1);
    expect((await emptyRows(page)).filter(r=>r.height>1)).toHaveLength(extra);
    await select(page,7);
    const active=await paragraphGap(page);
    await select(page,source.length);
    expect(await paragraphGap(page)).toBeCloseTo(active,1);
    expect(await bytes(page)).toEqual(original);
  }
});

test('blank row caret shares the actual paragraph glyph left edge before and after leaving',async({page})=>{
  await boot(page,'Alpha\n\n\nBeta\n\nTail');
  const original=await bytes(page),left=(await glyph(page,'Alpha'))!.left;
  await select(page,7);
  const active=await page.evaluate(()=>(window as any).nativeTransport.session.view.coordsAtPos(7));
  expect(active.left).toBeCloseTo(left,1);
  await select(page,17);
  const row=(await emptyRows(page)).find(r=>r.height>1)!;
  expect(row,'extra row remains present').toBeTruthy();
  expect(row.left).toBeCloseTo(left,1);
  await page.mouse.click(left+1,(row.top+row.bottom)/2);await settle(page);
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection().head)).toBe(7);
  await page.keyboard.insertText('X');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('Alpha\n\nX\nBeta\n\nTail');
  await command(page,'undo');expect(await bytes(page)).toEqual(original);
});

test('selected structural LF stays visible and deletes with exact byte undo',async({page})=>{
  const raw='\ufeffAlpha\r\n\r\nBeta\n\nTail';await boot(page,raw);
  await page.evaluate(()=>(window as any).nativeSelect(6,7));await settle(page);
  const row=page.locator('#editor .cm-line.cm-live-blank');await expect(row).toHaveCount(1);
  expect((await row.boundingBox())!.height).toBeGreaterThan(1);
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection())).toEqual({anchor:6,head:7});
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('Alpha\nBeta\n\nTail');
  await command(page,'undo');expect(await bytes(page)).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('20px editor text keeps its 16px ordinary gap and adds 32px per extra row',async({page})=>{
  for(const [source,gap] of [['Alpha\n\nBeta\n\nTail',16],['Alpha\n\n\n\nBeta\n\nTail',80]] as const) {
    await boot(page,source);await command(page,'setZoom',{zoom:1.25});
    expect(await paragraphGap(page)).toBeCloseTo(gap,0);
  }
});

test('structural and terminal empty caret align while source/code/list/quote keep their own insets',async({page})=>{
  await boot(page,'Alpha\n\nBeta\n');
  const left=(await glyph(page,'Alpha'))!.left;
  for(const pos of [6,12]) {
    await select(page,pos);
    expect((await page.evaluate(p=>(window as any).nativeTransport.session.view.coordsAtPos(p),pos)).left).toBeCloseTo(left,1);
  }
  const source='Alpha\n\n\nBeta\n\n```\na\n\nb\n```\n\n- list\n\n  continuation\n\n> quote\n>\n> second\n\nTail';
  await boot(page,source,'source');
  expect(await page.locator('.cm-live-blank').count()).toBe(0);
  expect((await emptyRows(page)).every(r=>r.height>0&&r.padding==='6px')).toBe(true);
  await command(page,'setMode',{mode:'live'});
  expect(await page.locator('.cm-live-code').first().evaluate(el=>getComputedStyle(el).paddingLeft)).toBe('10px');
  expect(await page.locator('.cm-live-list').first().evaluate(el=>getComputedStyle(el).paddingLeft)).toBe('30px');
  await page.evaluate(()=>(window as any).projectionReference());
  const quote=(await page.locator('#editor .cm-live-quote').boundingBox())!;
  const reference=(await page.locator('#reference blockquote').boundingBox())!;
  expect(quote.height).toBeCloseTo(reference.height,1);
});

test('extra row remains clickable after scrolling and mode changes, with mixed EOL bytes undoable',async({page})=>{
  const source=Array.from({length:70},(_,i)=>`Paragraph ${i}\n\n\nNext ${i}\n\n`).join('')+'Tail';
  const raw='\ufeff'+source.split('\n').map((line,i,lines)=>line+(i===lines.length-1?'':['\r\n','\n','\r'][i%3])).join('');
  await boot(page,raw);
  const original=await bytes(page);
  for(const mode of ['source','live']) await command(page,'setMode',{mode});
  let target=await glyph(page,'Next 48');
  for(let i=0;i<100&&(!target||target.top<80||target.bottom>700);i++) {
    await page.evaluate(()=>window.scrollBy(0,350));await settle(page);
    target=await glyph(page,'Next 48');
  }
  expect(target).not.toBeNull();expect(target!.top).toBeGreaterThan(80);expect(target!.bottom).toBeLessThan(700);
  const before=(await glyph(page,'Paragraph 48'))!;
  const row=(await emptyRows(page)).find(r=>r.height>1&&r.top>before.bottom&&r.bottom<target!.top)!;
  expect(row).toBeTruthy();
  await page.mouse.click(target!.left+1,(row.top+row.bottom)/2);await settle(page);
  const at=source.indexOf('Next 48')-1;
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection().head)).toBe(at);
  await page.keyboard.insertText('Z');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.slice(0,at)+'Z'+source.slice(at));
  await command(page,'undo');expect(await bytes(page)).toEqual(original);
  const point=await glyph(page,'Next 48');
  await page.mouse.click(point!.left+point!.width*.1,(point!.top+point!.bottom)/2);
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection().head)).toBe(source.indexOf('Next 48'));
});
