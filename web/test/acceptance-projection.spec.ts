import {test,expect,type Page} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import { rawCssPlugin, chromiumFallbackPath } from '../../scripts/web-tooling.mjs';
let bundle:string,styles:string;
const errors=new WeakMap<Page,string[]>();
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
 const result=await build({entryPoints:['web/test/acceptance-projection-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
 bundle=result.outputFiles[0].text;styles=(await Promise.all(['typography','palette','print'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
 // Geometry uses KaTeX layout rules; native/bundled font acceptance remains controller work.
 styles+=(await readFile('node_modules/katex/dist/katex.min.css','utf8')).replace(/@font-face\{[^}]*\}/g,'');
});
test.beforeEach(async({page})=>{
 const failures:string[]=[];errors.set(page,failures);page.on('pageerror',e=>failures.push(e.stack??e.message));page.on('console',e=>{if(e.type()==='error')failures.push(e.text());});
 await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1000,height:1000});
 await page.setContent('<main id="editor"></main>');await page.addStyleTag({content:styles});
 await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});await page.addScriptTag({content:bundle});
});
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([]);});
const boot=(page:Page,text:string)=>page.evaluate(t=>(window as any).bootNative(t),text);
const bytes=(page:Page)=>page.evaluate(()=>(window as any).nativeBytes());
const select=(page:Page,p:number)=>page.evaluate(p=>(window as any).nativeSelect(p),p);
const command=(page:Page,name:string,args?:unknown)=>page.evaluate(({name,args})=>(window as any).nativeCommand(name,args),{name,args});

 test('AC3 actual CM renders HR, all quote lines and ordered counters like the shared grammar',async({page})=>{
 const raw='\ufeffintro\r\n\r---\n\n> first\r\n> second\n\n5. alpha\n1. beta\n1. gamma\n\nend';await boot(page,raw);const original=await bytes(page);
 await page.evaluate(()=>(window as any).projectionReference());
 await expect(page.locator('#editor .cm-live-rule hr')).toHaveCount(1);
 const quote=page.locator('#editor .cm-live-quote');expect((await quote.innerText()).replace(/\s+/g,' ').trim()).toBe('first second');
 await expect(page.locator('#editor .cm-live-list-marker')).toHaveText(['5. ','6. ','7. ']);
 expect(await page.locator('#reference ol').getAttribute('start')).toBe('5');
 for(const snippet of ['---','> second','1. beta']) {const p=await page.evaluate(s=>(window as any).nativeTransport.session.getSource().text.indexOf(s)+1,snippet);await select(page,p);await expect(page.locator('#editor')).toContainText(snippet);}
 const end=await page.evaluate(()=>(window as any).nativeTransport.session.getSource().text.length);await select(page,end);
 expect(await bytes(page)).toEqual(original);expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().revision)).toBe(0);
});

 test('AC3 escape/entity widgets reveal at mapped click boundaries, edit locally and undo exact bytes',async({page})=>{
 const raw='\ufeff😀 \\*lit\\* &amp; &#65; &#x1F600; &NotEqualTilde; `&amp;`\r\n\rend';await boot(page,raw);const original=await bytes(page);
 await expect(page.locator('#editor .cm-live-escape')).toHaveText(['*','*']);
 await expect(page.locator('#editor .cm-live-entity')).toHaveText(['&','A','😀','≂̸']);
 await expect(page.locator('#editor .cm-live-inline-code')).toHaveText('&amp;');
 const source=await page.evaluate(()=>(window as any).nativeTransport.session.getSource().text);
 const token=page.locator('#editor .cm-live-entity').filter({hasText:'😀'});const box=(await token.boundingBox())!;
 await page.mouse.click(box.x+box.width-1,box.y+box.height/2);
 expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection())).toEqual({anchor:source.indexOf('&#x1F600;')+9,head:source.indexOf('&#x1F600;')+9});
 await expect(page.locator('#editor')).toContainText('&#x1F600;');await page.keyboard.insertText('!');
 expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.replace('&#x1F600;','&#x1F600;!'));
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
 await select(page,source.length);const escaped=page.locator('#editor .cm-live-escape').first(),left=(await escaped.boundingBox())!;
 await page.mouse.click(left.x+1,left.y+left.height/2);expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection().head)).toBe(source.indexOf('\\*'));
 await expect(page.locator('#editor')).toContainText('\\*');expect(await bytes(page)).toEqual(original);
});

for(const underline of ['===','---']) test(`AC4 Setext ${underline} has one heading frame and matches real renderer geometry`,async({page})=>{
 const raw=`\ufeff标题写法\r\n${underline}\n\n正文\r\n\rend`;await boot(page,raw);const original=await bytes(page);
 await page.evaluate(()=>(window as any).projectionReference());
 const heading=page.locator('#editor .cm-live-heading');await expect(heading).toHaveCount(1);
 const actual=await heading.boundingBox(),reference=await page.locator('#reference h1, #reference h2').boundingBox();expect(actual!.height).toBeCloseTo(reference!.height,0);
 const body=page.locator('#editor .cm-live-paragraph').filter({hasText:'正文'}),bodyBox=(await body.boundingBox())!;
 const refBody=(await page.locator('#reference p').filter({hasText:'正文'}).boundingBox())!;
 expect(bodyBox.y-actual!.y-actual!.height).toBeCloseTo(refBody.y-reference!.y-reference!.height,0);
 await select(page,6);await expect(page.locator('#editor')).toContainText(underline);expect(await page.locator('#editor .cm-live-heading').count()).toBe(1);
 await command(page,'setMode',{mode:'source'});await expect(page.locator('#editor .cm-live-heading')).toHaveCount(0);await expect(page.locator('#editor')).toContainText(underline);
 await command(page,'setMode',{mode:'live'});expect(await bytes(page)).toEqual(original);
});

for(const width of [1000,1400,1800]) test(`AC9 actual CM paragraph gaps, formula center and intrinsic short table at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});const raw='\ufeffalpha\r\nsoft\n\n\n\nsecond\r\n\r\n$$\nx^2+y^2\n$$\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nend';await boot(page,raw);const original=await bytes(page);
 await page.evaluate(()=>(window as any).projectionReference());
 const p1=page.locator('#editor .cm-live-paragraph').filter({hasText:'alpha'}),p2=page.locator('#editor .cm-live-paragraph').filter({hasText:'second'});
 expect((await p1.innerText()).replace(/\s+/g,' ').trim()).toBe('alpha soft');
 const a=(await p1.boundingBox())!,b=(await p2.boundingBox())!,ra=(await page.locator('#reference p').filter({hasText:'alpha'}).boundingBox())!,rb=(await page.locator('#reference p').filter({hasText:'second'}).boundingBox())!;
 const scroller=await page.locator('#editor > .cm-editor > .cm-scroller').evaluate(el=>{const s=getComputedStyle(el);return {font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)};});expect(scroller.line/scroller.font).toBeCloseTo(1.6,3);
 // Four source LF characters include two intentional extra blank rows. The
 // ordinary renderer paragraph margin remains, with two editable row heights.
 await expect(page.locator('#editor .cm-live-blank')).toHaveCount(2);
 expect(a.height).toBeCloseTo(ra.height,0);expect(b.y-a.y-a.height).toBeCloseTo(rb.y-ra.y-ra.height+2*scroller.line,0);
 const formula=(await page.locator('#editor .cm-live-math-block .katex').first().boundingBox())!,content=(await page.locator('#editor > .cm-editor > .cm-scroller > .cm-content').boundingBox())!;
 expect(formula.x+formula.width/2).toBeCloseTo(content.x+content.width/2,0);
 const table=(await page.locator('#editor .cm-live-table table').boundingBox())!,refTable=(await page.locator('#reference table').boundingBox())!;
 expect(table.width).toBeCloseTo(refTable.width,0);expect(table.width).toBeLessThan(content.width/2);
 expect(await bytes(page)).toEqual(original);expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().revision)).toBe(0);
 await command(page,'setMode',{mode:'source'});await expect(page.locator('#editor')).toContainText('alpha');await command(page,'setMode',{mode:'live'});expect(await bytes(page)).toEqual(original);
});

 test('AC3/4 projected marked text survives synthetic composition and one root undo',async({page})=>{
 const raw='\ufeffTitle\r\n===\n\n\\*literal\\* &amp;\r\n\rend';await boot(page,raw);const original=await bytes(page);
 const p=await page.evaluate(()=>(window as any).nativeTransport.session.getSource().text.indexOf('&amp;')+2);await select(page,p);
 const result=await page.evaluate(p=>{const s=(window as any).nativeTransport.session,v=s.view,node=v.domAtPos(p).node;v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));s.dispatch({changes:{from:p,insert:'中'},selection:{anchor:p+1},userEvent:'input.type.compose'});const same=node===v.domAtPos(p+1).node;const committed=s.snapshot().revision;v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return {same,committed};},p);
 expect(result).toEqual({same:true,committed:0});await expect.poll(async()=>page.evaluate(()=>(window as any).nativeTransport.session.snapshot().revision)).toBe(1);
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
});

 test('AC3/9 blank-line projection preserves each heading and fenced-code line boundary',async({page})=>{
 const raw='# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n\n```js\nconst a=1\nconst b=2\n```\n\nend';
 await boot(page,raw);const original=await bytes(page);
 await expect(page.locator('#editor .cm-live-heading')).toHaveText(['H1','H2','H3','H4','H5','H6']);
 await expect(page.locator('#editor .cm-live-code')).toHaveCount(4);
 await expect(page.locator('#editor .cm-live-code-first')).toHaveCount(1);
 await expect(page.locator('#editor .cm-live-code-last')).toHaveCount(1);
 expect(await bytes(page)).toEqual(original);
});

 test('AC3/4/9 mixed quote paragraphs, multiline Setext and hard breaks retain renderer geometry',async({page})=>{
 const raw='\ufeffbefore\r\n\n> first\n>\r\n> second\n\nTitle\nmore\r\n===\n\nhard  \nbreak\n\nend';
 await boot(page,raw);const original=await bytes(page);await page.evaluate(()=>(window as any).projectionReference());
 const quote=page.locator('#editor .cm-live-quote');await expect(quote).toHaveCount(1);
 expect((await quote.innerText()).replace(/\s+/g,' ').trim()).toBe('first second');
 const heading=page.locator('#editor .cm-live-setext-heading');expect((await heading.innerText()).trim()).toBe('Title more');
 for(const [live,rendered] of [[quote,page.locator('#reference blockquote')],[heading,page.locator('#reference h1')],[page.locator('#editor .cm-live-paragraph').filter({hasText:'hard'}),page.locator('#reference p').filter({hasText:'hard'})]]) {
  const a=(await live.boundingBox())!,b=(await rendered.boundingBox())!;expect(a.height).toBeCloseTo(b.height,0);
 }
 const source=await page.evaluate(()=>(window as any).nativeTransport.session.getSource().text);
 await select(page,source.indexOf('> second')+1);await expect(quote).toContainText('> second');
 await select(page,source.length);expect(await bytes(page)).toEqual(original);
 await page.screenshot({path:'/private/tmp/ret-acceptance-projection-mixed.png',fullPage:true});
});

for(const [title,raw] of [
 ['single','> Title\n> ===\n\nend'],['multiline','> Title\n> more\n> ===\n\nend'],['nested','> > Title\n> > ---\n\nend'],
]) test(`AP1 ${title} quoted Setext hides the complete underline container prefix`,async({page})=>{
 await boot(page,'\ufeff'+raw.replace('\n','\r\n'));const original=await bytes(page);await page.evaluate(()=>(window as any).projectionReference());
 const heading=page.locator('#editor .cm-live-setext-heading'),reference=page.locator('#reference h1, #reference h2');
 expect((await heading.innerText()).trim()).toBe(await reference.innerText());
 expect((await heading.boundingBox())!.height).toBeCloseTo((await reference.boundingBox())!.height,0);
 const source=await page.evaluate(()=>(window as any).nativeTransport.session.getSource().text),p=source.indexOf('Title')+2;
 const point=await page.evaluate(p=>(window as any).nativeTransport.session.view.coordsAtPos(p),p);
 await page.mouse.click(point.left,(point.top+point.bottom)/2);
 expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection().head)).toBe(p);
 await expect(heading).toContainText(title==='nested'?'---':'===');
 await page.keyboard.insertText('!');expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.slice(0,p)+'!'+source.slice(p));
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
 await command(page,'setMode',{mode:'source'});await expect(page.locator('#editor')).toContainText(title==='nested'?'> > ---':'> ===');
 await command(page,'setMode',{mode:'live'});await select(page,source.length);expect((await heading.innerText()).trim()).toBe(await reference.innerText());expect(await bytes(page)).toEqual(original);
});

 test('AP2 backslash hard break hides its marker, retains two lines and reveals the mapped raw source',async({page})=>{
 const raw='\ufeffhard\\\r\nbreak\n\nend';await boot(page,raw);const original=await bytes(page);await page.evaluate(()=>(window as any).projectionReference());
 const paragraph=page.locator('#editor .cm-live-paragraph').filter({hasText:'hard'}),reference=page.locator('#reference p').filter({hasText:'hard'});
 expect((await paragraph.innerText()).trim()).toBe((await reference.innerText()).trim());
 expect((await paragraph.boundingBox())!.height).toBeCloseTo((await reference.boundingBox())!.height,0);
 await select(page,4);await expect(paragraph).toContainText('hard\\');
 await page.keyboard.insertText('!');expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe('hard!\\\nbreak\n\nend');
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
});

for(const [label,raw,needle] of [['AP1','> Title\n> ===\n\nend','==='],['AP2','hard\\\nbreak\n\nend','\\']]) test(`${label} active marker preserves its actual marked text node and one root undo`,async({page})=>{
 await boot(page,'\ufeff'+raw.replace('\n','\r\n'));const original=await bytes(page);
 const p=await page.evaluate(s=>(window as any).nativeTransport.session.getSource().text.indexOf(s)+1,needle);await select(page,p);
 const result=await page.evaluate(p=>{const s=(window as any).nativeTransport.session,v=s.view,node=v.domAtPos(p).node;v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));s.dispatch({changes:{from:p,insert:'中'},selection:{anchor:p+1},userEvent:'input.type.compose'});const same=node===v.domAtPos(p+1).node,committed=s.snapshot().revision;v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));return {same,committed};},p);
 expect(result).toEqual({same:true,committed:0});await expect.poll(async()=>page.evaluate(()=>(window as any).nativeTransport.session.snapshot().revision)).toBe(1);
 await command(page,'undo');expect(await bytes(page)).toEqual(original);
});
