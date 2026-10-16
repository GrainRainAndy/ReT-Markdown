import {test,expect} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
let bundle:string,styles:string;
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
 const result=await build({entryPoints:['web/test/acceptance-table-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
 bundle=result.outputFiles[0].text;
 styles=(await Promise.all(['typography','palette'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
});
test.beforeEach(async({page})=>{
 await page.setContent('<!doctype html><html><body><main></main></body></html>');
 await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle});
});
const raw='\ufeffbefore😀\r\n\r| A | B |\n| --- | ---: |\r\n| left | right |\n\nafter';

for(const query of ['---:','|','A | B','left | right','---: |\n| left']) test(`F07 table source selection reveals ${JSON.stringify(query)} without editing`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(t=>(window as any).boot(t),raw);
 const original=await page.evaluate(()=>(window as any).bytes());
 await page.evaluate(q=>(window as any).command('find',{query:q}),query);
 expect(await page.evaluate(()=>{const s=(window as any).session;return s.state.sliceDoc(s.state.selection.main.from,s.state.selection.main.to);})).toBe(query);
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 expect(await page.locator('#editor > .cm-editor > .cm-scroller > .cm-content').innerText()).toContain(query);
 expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(0);
 expect(await page.evaluate(()=>(window as any).session.status().canUndo)).toBe(false);
 await page.evaluate(()=>(window as any).command('find',{query:'after'}));
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);expect(errors).toEqual([]);
});

test('F07 actual panel finds separator, retains focus, and restores cell projection on next query',async({page})=>{
 await page.evaluate(t=>(window as any).boot(t),raw);
 await page.evaluate(()=>(window as any).tablePanel());
 const input=page.locator('.cm-search input[name="search"]');
 await input.fill('---:');await input.press('ArrowRight');await input.press('Enter');
 await expect(input).toBeFocused();await expect(page.locator('.cm-live-table')).toHaveCount(0);
 expect(await page.locator('#editor > .cm-editor > .cm-scroller > .cm-content').innerText()).toContain('---:');
 await input.fill('right');await input.press('ArrowRight');await input.press('Enter');
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
 await expect(page.locator('[data-live-cell="1:1"] .cm-table-search-hit')).toHaveText('right');
 await expect(input).toBeFocused();expect(await page.evaluate(()=>(window as any).commits.length)).toBe(0);
});

test('F07 revealed alignment can be replaced and undone with original BOM and mixed EOL bytes',async({page})=>{
 await page.evaluate(t=>(window as any).boot(t),raw);
 const original=await page.evaluate(()=>(window as any).bytes());
 await page.evaluate(()=>(window as any).command('find',{query:'---:'}));
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await page.evaluate(()=>(window as any).command('replace',{query:'---:',replacement:':---:'}));
 expect(await page.evaluate(()=>(window as any).session.snapshot().text)).toContain('| --- | :---: |');
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(1);
 await page.evaluate(()=>(window as any).command('undo'));
 expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);
 await page.evaluate(()=>(window as any).command('find',{query:'after'}));
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
});

test('F07 selecting across the table boundary reveals the source and caret exit restores widget',async({page})=>{
 await page.evaluate(t=>(window as any).boot(t),raw);
 await page.evaluate(()=>{const a=window as any,t=a.session.snapshot().text;a.select(t.indexOf('before'),t.indexOf('right')+2);});
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 expect(await page.locator('#editor > .cm-editor > .cm-scroller > .cm-content').innerText()).toContain('| --- | ---: |');
 await page.evaluate(()=>{const a=window as any;a.select(a.session.state.doc.length);});
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
});

test('F07 moving the caret into a found separator keeps raw syntax editable until exit',async({page})=>{
 await page.evaluate(t=>(window as any).boot(t),raw);
 const original=await page.evaluate(()=>(window as any).bytes());
 await page.evaluate(()=>(window as any).command('find',{query:'---:'}));
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await page.evaluate(()=>(window as any).session.view.focus());
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await page.keyboard.type(':');
 expect(await page.evaluate(()=>(window as any).session.snapshot().text)).toContain('| --- | :---: |');
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await page.evaluate(()=>(window as any).command('undo'));
 expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);
 await page.evaluate(()=>{const a=window as any;a.select(a.session.state.doc.length);});
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
});

for(const origin of ['command','panel']) test(`F07 ${origin} cross-cell selection collapse hands typing to the mapped cell caret`,async({page})=>{
 const text='before😀\n\n| A | B |\n| --- | ---: |\n| left | right |\n\nafter';
 await page.evaluate(t=>(window as any).boot(t),text);
 const original=await page.evaluate(()=>(window as any).bytes());
 if(origin==='panel') {
  await page.evaluate(()=>(window as any).tablePanel());
  const input=page.locator('.cm-search input[name="search"]');
  await input.fill('left | right');await input.press('ArrowRight');await input.press('Enter');
  await expect(page.locator('.cm-live-table')).toHaveCount(0);
  await input.press('Escape');
 } else {
  await page.evaluate(()=>(window as any).command('find',{query:'left | right'}));
  await expect(page.locator('.cm-live-table')).toHaveCount(0);
  await page.evaluate(()=>(window as any).session.view.focus());
 }
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('[data-live-cell="1:0"] .cm-content')).toBeFocused();
 await page.keyboard.type('X');
 expect(await page.evaluate(()=>(window as any).session.snapshot().text)).toBe('before😀\n\n| A | B |\n| --- | ---: |\n| Xleft | right |\n\nafter');
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(1);
 await page.evaluate(()=>(window as any).command('undo'));
 expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);
});

for(const count of [80,160,200]) test(`F07 separator find across ${count} paragraphs scrolls the revealed syntax into the viewport`,async({page})=>{
 const text=Array.from({length:count},(_,i)=>`para ${i}\n`).join('\n')+'before\n\n| A | B |\n| --- | ---: |\n| left | right |\n\nafter';
 await page.evaluate(t=>(window as any).boot(t),text);
 await page.evaluate(()=>(window as any).tablePanel());
 const input=page.locator('.cm-search input[name="search"]');
 await input.fill('---:');await input.press('ArrowRight');await input.press('Enter');
 await expect(input).toBeFocused();await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await expect(page.locator('.cm-searchMatch-selected')).toHaveText('---:');
 await expect(page.locator('.cm-searchMatch-selected')).toBeInViewport();
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(0);
});

for(const [name,left,right] of [['no edge pipes','',''],['no leading pipe','',' |'],['no trailing pipe','| ','']] as const)
 test(`F07 mapped caret keeps explicit Tab exits for ${name}`,async({page})=>{
  const text=`before\n\n${left}A | B${right}\n${left}--- | ---${right}\n${left}left | right${right}\n\nafter`;
  await page.evaluate(t=>(window as any).boot(t),text);
  const original=await page.evaluate(()=>(window as any).bytes());
  await page.locator('[data-live-cell="0:0"]').click();await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
  expect(await page.evaluate(()=>(window as any).session.selection().head)).toBe(text.indexOf(`${left}A | B`));
  await page.locator('[data-live-cell="1:1"]').click();await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
  expect(await page.evaluate(()=>(window as any).session.selection().head)).toBe(text.indexOf('\n\nafter'));
  expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);
  expect(await page.evaluate(()=>(window as any).commits.length)).toBe(0);
 });

test('F07 source collapse at a pipe-less header start still hands off to its visible caret',async({page})=>{
 const text='before\n\nA | B\n--- | ---\nleft | right\n\nafter';
 await page.evaluate(t=>(window as any).boot(t),text);
 await page.evaluate(()=>(window as any).command('find',{query:'A | B'}));
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await page.evaluate(()=>(window as any).session.view.focus());await page.keyboard.press('ArrowLeft');
 await expect(page.locator('[data-live-cell="0:0"] .cm-content')).toBeFocused();
 await page.keyboard.type('X');
 expect(await page.evaluate(()=>(window as any).session.snapshot().text)).toBe('before\n\nXA | B\n--- | ---\nleft | right\n\nafter');
});
