import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
 const result=await build({entryPoints:['web/test/acceptance-table-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
 bundle=result.outputFiles[0].text;styles=(await Promise.all(['typography','palette'].map(name=>readFile(`web/styles/${name}.css`,'utf8')))).join('\n');
});
test.beforeEach(async({page})=>{
 const failures:string[]=[];errors.set(page,failures);page.on('pageerror',e=>failures.push(e.stack??e.message));page.on('console',e=>{if(e.type()==='error')failures.push(e.text());});
 await page.setContent('<main></main>');await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
const boot=(page:Page,text:string)=>page.evaluate(t=>(window as any).boot(t),text);
const state=(page:Page)=>page.evaluate(()=>(window as any).tableState());
const bytes=(page:Page)=>page.evaluate(()=>(window as any).bytes());
const command=(page:Page,name:string,args?:unknown)=>page.evaluate(({name,args})=>(window as any).command(name,args),{name,args});
const cell='[data-live-cell="1:0"]';
const raw='\ufeffbefore😀\r\n\r| A | B |\n| - | - |\r\n| 😀a\\|右 | 右 |\n\nafter';

test('AC5 root find projects visible selected hit with raw escape/astral offsets and no history',async({page})=>{
 await boot(page,raw);const original=await bytes(page);
 await page.evaluate(()=>(window as any).tableFind('右'));
 await expect(page.locator(`${cell} .cm-content`)).toBeVisible();
 expect(await page.evaluate(()=>(window as any).cellSelection('1:0'))).toEqual({anchor:4,head:5,text:'右'});
 await expect(page.locator(`${cell} .cm-table-search-hit`)).toHaveText('右');
 await expect(page.locator(`${cell} .cm-table-search-hit`)).toHaveCSS('background-color','rgb(255, 224, 138)');
 expect((await state(page)).selection).toEqual({anchor:37,head:38});
 expect((await state(page)).commits).toBe(0);expect((await state(page)).status.canUndo).toBe(false);expect(await bytes(page)).toEqual(original);
 await command(page,'find',{query:'\\|右'});
 expect(await page.evaluate(()=>(window as any).cellSelection('1:0'))).toEqual({anchor:3,head:5,text:'|右'});
 expect((await state(page)).selection).toEqual({anchor:35,head:38});
 await command(page,'find',{query:'|右'});
 expect(await page.evaluate(()=>(window as any).cellSelection('1:0'))).toEqual({anchor:3,head:5,text:'|右'});
 expect((await state(page)).selection).toEqual({anchor:36,head:38});
 await command(page,'find',{query:'😀a'});
 expect(await page.evaluate(()=>(window as any).cellSelection('1:0'))).toEqual({anchor:0,head:3,text:'😀a'});
 expect(await bytes(page)).toEqual(original);
});

test('AC5 actual search panel stays usable across next/previous/query changes',async({page})=>{
 await boot(page,raw);await page.evaluate(()=>(window as any).tablePanel());
 const input=page.locator('.cm-search input[name="search"]');await input.fill('右');await input.press('ArrowRight');await input.press('Enter');
 await expect(page.locator(`${cell} .cm-table-search-hit`)).toHaveText('右');await expect(input).toBeFocused();
 await input.press('Enter');await expect(page.locator('[data-live-cell="1:1"] .cm-table-search-hit')).toHaveText('右');await expect(input).toBeFocused();
 await input.press('Shift+Enter');await expect(page.locator(`${cell} .cm-table-search-hit`)).toHaveText('右');await expect(input).toBeFocused();
 await input.fill('missing');await input.press('ArrowRight');await input.press('Enter');await expect(page.locator('.cm-table-search-hit')).toHaveCount(0);await expect(input).toBeFocused();
 expect((await state(page)).commits).toBe(0);
});

test('AC7 menu overlays without layout push, receives keyboard focus, arrows and Escape restore cell',async({page})=>{
 await boot(page,raw);await page.locator(cell).click();const before=await page.locator('#editor > .cm-editor').boundingBox();
 await page.locator(cell).click({button:'right'});const menu=page.getByRole('menu');await expect(menu).toBeVisible();
 expect((await page.locator('#editor > .cm-editor').boundingBox())!.height).toBe(before!.height);
 await expect(page.getByRole('menuitem').first()).toBeFocused();
 await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
 await page.keyboard.press('End');await expect(page.getByRole('menuitem').last()).toBeFocused();
 await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem').first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(page.locator(`${cell} .cm-content`)).toBeFocused();
 await page.locator(cell).click({button:'right'});await page.keyboard.press('Tab');
 await expect(menu).toHaveCount(0);await expect(page.locator(`${cell} .cm-content`)).toBeFocused();
 expect((await state(page)).commits).toBe(0);
});

test('AC7 outside click and action dismiss, source-mode destruction removes menu listeners',async({page})=>{
 await boot(page,raw);const original=await bytes(page);
 await page.evaluate(()=>{const b=document.createElement('button');b.id='outside';b.textContent='Outside';document.body.append(b);});
 await page.locator(cell).click({button:'right'});await page.locator('#outside').click();await expect(page.getByRole('menu')).toHaveCount(0);await expect(page.locator('#outside')).toBeFocused();
 await page.locator(cell).click({button:'right'});await page.getByRole('menuitem',{name:'Insert row below'}).click();await expect(page.getByRole('menu')).toHaveCount(0);
 expect((await state(page)).commits).toBe(1);expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
 await page.locator(cell).click({button:'right'});await command(page,'setMode',{mode:'source'});await expect(page.getByRole('menu')).toHaveCount(0);
 await page.locator('#outside').focus();await page.keyboard.press('Escape');await expect(page.locator('#outside')).toBeFocused();
});

test('AC5 replace and replaceAll remain root operations with byte-exact undo and usable panel',async({page})=>{
 await boot(page,raw);const original=await bytes(page);
 await command(page,'find',{query:'右'});await expect(page.locator(`${cell} .cm-table-search-hit`)).toHaveText('右');
 await command(page,'replace',{query:'右',replacement:'换'});expect((await state(page)).snapshot.text).toContain('😀a\\|换 | 右');
 expect((await state(page)).commits).toBe(1);await command(page,'undo');expect(await bytes(page)).toEqual(original);
 await command(page,'replaceAll',{query:'右',replacement:'换'});expect((await state(page)).snapshot.text).toContain('😀a\\|换 | 换');
 expect((await state(page)).commits).toBe(3);await command(page,'undo');expect(await bytes(page)).toEqual(original);
 expect((await state(page)).status.canRedo).toBe(true);
 await command(page,'find',{query:'右',backwards:true});expect((await state(page)).status.canRedo).toBe(true);
 await command(page,'setMode',{mode:'source'});await command(page,'setMode',{mode:'live'});expect(await bytes(page)).toEqual(original);
});

test('AC5 search updates during synthetic cell composition retain marked DOM and sole root commit',async({page})=>{
 await boot(page,raw);const original=await bytes(page);await page.locator(cell).click();
 await page.evaluate(()=>(window as any).tableCompose());
 await page.evaluate(()=>{const a=window as any;a.tableFind('右');});
 expect(await page.evaluate(()=>{const a=window as any;return a.markedDOM===document.querySelector('[data-live-cell="1:0"] .cm-content');})).toBe(true);
 expect((await state(page)).status.composing).toBe(true);expect((await state(page)).commits).toBe(0);expect(await bytes(page)).toEqual(original);
 await page.evaluate(()=>(window as any).tableEndCompose());await expect.poll(async()=>(await state(page)).commits).toBe(1);
 expect((await state(page)).snapshot.text).toContain('右中');await command(page,'undo');expect(await bytes(page)).toEqual(original);
});

test('AC7 keyboard action activation and deleting table restore root focus with no stale menu',async({page})=>{
 await boot(page,raw);const original=await bytes(page);await page.locator('[data-live-cell="0:0"]').click({button:'right'});
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect(page.getByRole('menu')).toHaveCount(0);await expect(page.locator('.cm-live-table')).toHaveCount(0);
 expect((await state(page)).snapshot.text).toBe('before😀\n\n\n\nafter');
 expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
});

test('AC5 a find hit deep inside a replaced table is scrolled into the visible viewport',async({page})=>{
 const text='| A |\n| - |\n'+Array.from({length:55},(_,i)=>`| ${i===50?'needle':'row '+i} |`).join('\n')+'\n\nend';
 await boot(page,text);await page.evaluate(()=>(window as any).tablePanel());
 const input=page.locator('.cm-search input[name="search"]');await input.fill('needle');await input.press('ArrowRight');await input.press('Enter');
 await expect(page.locator('[data-live-cell="51:0"] .cm-table-search-hit')).toBeInViewport();await expect(input).toBeFocused();
 expect((await state(page)).commits).toBe(0);
});

test('AC7 boundary Tab after root exit preserves source',async({page})=>{
 const text='before\n\n| A | B |\n| - | - |\n| C | D |\n\nafter';await boot(page,text);
 await page.locator('[data-live-cell="0:0"]').click();await page.keyboard.press('Shift+Tab');
 await page.locator('[data-live-cell="1:1"]').click();
 await expect(page.locator('[data-live-cell="1:1"] .cm-content')).toBeFocused();
 await page.keyboard.press('Tab');
 expect((await state(page)).snapshot.text).toBe(text);
});
