import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=';
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
 const result=await build({entryPoints:['web/test/final-live-browser-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
 bundle=result.outputFiles[0].text;styles=(await Promise.all(['typography','palette','print'].map(name=>readFile(`web/styles/${name}.css`,'utf8')))).join('\n');
});
test.beforeEach(async({page})=>{
 const failures:string[]=[];errors.set(page,failures);page.on('pageerror',e=>failures.push(e.stack??e.message));page.on('console',e=>{if(e.type()==='error')failures.push(e.text());});
 page.on('request',request=>{if(/^https?:/.test(request.url()))failures.push(`Unexpected remote request: ${request.url()}`);});
 await page.emulateMedia({colorScheme:'light'});
 await page.setContent('<main id="editor"></main>');await page.addStyleTag({content:styles});
 await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});
 await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
const boot=(page:Page,text:string,assets:Record<string,string>={})=>page.evaluate(({text,assets})=>(window as any).bootNative(text,assets),{text,assets});
const snapshot=(page:Page)=>page.evaluate(()=>(window as any).nativeTransport.session.snapshot());
const bytes=(page:Page)=>page.evaluate(()=>(window as any).nativeBytes());
const command=(page:Page,name:string,args?:unknown)=>page.evaluate(({name,args})=>(window as any).nativeCommand(name,args),{name,args});
const opens=(page:Page)=>page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.type==='openLink'));

test('FR1 Cmd-click opens exact inline and reference URLs through production transport; ordinary click edits',async({page})=>{
 const text='\ufeff[inline](https://example.com/p?q=1&x=%E4%B8%AD#f)\r\n\r[ref][target] [email](mailto:person@example.com)\n\n[target]: http://example.net/path?q=2&b=3\n\nend';
 await boot(page,text);const original=await bytes(page);const view=await page.evaluate(()=>{(window as any).rootView=(window as any).nativeTransport.session.view;return true;});expect(view).toBe(true);
 for(const [label,url] of [['inline','https://example.com/p?q=1&x=%E4%B8%AD#f'],['ref','http://example.net/path?q=2&b=3'],['email','mailto:person@example.com']]) {
  const before=await page.evaluate(()=>(window as any).nativeTransport.session.selection());
  await page.locator('.cm-live-link').filter({hasText:label}).click({modifiers:['Meta']});
  const messages=await opens(page);expect(messages.at(-1)).toMatchObject({v:1,documentID:'final-live-document',sessionID:'final-live-session',type:'openLink',payload:{url}});
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection())).toEqual(before);
 }
 expect(await opens(page)).toHaveLength(3);expect(await bytes(page)).toEqual(original);
 expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.type==='commit'))).toEqual([]);
 await page.locator('.cm-live-link').filter({hasText:'inline'}).click();
 await expect(page.locator('#editor')).toContainText('[inline](https://example.com/p?q=1&x=%E4%B8%AD#f)');
 expect(await opens(page)).toHaveLength(3);
 expect(await page.evaluate(()=>(window as any).nativeTransport.session.view===(window as any).rootView)).toBe(true);
});

test('FR1 reference-only edits invalidate link targets; unsupported targets are inert including rendered table anchors',async({page})=>{
 const text='[go][ref]\n\n[ref]: https://first.test/a\n\n[file](file:///tmp/a) [ftp](ftp://example.com/a) [relative](local.md) [js](javascript:alert(1))\n\n| A |\n| - |\n| [table](https://table.test/a?q=1&b=2) |\n\nend';await boot(page,text);
 await page.locator('.cm-live-link').filter({hasText:'go'}).click({modifiers:['Meta']});expect((await opens(page)).at(-1).payload.url).toBe('https://first.test/a');
 await page.evaluate(()=>{const s=(window as any).nativeTransport.session;const at=s.getSource().text.indexOf('https://first.test/a');s.edit([{from:at,to:at+20,insert:'https://next.test/b',eols:[]}]);});
 await page.locator('.cm-live-link').filter({hasText:'go'}).click({modifiers:['Meta']});expect((await opens(page)).at(-1).payload.url).toBe('https://next.test/b');
 await command(page,'undo');await page.locator('.cm-live-link').filter({hasText:'go'}).click({modifiers:['Meta']});expect((await opens(page)).at(-1).payload.url).toBe('https://first.test/a');
 const count=(await opens(page)).length;
 for(const label of ['file','ftp','relative','js']) await page.locator('#editor').getByText(label,{exact:false}).filter({visible:true}).first().dispatchEvent('click',{metaKey:true,button:0});
 expect(await opens(page)).toHaveLength(count);
 await page.locator('.cm-live-table a').click({modifiers:['Meta']});expect((await opens(page)).at(-1).payload.url).toBe('https://table.test/a?q=1&b=2');
 expect(page.url()).toBe('about:blank');
});

for(const [name,image,definition] of [
 ['full','![x][pic]','[pic]: image.png'],
 ['collapsed','![pic][]','[pic]: image.png'],
 ['shortcut','![pic]','[pic]: image.png'],
 ['continued','![x][pic]','[pic]:\n  image.png'],
] as const) test(`FR2 ${name} image reference uses document capabilities and refreshes after definition edit/undo`,async({page})=>{
 const raw=`\ufeff😀\r\n\r${image}\n\n${definition}\r\n\r\nend`;await boot(page,raw,{'image.png':png});const original=await bytes(page);
 const widget=page.locator('.cm-live-image');await expect(widget.locator('img')).toHaveAttribute('src',png);
 expect(await widget.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 const compare=async()=>{const expected=await page.evaluate(()=>{const d=document.createElement('div');d.innerHTML=(window as any).nativeRender().html;return d.querySelector('img,.image-placeholder')!.outerHTML;});expect(await widget.evaluate(el=>el.querySelector('img,.image-placeholder')!.outerHTML)).toBe(expected);};
 await compare();expect(await bytes(page)).toEqual(original);expect((await snapshot(page)).revision).toBe(0);
 await page.evaluate(()=>{const s=(window as any).nativeTransport.session;const at=s.getSource().text.indexOf('image.png');s.edit([{from:at,to:at+9,insert:'missing.png',eols:[]}]);});
 await expect(widget.locator('.missing-image')).toContainText('missing.png');await compare();
 await command(page,'undo');await expect(widget.locator('img')).toHaveAttribute('src',png);expect(await bytes(page)).toEqual(original);
 await page.evaluate(()=>{const s=(window as any).nativeTransport.session;const at=s.getSource().text.indexOf('image.png');s.edit([{from:at,to:at+9,insert:'https://never.test/remote.png',eols:[]}]);});
 await expect(widget.locator('.remote-image')).toContainText('https://never.test/remote.png');await expect(widget.locator('img')).toHaveCount(0);await compare();
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
 const source=(await snapshot(page)).text;await page.evaluate(p=>(window as any).nativeSelect(p),source.indexOf(image)+2);await expect(page.locator('#editor')).toContainText(image);
 await page.evaluate(p=>(window as any).nativeSelect(p),source.length);await expect(widget.locator('img')).toHaveAttribute('src',png);expect(await bytes(page)).toEqual(original);
});

for(const [language,code,keyword] of [
 ['javascript','const answer = 42;\nconst label = "value";','const'],
 ['python','def answer():\n    return 42\nlabel = "value"','def'],
 ['json','{"answer": 42, "label": "value", "ok": true}',null],
] as const) test(`FR4 ${language} fenced code has editable syntax tokens with sole root history`,async({page})=>{
 const raw=`\ufeffbefore\r\n\r\`\`\`${language}\n${code}\r\n\`\`\`\n\nend`;await boot(page,raw);const original=await bytes(page);
 await expect(page.locator('.cm-live-code .cm-code-number').filter({hasText:'42'})).toHaveCount(1);
 await expect(page.locator('.cm-live-code .cm-code-string').filter({hasText:'value'})).toHaveCount(1);
 await expect(page.locator('.cm-live-code .cm-code-number').filter({hasText:'42'})).toHaveCSS('color','rgb(152, 104, 1)');
 await expect(page.locator('.cm-live-code .cm-code-string').filter({hasText:'value'})).toHaveCSS('color','rgb(64, 120, 242)');
 if(keyword) await expect(page.locator('.cm-live-code .cm-code-keyword').filter({hasText:keyword}).first()).toBeVisible();
 const at=(await snapshot(page)).text.indexOf('42');await page.evaluate(p=>(window as any).nativeSelect(p,p+2),at);await page.keyboard.insertText('43');
 await expect(page.locator('.cm-code-number').filter({hasText:'43'})).toHaveCount(1);
 await command(page,'setMode',{mode:'source'});await command(page,'setMode',{mode:'live'});await command(page,'undo');expect(await bytes(page)).toEqual(original);
 await expect(page.locator('.cm-live-code .cm-code-number').filter({hasText:'42'})).toHaveCount(1);
 expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.type==='commit').map((m:any)=>m.payload.reason))).toEqual(['edit','undo']);
});

test('FR4 unknown fences stay plain and code composition preserves the marked node and one root commit',async({page})=>{
 const text='```unknown-language\nconst answer = 42;\n```\n\n```js\nconst answer = 42;\n```\n\nend';await boot(page,text);
 await expect(page.locator('.cm-live-code').filter({hasText:'const answer'}).first().locator('[class*="cm-code-"]')).toHaveCount(0);
 await expect(page.locator('.cm-code-keyword')).toHaveCount(1);
 const p=text.lastIndexOf('answer')+3;await page.evaluate(p=>(window as any).nativeSelect(p),p);
 const result=await page.evaluate(p=>{const s=(window as any).nativeTransport.session,v=s.view,node=v.domAtPos(p).node;v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));s.dispatch({changes:{from:p,insert:'中'},selection:{anchor:p+1},userEvent:'input.type.compose'});const same=v.domAtPos(p+1).node===node;const committed=s.snapshot().text;v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return {same,committed};},p);
 expect(result).toEqual({same:true,committed:text});await expect.poll(async()=>(await snapshot(page)).text).toContain('ans中wer');
 expect(await page.evaluate(()=>(window as any).nativeMessages.filter((m:any)=>m.type==='commit').length)).toBe(1);await command(page,'undo');expect((await snapshot(page)).text).toBe(text);
});
