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
test.afterEach(async({page},info)=>{
  await info.attach('projection.json',{body:JSON.stringify(await page.evaluate(()=>{
    const s=(window as any).nativeTransport?.session;
    return {source:s?.snapshot(),selection:s?.selection(),lines:Array.from(document.querySelectorAll('#editor .cm-line'),el=>{
      const css=getComputedStyle(el);
      return {text:el.textContent,classes:el.className,height:el.getBoundingClientRect().height,font:css.fontSize,background:css.backgroundColor,bottom:css.borderBottomWidth};
    })};
  }),null,2),contentType:'application/json'});
  if(info.status!==info.expectedStatus) await info.attach('projection.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  expect(errors.get(page)).toEqual([]);
});
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const boot=async(page:Page,text:string,mode='live')=>{
  await page.evaluate(({text,mode})=>(window as any).bootNative(text,{},mode),{text,mode});await settle(page);
};
const select=async(page:Page,pos:number)=>{await page.evaluate(p=>(window as any).nativeSelect(p),pos);await settle(page);};
// Resolve source positions through the mounted view, then inspect real line boxes.
const line=(page:Page,pos:number)=>page.evaluate(pos=>{
  const view=(window as any).nativeTransport.session.view;
  const node=view.domAtPos(pos).node;
  const el=(node.nodeType===Node.ELEMENT_NODE?node:node.parentElement).closest('.cm-line') as HTMLElement;
  const css=getComputedStyle(el);
  return {classes:el.className,height:el.getBoundingClientRect().height,font:css.fontSize,background:css.backgroundColor,bottom:css.borderBottomWidth};
},pos);
const bytes=(page:Page)=>page.evaluate(()=>(window as any).nativeBytes());

for(const fence of ['```','~~~']) test(`IA01 ${fence} Enter at unclosed EOF keeps code styling through leave and blur`,async({page})=>{
  const source=`lead\n\n${fence}\na`;await boot(page,source);await select(page,source.length);
  const body=await line(page,source.length);
  await page.keyboard.press('Enter');await settle(page);
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source+'\n');
  const original=await bytes(page);
  const assertEOF=async()=>{
    const eof=await line(page,source.length+1);
    expect.soft(eof.classes).toContain('cm-live-code-last');
    expect.soft(eof.classes).not.toContain('cm-live-code-delimiter');
    expect.soft(eof.font).toBe(body.font);
    expect.soft(eof.background).toBe(body.background);
    expect.soft(eof.bottom).toBe('1px');
    expect.soft(eof.height).toBeGreaterThan(10);
  };
  await assertEOF();
  await select(page,0);await assertEOF();
  await page.locator('#editor .cm-content').evaluate(el=>(el as HTMLElement).blur());await settle(page);await assertEOF();
  expect(await bytes(page)).toEqual(original);
});

for(const [opening,body] of [['```','~~~'],['````','```'],['~~~','```'],['```','``` literal']]) {
  test(`IA02 ${opening} preserves non-closing body ${body}`,async({page})=>{
    const source=`lead\n\n${opening}\n${body}`;await boot(page,source);await select(page,source.length);
    const active=await line(page,source.length),original=await bytes(page);
    await select(page,0);
    const inactive=await line(page,source.length);
    expect(inactive.classes).not.toContain('cm-live-code-delimiter');
    expect(inactive.font).toBe(active.font);
    expect(inactive.height).toBeCloseTo(active.height,1);
    await expect(page.locator('.cm-live-code').filter({hasText:body})).toHaveText(body);
    expect((await page.evaluate(()=>(window as any).nativeRender())).html).toContain(body);
    expect(await bytes(page)).toEqual(original);
  });
}

for(const [name,code] of [
  ['quote','> ```\n> a\n> ```'],
  ['list','- ```\n  a\n  ```'],
  ['quoted list','> - ```\n>   a\n>   ```'],
]) test(`IA03 ${name} real closing line collapses like a root fence`,async({page})=>{
  const root='lead\n\n```\na\n```';await boot(page,root);await select(page,0);
  const reference=await line(page,root.length);
  const source=`lead\n\n${code}`;await boot(page,source);await select(page,source.length);
  const active=await line(page,source.length),original=await bytes(page);
  expect(active.height).toBeGreaterThan(reference.height);
  await select(page,0);
  const inactive=await line(page,source.length);
  expect(inactive.classes).toContain('cm-live-code-delimiter');
  expect(inactive.font).toBe('0px');
  expect(inactive.height).toBeCloseTo(reference.height,1);
  expect(await bytes(page)).toEqual(original);
});

test('closed code retains consecutive blank body rows and leaves trailing root EOF ordinary',async({page})=>{
  const source='lead\n\n```\na\n\n\nb\n```\n';await boot(page,source);await select(page,0);
  const original=await bytes(page),body=await line(page,source.indexOf('a\n'));
  for(const pos of [12,13]) {
    const blank=await line(page,pos);
    expect(blank.classes).toContain('cm-live-code');
    expect(blank.classes).not.toContain('cm-live-code-delimiter');
    expect(blank.height).toBeCloseTo(body.height,1);
  }
  const eof=await line(page,source.length);
  expect(eof.classes).toContain('cm-live-blank');expect(eof.classes).not.toContain('cm-live-code');
  await page.evaluate(()=>(window as any).nativeCommand('setMode',{mode:'source'}));await settle(page);
  expect(await page.locator('[class*="cm-live-code"]').count()).toBe(0);
  for(const pos of [6,12,13,source.length]) expect((await line(page,pos)).height).toBeGreaterThan(10);
  expect(await bytes(page)).toEqual(original);
});
