import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';

let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
  const output=await build({entryPoints:['web/test/final-live-browser-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
  bundle=output.outputFiles[0].text;
  styles=(await Promise.all(['typography','palette','print'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
});
test.beforeEach(async({page})=>{
  const list:string[]=[];errors.set(page,list);page.on('pageerror',e=>list.push(e.message));
  await page.setContent('<main></main>');await page.addStyleTag({content:styles});
  await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});
  await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
const boot=(page:Page,text:string,mode='live')=>page.evaluate(({text,mode})=>(window as any).bootNative(text,{},mode),{text,mode});
const command=(page:Page,name:string,args?:unknown)=>page.evaluate(({name,args})=>(window as any).nativeCommand(name,args),{name,args});
const selected=(page:Page)=>page.evaluate(()=>(window as any).nativeTransport.session.selection());

for(const mode of ['live','source']) test(`AC1 loaded ${mode} document accepts immediate keyboard input without a click`,async({page})=>{
  await boot(page,'',mode);
  await page.keyboard.type('abc');
  await expect.poll(()=>page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('abc');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.view.hasFocus)).toBe(true);
  expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.type==='commit').length)).toBeGreaterThan(0);
});

test('AC6 menu-equivalent next/previous commands use the query last edited in the keyboard panel',async({page})=>{
  await boot(page,'alpha beta alpha beta');
  await command(page,'find',{query:'alpha'});expect(await selected(page)).toEqual({anchor:0,head:5});
  await command(page,'find');
  const input=page.locator('.cm-search input[name="search"]');
  await input.fill('beta');await input.press('ArrowRight');
  await command(page,'find',{backwards:false});expect(await selected(page)).toEqual({anchor:6,head:10});
  await command(page,'find',{backwards:false});expect(await selected(page)).toEqual({anchor:17,head:21});
  await command(page,'find',{backwards:true});expect(await selected(page)).toEqual({anchor:6,head:10});
  expect(await input.inputValue()).toBe('beta');
  expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.type==='commit'))).toEqual([]);
});

test('AC6 menu replace-all uses the same panel replacement and one root undo',async({page})=>{
  const raw='\ufeff**alpha**\r\nalpha\r尾';await boot(page,raw);
  const original=await page.evaluate(()=>(window as any).nativeBytes());
  await command(page,'find',{query:'alpha',replacement:'old'});await command(page,'find');
  const replacement=page.locator('.cm-search input[name="replace"]');
  await replacement.fill('新');await replacement.press('ArrowRight');
  await command(page,'replaceAll');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('**新**\n新\n尾');
  await command(page,'undo');expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(original);
});

test('AC6 keyboard and menu-equivalent find/replace keep one panel and query',async({page})=>{
  await boot(page,'alpha beta alpha');
  await page.keyboard.press('Meta+f');
  const input=page.locator('.cm-search input[name="search"]');
  await input.fill('alpha');await input.press('ArrowRight');
  await page.evaluate(()=>{(window as any).originalSearchPanel=document.querySelector('.cm-search');});
  await page.keyboard.press('Meta+g');expect(await selected(page)).toEqual({anchor:0,head:5});
  await command(page,'find',{backwards:false});expect(await selected(page)).toEqual({anchor:11,head:16});
  await command(page,'find');expect(await input.inputValue()).toBe('alpha');
  await command(page,'replace');await expect(page.locator('.cm-search input[name="replace"]')).toBeFocused();
  expect(await page.evaluate(()=>document.querySelector('.cm-search')===(window as any).originalSearchPanel)).toBe(true);
  await expect(page.locator('.cm-search')).toHaveCount(1);
});

for(const origin of ['bridge','panel']) test(`AC6 ${origin} Replace All remains separate from immediately following typing`,async({page})=>{
  const raw='\ufeffalpha alpha\r\n尾';await boot(page,raw);
  const original=await page.evaluate(()=>(window as any).nativeBytes());
  await command(page,'find',{query:'alpha'});await command(page,'find');
  const replacement=page.locator('.cm-search input[name="replace"]');
  await replacement.fill('新');await replacement.press('ArrowRight');
  if(origin==='bridge') await command(page,'replaceAll');
  else {
    await page.locator('.cm-search button[name="replaceAll"]').click();
  }
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('新 新\n尾');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.view.hasFocus)).toBe(true);
  await page.keyboard.type('!');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('! 新\n尾');
  await command(page,'undo');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('新 新\n尾');
  await command(page,'undo');expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(original);
});

test('AC6 Replace All is isolated from both preceding and following typing',async({page})=>{
  const raw='\ufeffalpha\r\nalpha\rend';await boot(page,raw);
  const original=await page.evaluate(()=>(window as any).nativeBytes());
  await page.keyboard.type('?');
  await command(page,'find',{query:'alpha'});await command(page,'find');
  const replacement=page.locator('.cm-search input[name="replace"]');
  await replacement.fill('X');await replacement.press('ArrowRight');
  await command(page,'replaceAll');await page.keyboard.press('Escape');await page.keyboard.type('Y');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('Y\nX\nend?');
  await command(page,'undo');expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('X\nX\nend?');
  await command(page,'undo');expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('alpha\nalpha\nend?');
  await command(page,'undo');expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(original);
});

for(const raw of ['', '# Heading\n\nbody\n'.repeat(80)]) test(`AC8 system dark canvas is continuous for ${raw?'long':'empty'} documents`,async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});await boot(page,raw);await command(page,'setAppearance',{appearance:'system'});
  const result=await page.evaluate(()=>{
    const elements=[document.body,document.querySelector('.markdown-body')!,document.querySelector('.cm-editor')!];
    return elements.map(e=>getComputedStyle(e).backgroundColor);
  });
  expect(result).toEqual(['rgb(30, 30, 30)','rgb(30, 30, 30)','rgb(30, 30, 30)']);
  const before=await page.evaluate(()=>(window as any).nativeBytes());
  await page.emulateMedia({colorScheme:'light'});await command(page,'setAppearance',{appearance:'system'});
  await expect(page.locator('.cm-editor').first()).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(before);
});

test('AC9 real root editor scroller uses the 1.6 body line height',async({page})=>{
  await boot(page,'ordinary body\n\nend');
  const height=await page.locator('.cm-scroller').first().evaluate(e=>{const s=getComputedStyle(e);return parseFloat(s.lineHeight)/parseFloat(s.fontSize);});
  expect(height).toBeCloseTo(1.6,3);
});
