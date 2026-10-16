import { test, expect } from 'playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
let bundle:string;
let styles:string;
const errors = new WeakMap<object,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM || chromiumFallbackPath()}});
test.beforeAll(async()=>{
 const result=await build({entryPoints:['web/test/live-browser-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
 bundle=result.outputFiles[0].text;
 styles=(await Promise.all(['typography','palette','print'].map(name=>readFile(`web/styles/${name}.css`,'utf8')))).join('\n');
});
test.beforeEach(async({page})=>{
 const failures:string[]=[];errors.set(page,failures);
 page.on('pageerror',error=>failures.push(error.stack ?? error.message));
 page.on('console',message=>{if(message.type()==='error') failures.push(message.text());});
 await page.setContent('<main></main>'); await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
const boot=async(page:any,text:string)=>page.evaluate((t:string)=>(window as any).boot(t),text);
const select=async(page:any,p:number)=>page.evaluate((p:number)=>(window as any).select(p),p);
const snapshot=async(page:any)=>page.evaluate(()=>(window as any).snapshot());

test('real CM hides inactive markup and reveals active heading/inline/list/quote/code/math/image source',async({page})=>{
 const text='# Heading\n\n**bold** *italic* ~~gone~~ `code`\n\n- item\n\n> quote\n\n```js\nconst x=1\n```\n\n$x^2$\n\n![a](https://invalid.example/a.png)\n\nend';
 await boot(page,text);
 const root=page.locator('#editor > .cm-editor');
 await expect(root.locator('.cm-live-heading')).toHaveCount(1);
 await expect(root.locator('.cm-live-math')).toHaveCount(1);
 await expect(root.locator('.cm-live-image')).toHaveCount(1);
 expect(await root.innerText()).not.toContain('**bold**');
 for(const marker of ['# Heading','**bold**','*italic*','~~gone~~','`code`','- item','> quote','```js','$x^2$','![a]']) {
   await select(page,text.indexOf(marker)+1);
   await expect(root).toContainText(marker);
 }
 await select(page,text.length);
 await expect(root).not.toContainText('**bold**');
 expect((await snapshot(page)).text).toBe(text);
});

test('rendered cell edits project only cell patches; undo preserves exact BOM/EOL across modes',async({page})=>{
 const raw='\ufeffbefore\r\n\r| A | B |\n| - | - |\r\n| 😀a\\|b | `c\\|d` |\n\nafter';
 await boot(page,raw); const original=await snapshot(page);
 const cell=page.locator('[data-live-cell="1:0"]');
 await cell.click(); const editor=cell.locator('.cm-content');
 await editor.press('Meta+a'); await editor.press('Backspace'); await editor.press('x');
 await expect.poll(async()=>(await snapshot(page)).text).toContain('| x | `c\\|d` |');
 const commits=await page.evaluate(()=>(window as any).commits);
 expect(commits.every((c:any)=>c.patches.every((p:any)=>p.from>=original.text.indexOf('😀') && !p.insert.includes('\n')))).toBe(true);
 await editor.press('Meta+z');
 await editor.press('Meta+z');
 await page.evaluate(()=>(window as any).command('setMode',{mode:'source'}));
 const undone=await snapshot(page); expect({...undone,revision:0}).toEqual(original);
 await page.evaluate(()=>(window as any).command('setMode',{mode:'live'}));
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
});

test('Tab and Shift Tab navigate and leave without adding a row',async({page})=>{
 const text='before\n\n| A | B |\n| - | - |\n| C | D |\n\nafter'; await boot(page,text);
 await page.locator('[data-live-cell="0:0"]').click();
 await page.keyboard.press('Shift+Tab');
 expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
 await page.locator('[data-live-cell="1:1"]').click(); await page.keyboard.press('Tab');
 expect(await page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
 expect((await snapshot(page)).text).toBe(text);
 await page.locator('[data-live-cell="0:1"]').click(); await page.keyboard.press('Tab');
 await expect(page.locator('[data-live-cell="1:0"] .cm-content')).toBeFocused();
});

test('multiline paste is retained with visible source-mode guidance',async({page})=>{
 await boot(page,'| A |\n| - |\n| B |\n\nend'); await page.locator('[data-live-cell="1:0"]').click();
 await page.locator('[data-live-cell="1:0"] .cm-content').evaluate(el=>{
  const data=new DataTransfer();data.setData('text/plain','line1\nline2');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
 });
 await expect(page.locator('.cm-live-guidance')).toBeVisible();
 await expect(page.locator('.cm-live-rejected-input')).toHaveValue('line1\nline2');
 expect((await snapshot(page)).text).toBe('| A |\n| - |\n| B |\n\nend');
});

test('context row/column actions are atomic and undoable',async({page})=>{
 const text='before\n\n| A | B |\n| - | - |\n| C | D |\n\nafter';await boot(page,text);
 await page.locator('[data-live-cell="1:0"]').click({button:'right'});
 await page.getByRole('menuitem',{name:'Insert row below'}).click();
 expect((await snapshot(page)).text).toContain('| C | D |\n|  |  |');
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(1);
 await page.evaluate(()=>(window as any).command('undo'));
 expect((await snapshot(page)).text).toBe(text);
 await page.locator('[data-live-cell="1:0"]').click({button:'right'});
 await page.getByRole('menuitem',{name:'Insert column right'}).click();
 expect((await snapshot(page)).text).toContain('| A |  | B |');
 await page.evaluate(()=>(window as any).command('undo'));expect((await snapshot(page)).text).toBe(text);
});

test('synthetic root composition preserves the active marked text node; not native IME proof',async({page})=>{
 const text='# Heading\n\n$x$\n\nend';await boot(page,text);await select(page,4);
 const result=await page.evaluate(()=>{
  const s=(window as any).session, dom=s.view.contentDOM;
  const node=dom.querySelector('.cm-line')!.firstChild;
  dom.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  s.dispatch({changes:{from:4,insert:'中'},selection:{anchor:5},userEvent:'input.type.compose'});
  const same=node===dom.querySelector('.cm-line')!.firstChild;
  const before=s.snapshot().text;
  dom.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
  return {same,before};
 });
 expect(result).toEqual({same:true,before:text});
 await expect.poll(async()=>(await snapshot(page)).text).toContain('# He中ading');
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(1);
});

test('synthetic cell composition keeps DOM, defers mode and structural commands, commits once',async({page})=>{
 await boot(page,'| A |\n| - |\n| B |\n\nend');await page.locator('[data-live-cell="1:0"]').click();
 await page.locator('[data-live-cell="1:0"] .cm-content').evaluate(el=>{
  (window as any).marked=el;
  el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
 });
 await page.keyboard.insertText('中文');
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(0);
 await expect(page.locator('[data-live-cell="1:0"] .cm-content')).toBeFocused();
 expect(await page.locator('[data-live-cell="1:0"] .cm-content').evaluate(el=>el===(window as any).marked)).toBe(true);
 await page.evaluate(()=>{void (window as any).command('setMode',{mode:'source'});});
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
 await page.locator('[data-live-cell="1:0"] .cm-content').evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await expect.poll(async()=>(await snapshot(page)).text).toContain('中文');
 await expect(page.locator('#editor > .cm-editor')).toHaveAttribute('data-mode','source');
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(1);
 await page.evaluate(()=>(window as any).command('undo'));
 expect((await snapshot(page)).text).toBe('| A |\n| - |\n| B |\n\nend');
});

test('malformed tables remain editable source',async({page})=>{
 const text='| A | B |\n| - | - |\n| only |\n\nend';await boot(page,text);
 await expect(page.locator('.cm-live-table')).toHaveCount(0);
 await expect(page.locator('#editor')).toContainText('| only |');
});

test('cell preedit is provisional root source; queued undo runs after its single composition commit',async({page})=>{
 const text='| A |\n| - |\n| B |\n\nend';await boot(page,text);
 await page.locator('[data-live-cell="1:0"]').click();
 const cell=page.locator('[data-live-cell="1:0"] .cm-content');
 await cell.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
 await page.keyboard.insertText('中文');
 const status=await page.evaluate(()=>{
  const s=(window as any).session;
  return {provisional:s.getSource().text,barrier:s.barrier(),commits:(window as any).commits.length};
 });
 expect(status.provisional).toContain('中文');
 expect(status.barrier.snapshot.text).toBe(text);expect(status.barrier.composing).toBe(true);expect(status.commits).toBe(0);
 await page.evaluate(()=>{void (window as any).command('undo');});
 await cell.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await expect.poll(async()=>await page.evaluate(()=>(window as any).commits.length)).toBe(2);
 expect((await snapshot(page)).text).toBe(text);
});

test('cell structural command waits for preedit then edits the updated table once',async({page})=>{
 const text='| A | B |\n| - | - |\n| C | D |\n\nend';await boot(page,text);
 await page.locator('[data-live-cell="1:0"]').click();
 const cell=page.locator('[data-live-cell="1:0"] .cm-content');
 await cell.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
 await page.keyboard.insertText('中');
 // Dispatch directly to keep the synthetic marked-text focus; OS candidate behavior is a native gate.
 await page.locator('[data-live-cell="1:0"]').dispatchEvent('contextmenu');
 await page.getByRole('menuitem',{name:'Insert row below'}).dispatchEvent('click');
 expect((await snapshot(page)).text).toBe(text);
 await cell.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 await expect.poll(async()=>(await snapshot(page)).text).toContain('|  |  |');
 const commits=await page.evaluate(()=>(window as any).commits);
 expect(commits).toHaveLength(2);expect(commits[0].patches[0].insert).toContain('中');
 await page.evaluate(()=>(window as any).command('undo'));
 expect((await snapshot(page)).text).toContain('中');
 await page.evaluate(()=>(window as any).command('undo'));
 expect((await snapshot(page)).text).toBe(text);
});

test('mode change from a focused cell restores root focus and mapped selection',async({page})=>{
 const text='| A |\n| - |\n| 😀a\\|b |\n\nend';await boot(page,text);
 await page.locator('[data-live-cell="1:0"]').click();await page.keyboard.press('End');
 const selection=await page.evaluate(()=>(window as any).session.selection());
 await page.evaluate(()=>(window as any).command('setMode',{mode:'source'}));
 await expect.poll(async()=>page.evaluate(()=>(window as any).session.view.hasFocus)).toBe(true);
 expect(await page.evaluate(()=>(window as any).session.selection())).toEqual(selection);
});


test('live computed typography matches frozen F19 and renderer dark/print variables',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});
 const text='# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n> quote\n\n[link](https://example.com) and `code`\n\n| A | B |\n| - | - |\n| C | D |\n\nend';
 await boot(page,text);
 const headings=await page.locator('.cm-live-heading').evaluateAll(elements=>elements.map(el=>{
  const s=getComputedStyle(el);return {font:s.fontSize,line:s.lineHeight,top:s.marginTop,bottom:s.marginBottom,border:s.borderBottomWidth,color:s.borderBottomColor};
 }));
 expect(headings.map(h=>h.font)).toEqual(['36px','28px','24px','20px','16px','16px']);
 for(const [i,ratio] of [1.2,1.225,1.43,1.4,1.4,1.4].entries()) expect(parseFloat(headings[i].line)).toBeCloseTo(parseFloat(headings[i].font)*ratio,2);
 for(const h of headings) {expect(h.top).toBe('16px');expect(h.bottom).toBe('16px');}
 expect(headings[0].border).toBe('1px');expect(headings[1].color).toBe('rgb(238, 238, 238)');
 const quote=await page.locator('.cm-live-quote').evaluate(el=>{const s=getComputedStyle(el);return [s.borderLeftWidth,s.borderLeftColor,s.paddingLeft,s.paddingRight,s.color];});
 expect(quote).toEqual(['4px','rgb(223, 226, 229)','15px','15px','rgb(119, 119, 119)']);
 const cell=await page.locator('[data-live-cell="0:0"]').evaluate(el=>{const s=getComputedStyle(el);return [s.padding,s.borderTopWidth,s.borderTopColor,s.backgroundColor];});
 expect(cell).toEqual(['6px 13px','1px','rgb(223, 226, 229)','rgb(248, 248, 248)']);
 await expect(page.locator('.cm-live-link')).toHaveCSS('color','rgb(65, 131, 196)');
 await expect(page.locator('.cm-live-inline-code')).toHaveCSS('font-size','14.4px');
 await expect(page.locator('.cm-live-inline-code')).toHaveCSS('border-radius','3px');
 expect(await page.locator('.cm-live-table').evaluate(el=>getComputedStyle(el).padding)).toBe('0px');
 await page.emulateMedia({colorScheme:'dark'});
 await expect(page.locator('.cm-live-quote')).toHaveCSS('color','rgb(170, 170, 170)');
 await expect(page.locator('[data-live-cell="0:0"]')).toHaveCSS('border-top-color','rgb(69, 74, 80)');
 await page.emulateMedia({media:'print'});
 await expect(page.locator('.cm-live-h1')).toHaveCSS('font-size','29.25px');
 await expect(page.locator('.cm-live-quote')).toHaveCSS('color','rgb(119, 119, 119)');
 await expect(page.locator('[data-live-cell="0:0"]')).toHaveCSS('border-top-color','rgb(223, 226, 229)');
});

test('inactive list markers remain visible and fenced code forms one styled block',async({page})=>{
 await boot(page,'- bullet\n\n3. ordered\n\n- [x] done\n\n```js\nconst a=1\nconst b=2\n```\n\nend');
 await expect(page.locator('.cm-live-list-marker')).toHaveText(['• ','3. ']);
 await expect(page.locator('.cm-live-task-marker')).toHaveText('☑ ');
 const rows=await page.locator('.cm-live-code').evaluateAll(elements=>elements.map(el=>{
  const s=getComputedStyle(el);return {top:s.borderTopWidth,bottom:s.borderBottomWidth,left:s.borderLeftWidth,radius:s.borderTopLeftRadius,marginTop:s.marginTop,marginBottom:s.marginBottom,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,font:s.fontSize};
 }));
 expect(rows).toHaveLength(4);
 expect(rows[0]).toMatchObject({top:'1px',bottom:'0px',left:'1px',radius:'3px',marginTop:'15px',paddingTop:'8px'});
 expect(rows[1]).toMatchObject({top:'0px',bottom:'0px',left:'1px',font:'14.4px'});
 expect(rows[3]).toMatchObject({bottom:'1px',marginBottom:'15px',paddingBottom:'6px'});
});

test('table formula renders once and raw cell selection copies original escaped Markdown',async({page})=>{
 const text='| A | B |\n| - | - |\n| $x$ | `c\\|d` |\n\nend';await boot(page,text);
 await expect(page.locator('.cm-live-table .katex')).toHaveCount(1);
 await page.locator('[data-live-cell="1:1"]').click();await page.keyboard.press('Meta+a');
 const copied=await page.locator('[data-live-cell="1:1"] .cm-content').evaluate(el=>{
  const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');
 });
 expect(copied).toBe('`c\\|d`');
});

for(const run of [1,2,3]) test(`L1 backslash run ${run} stays a table when loaded, typed, pasted and composed`,async({page})=>{
 const slash='\\'.repeat(run);
 const raw=`\ufeffbefore\r\n\r| A | B |\n| - | - |\r\n| left${slash}|right | \`c${slash}|d\` |\n\nafter`;
 await boot(page,raw);
 await expect(page.locator('.cm-live-table')).toHaveCount(1);
 const bytes=await page.evaluate(()=>(window as any).bytes());
 for(const [column,input,kind] of [[0,`left${slash}|right`,'type'],[1,`\`c${slash}|d\``,'paste'],[0,`中${slash}|文`,'compose']] as const) {
  const host=page.locator(`[data-live-cell="1:${column}"]`);await host.click();const mini=host.locator('.cm-content');
  await mini.press('Meta+a');
  await mini.evaluate(el=>{(window as any).marked=el;});
  if(kind==='compose') await mini.dispatchEvent('compositionstart');
  if(kind==='paste') await mini.evaluate((el,text)=>{const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},input);
  else await page.keyboard.insertText(input);
  await expect(page.locator('.cm-live-table')).toHaveCount(1);
  await expect(mini).toBeFocused();await expect(mini).toHaveText(input);
  expect(await mini.evaluate(el=>el===(window as any).marked)).toBe(true);
  if(kind==='compose') {
   expect(await page.evaluate(()=>(window as any).session.barrier().composing)).toBe(true);
   await mini.dispatchEvent('compositionend');
   await expect.poll(async()=>page.evaluate(()=>(window as any).session.barrier().composing)).toBe(false);
  }
  const state=await snapshot(page);
  const original=raw.replace(/^\ufeff/,'').replace(/\r\n|\r/g,'\n');
  const old=column===0?`left${slash}|right`:`\`c${slash}|d\``;
  expect(state.text).toBe(original.replace(old,input.replace(/\|/g,'\\|')));
  const last=await page.evaluate(()=>(window as any).commits.at(-1));
  const start=original.indexOf(old),end=start+old.length;
  expect(last.patches.every((p:any)=>p.from>=start && p.to<=end && p.eols.length===0)).toBe(true);
  await page.evaluate(()=>(window as any).command('undo'));
  expect(await page.evaluate(()=>(window as any).bytes())).toEqual(bytes);
 }
});

test('L2 separator alignment reaches headers, body cells and mini editors through structure/undo',async({page})=>{
 const text='| A | B | C |\n| :--- | :---: | ---: |\n| text | middle | 42 |\n\nend';await boot(page,text);
 const align=async()=>page.locator('.cm-live-table tr').evaluateAll(rows=>rows.map(row=>Array.from(row.children).map(el=>getComputedStyle(el).textAlign)));
 expect(await align()).toEqual([['left','center','right'],['left','center','right']]);
 for(const [column,want] of ['left','center','right'].entries()) {
  const host=page.locator(`[data-live-cell="1:${column}"]`);await host.click();const mini=host.locator('.cm-content');
  await expect(mini).toHaveCSS('text-align',want);await expect(mini.locator('.cm-line')).toHaveCSS('text-align',want);
  await mini.press('End');await page.keyboard.insertText('!');await page.evaluate(()=>(window as any).command('undo'));
 }
 await page.locator('[data-live-cell="1:0"]').click({button:'right'});await page.getByRole('menuitem',{name:'Insert column right'}).click();
 expect((await align())[1]).toEqual(['left','start','center','right']);
 expect((await snapshot(page)).text).toContain('| :--- | --- | :---: | ---: |');
 await page.locator('[data-live-cell="1:1"]').click({button:'right'});await page.getByRole('menuitem',{name:'Delete column'}).click();
 expect(await align()).toEqual([['left','center','right'],['left','center','right']]);
 await page.evaluate(()=>(window as any).command('undo'));expect((await align())[1]).toEqual(['left','start','center','right']);
 await page.evaluate(()=>(window as any).command('undo'));expect((await snapshot(page)).text).toBe(text);
});

test('L3 cell rendering shares inline document context before/after focus, edits and undo',async({page})=>{
 const text='| A | B | C |\n| - | - | - |\n| # title | - item | --- |\n| **bold** `code` $x$ | [label][ref] | ![a][pic] |\n\n[ref]: https://example.com "title"\n[pic]: https://invalid.example/a.png\n\nend';await boot(page,text);
 const compare=async()=>{
  const actual=await page.locator('.cm-live-table td').evaluateAll(cells=>cells.map(el=>el.innerHTML));
  const expected=await page.evaluate(()=>{const div=document.createElement('div');div.innerHTML=(window as any).render((window as any).session.snapshot().text).html;return Array.from(div.querySelectorAll('td')).map(el=>el.innerHTML);});
  expect(actual).toEqual(expected);
  await expect(page.locator('.cm-live-table h1, .cm-live-table ul, .cm-live-table hr')).toHaveCount(0);
 };
 await compare();
 await page.locator('[data-live-cell="1:0"]').click();await page.keyboard.press('End');await page.keyboard.insertText('!');
 await page.locator('[data-live-cell="0:0"]').click();await compare();
 await page.evaluate(()=>(window as any).command('undo'));await compare();
 await page.locator('[data-live-cell="2:0"]').click();await page.keyboard.press('Meta+a');
 const marked=page.locator('[data-live-cell="2:0"] .cm-content');await marked.dispatchEvent('compositionstart');
 await page.keyboard.insertText('**新** `code` $y$');await marked.dispatchEvent('compositionend');
 await expect.poll(async()=>page.evaluate(()=>(window as any).session.barrier().composing)).toBe(false);
 await page.locator('[data-live-cell="0:0"]').click();await compare();
 // A reference definition outside the table must also invalidate its inline projection.
 await page.evaluate(()=>{const s=(window as any).session;const p=s.getSource().text.indexOf('https://example.com');s.edit([{from:p,to:p+19,insert:'https://changed.test',eols:[]}]);});
 await expect(page.locator('[data-live-cell="2:1"] a')).toHaveAttribute('href','https://changed.test');
});

for(const partial of [false,true]) test(`L4 ${partial?'partial':'full'} cut copies raw Markdown and deletes in one root event`,async({page})=>{
 const raw='\ufeffbefore\r\n\r| A |\n| - |\r\n| `c\\|d` |\n\nafter';await boot(page,raw);
 const original=await snapshot(page),bytes=await page.evaluate(()=>(window as any).bytes());
 const host=page.locator('[data-live-cell="1:0"]');await host.click();
 if(partial) await host.locator('.cm-content').evaluate(el=>{const v=(window as any).session.view.constructor.findFromDOM(el);v.dispatch({selection:{anchor:2,head:3}});});
 else await page.keyboard.press('Meta+a');
 const payload=await host.locator('.cm-content').evaluate(el=>{
  const copy=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:copy,bubbles:true,cancelable:true}));
  const cut=new DataTransfer();el.dispatchEvent(new ClipboardEvent('cut',{clipboardData:cut,bubbles:true,cancelable:true}));return {copy:copy.getData('text/plain'),cut:cut.getData('text/plain')};
 });
 expect(payload).toEqual({copy:partial?'\\|':'`c\\|d`',cut:partial?'\\|':'`c\\|d`'});
 expect((await snapshot(page)).text).toBe(original.text.replace(partial?'\\|':'`c\\|d`',''));
 const commits=await page.evaluate(()=>(window as any).commits);expect(commits).toHaveLength(1);expect(commits[0].patches).toHaveLength(1);
 expect(commits[0].patches[0]).toEqual({from:original.text.indexOf(partial?'\\|':'`c\\|d`'),to:original.text.indexOf(partial?'\\|':'`c\\|d`')+(partial?2:6),insert:'',eols:[]});
 await page.evaluate(()=>(window as any).command('undo'));expect(await page.evaluate(()=>(window as any).bytes())).toEqual(bytes);
});

test('L4 cut during synthetic preedit is blocked without changing the marked cell or clipboard',async({page})=>{
 await boot(page,'| A |\n| - |\n| `c\\|d` |\n\nend');await page.locator('[data-live-cell="1:0"]').click();await page.keyboard.press('Meta+a');
 const original=await page.evaluate(()=>(window as any).bytes());
 const mini=page.locator('[data-live-cell="1:0"] .cm-content');await mini.dispatchEvent('compositionstart');
 await page.keyboard.insertText('中\\|文');
 await mini.evaluate(el=>{const v=(window as any).session.view.constructor.findFromDOM(el);v.dispatch({selection:{anchor:0,head:v.state.doc.length}});});
 const before=await page.evaluate(()=>(window as any).session.getSource().text);
 const result=await mini.evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','keep');const event=new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true});el.dispatchEvent(event);return {text:data.getData('text/plain'),blocked:event.defaultPrevented};});
 expect(result).toEqual({text:'keep',blocked:true});expect(await page.evaluate(()=>(window as any).session.getSource().text)).toBe(before);
 await expect(mini).toHaveText('中\\|文');await expect(mini).toBeFocused();await mini.dispatchEvent('compositionend');
 await expect.poll(async()=>page.evaluate(()=>(window as any).session.barrier().composing)).toBe(false);
 expect(await page.evaluate(()=>(window as any).commits.length)).toBe(1);
 const composed=await page.evaluate(()=>(window as any).bytes());
 const copied=await mini.evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('cut',{clipboardData:data,bubbles:true,cancelable:true}));return data.getData('text/plain');});
 expect(copied).toBe('中\\\\|文');expect(await page.evaluate(()=>(window as any).commits.length)).toBe(2);
 await page.evaluate(()=>(window as any).command('undo'));expect(await page.evaluate(()=>(window as any).bytes())).toEqual(composed);
 await page.evaluate(()=>(window as any).command('undo'));expect(await page.evaluate(()=>(window as any).bytes())).toEqual(original);
});
