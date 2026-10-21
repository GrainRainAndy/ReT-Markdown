import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {rawCssPlugin,chromiumFallbackPath} from '../../scripts/web-tooling.mjs';

let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
  const result=await build({entryPoints:['web/test/final-live-browser-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
  bundle=result.outputFiles[0].text;
  styles=(await Promise.all(['typography','palette','print'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
  styles+=(await readFile('node_modules/katex/dist/katex.min.css','utf8')).replace(/@font-face\{[^}]*\}/g,'');
});
test.beforeEach(async({page})=>{
  const failures:string[]=[];errors.set(page,failures);page.on('pageerror',error=>failures.push(error.message));
  await page.setContent('<main id="editor"></main>');await page.addStyleTag({content:styles});
  await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});
  await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});


for(const mode of ['live','source'] as const)test(`${mode} ordinary Enter uses its own paragraph semantics and byte-exact undo`,async({page})=>{
  const text='Alpha first paragraph.\n\nBeta second paragraph.\n\nGamma last paragraph.';
  const raw='\ufeff'+text.replaceAll('\n','\r\n');
  await page.evaluate(({raw,mode})=>(window as any).bootNative(raw,{},mode),{raw,mode});
  await page.evaluate(()=>(window as any).nativeSelect(5));await page.keyboard.press('Enter');
  const inserted=mode==='live'?'\n\n':'\n';const split=text.slice(0,5)+inserted+text.slice(5);
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(split);
  await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
  await page.evaluate(()=>(window as any).nativeCommand('redo'));
  await page.keyboard.insertText('NEW');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(split.slice(0,5+inserted.length)+'NEW'+split.slice(5+inserted.length));
  await page.getByText('Gamma last paragraph.',{exact:true}).click();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  if(mode==='live') {
    await expect(page.locator('.cm-live-paragraph')).toHaveCount(4);
    await expect(page.getByText('Alpha',{exact:true})).toBeVisible();
    await expect(page.getByText('NEW first paragraph.',{exact:true})).toBeVisible();
  }
});

test('Enter after indented prose continuation starts another paragraph, not a code block',async({page})=>{
  const text='Alpha\n    Beta\n\nGamma',raw='\ufeff'+text.replaceAll('\n','\r\n');
  await page.evaluate(raw=>(window as any).bootNative(raw),raw);
  const at=text.indexOf('Beta')+4;await page.evaluate(at=>(window as any).nativeSelect(at),at);
  await page.keyboard.press('Enter');await page.keyboard.insertText('NEW');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(text.slice(0,at)+'\n\nNEW'+text.slice(at));
  await page.getByText('Gamma',{exact:true}).click();
  await expect(page.locator('.cm-live-paragraph').filter({hasText:/^NEW$/})).toBeVisible();
  expect((await page.evaluate(()=>(window as any).nativeRender())).html).not.toContain('<pre');
  await page.evaluate(()=>(window as any).nativeCommand('undo'));await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
});
