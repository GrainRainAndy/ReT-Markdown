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


const raw='\ufeffbefore😀\r\n\r| A | B |\n| --- | --- |\r\n| $x^{2}$ | other |\n\nAfter';
const cell='[data-live-cell="1:0"]';
const boot=(page:Page)=>page.evaluate(raw=>(window as any).boot(raw),raw);
async function settle(page:Page) {await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function assertRendered(page:Page) {
  await settle(page);
  expect(await page.locator(`${cell} .cm-editor`).count()).toBe(0);
  await expect(page.locator(`${cell} .katex-html`)).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).bytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
  expect(await page.evaluate(()=>(window as any).tableState().commits)).toBe(0);
}
for(const exit of ['body click','Escape','outside focus'] as const) test(`table formula renders as soon as caret leaves via ${exit}`,async({page})=>{
  await boot(page);await page.locator(cell).click();
  await expect(page.locator(`${cell} .cm-content`)).toBeFocused();
  if(exit==='body click')await page.getByText('After',{exact:true}).click();
  else if(exit==='Escape')await page.keyboard.press('Escape');
  else {
    await page.evaluate(()=>{const b=document.createElement('button');b.id='outside';b.textContent='Outside';document.body.append(b);});
    await page.locator('#outside').click();
  }
  await assertRendered(page);
  if(exit==='outside focus')await expect(page.locator('#outside')).toBeFocused();
  else expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
});

test('the repainted formula reflects committed input and one root undo',async({page})=>{
  await boot(page);await page.locator(cell).click();
  await page.keyboard.press('Home');
  for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');
  await page.keyboard.insertText('7');
  expect(await page.evaluate(()=>(window as any).tableState().snapshot.text)).toContain('$x^{72}$');
  await page.getByText('After',{exact:true}).click();await settle(page);
  expect(await page.locator(`${cell} .cm-editor`).count()).toBe(0);
  await expect(page.locator(`${cell} annotation[encoding="application/x-tex"]`)).toHaveText('x^{72}');
  await page.evaluate(()=>(window as any).command('undo'));await settle(page);
  expect(await page.evaluate(()=>(window as any).bytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
  await page.getByText('After',{exact:true}).click();await settle(page);
  await expect(page.locator(`${cell} annotation[encoding="application/x-tex"]`)).toHaveText('x^{2}');
});

test('Tab leaving the last cell retires its editor before the next paint',async({page})=>{
  const text=raw.replace('| $x^{2}$ | other |','| other | $x^{2}$ |');
  await page.evaluate(text=>(window as any).boot(text),text);
  const last='[data-live-cell="1:1"]';await page.locator(last).click();await page.keyboard.press('Tab');await settle(page);
  expect(await page.locator(`${last} .cm-editor`).count()).toBe(0);
  await expect(page.locator(`${last} .katex-html`)).toHaveCount(1);
  expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
  expect(await page.evaluate(()=>(window as any).bytes())).toEqual(Array.from(new TextEncoder().encode(text)));
});

test('blur retains marked DOM until composition finishes, then renders once',async({page})=>{
  await boot(page);await page.locator(cell).click();await page.evaluate(()=>(window as any).tableCompose());
  await page.evaluate(()=>{const b=document.createElement('button');b.id='outside';b.textContent='Outside';document.body.append(b);});
  await page.locator('#outside').click();await settle(page);
  expect(await page.evaluate(()=>(window as any).markedDOM===document.querySelector('[data-live-cell="1:0"] .cm-content'))).toBe(true);
  expect(await page.evaluate(()=>(window as any).tableState().commits)).toBe(0);
  await page.evaluate(()=>{
    const api=window as any;api.tableRepaints=[];
    const host=document.querySelector('[data-live-cell="1:0"]')!;
    const observer=new MutationObserver(()=>{
      if(!host.querySelector('.cm-editor')&&host.querySelector('.katex-html'))api.tableRepaints.push(host.textContent);
    });
    observer.observe(host,{childList:true,subtree:true});api.tableRepaintObserver=observer;
  });
  await page.evaluate(()=>(window as any).tableEndCompose());await settle(page);
  expect(await page.locator(`${cell} .cm-editor`).count()).toBe(0);
  await expect(page.locator(`${cell} .katex-html`)).toHaveCount(1);
  await expect(page.locator(cell)).toContainText('中');
  const repaints:string[]=await page.evaluate(()=>{const api=window as any;api.tableRepaintObserver.disconnect();return api.tableRepaints;});
  expect(repaints.length).toBeGreaterThan(0);
  expect(repaints.every(text=>text.includes('中')),'the first repaint must include committed composition text').toBe(true);
  expect(await page.evaluate(()=>(window as any).tableState().commits)).toBe(1);
  await expect(page.locator('#outside')).toBeFocused();
  await page.evaluate(()=>(window as any).command('undo'));
  expect(await page.evaluate(()=>(window as any).bytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
});

test('dismissing a settled cell menu to an outside control restores math without stealing focus',async({page})=>{
  await boot(page);await page.locator(cell).click();await page.locator(cell).click({button:'right'});await settle(page);
  await expect(page.getByRole('menu')).toBeVisible();
  await page.evaluate(()=>{const b=document.createElement('button');b.id='outside';b.textContent='Outside';document.body.append(b);});
  await page.locator('#outside').click();await assertRendered(page);
  await expect(page.getByRole('menu')).toHaveCount(0);await expect(page.locator('#outside')).toBeFocused();
});
