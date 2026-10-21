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

async function clickGlyph(page:Page,glyph:string,side:'before'|'after') {
  const point=await page.locator('.cm-live-math .katex-html').evaluate((el,{glyph,side})=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      const at=node.textContent!.indexOf(glyph);if(at<0)continue;
      if(getComputedStyle(node.parentElement!).visibility!=='visible')continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+glyph.length);
      const box=range.getBoundingClientRect();if(!box.width||!box.height)continue;
      return {x:box.left+box.width*(side==='before'?.1:.9),y:(box.top+box.bottom)/2};
    }
    throw new Error(`No visible glyph ${glyph}`);
  },{glyph,side});
  await test.info().attach('math-pointer-target',{contentType:'application/json',body:JSON.stringify(await page.evaluate(point=>{
    const target=document.elementFromPoint(point.x,point.y);
    const wrapper=document.querySelector('.cm-live-math');
    const rect=wrapper?.getBoundingClientRect();
    return {point,target:target?.outerHTML,insideWidget:!!target?.closest('.cm-live-math'),widget:rect?.toJSON()};
  },point),null,2)});
  await page.mouse.click(point.x,point.y);
}
async function settledSelection(page:Page) {
  return page.evaluate(async()=>{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    return (window as any).nativeTransport.session.selection();
  });
}

const samples=[
  {name:'fraction numerator',formula:'$\\frac{1}{2}$',glyph:'1',token:'1',side:'after'},
  {name:'fraction denominator',formula:'$\\frac{1}{2}$',glyph:'2',token:'2',side:'before'},
  {name:'superscript',formula:'$x^{23}+4$',glyph:'3',token:'3',side:'after'},
  {name:'subscript',formula:'$x_{23}+4$',glyph:'2',token:'2',side:'before'},
  {name:'square root radicand',formula:'$\\sqrt{x+7}$',glyph:'7',token:'7',side:'after'},
  {name:'root index',formula:'$\\sqrt[3]{x+7}$',glyph:'3',token:'3',side:'after'},
  {name:'Greek command leading edge',formula:'$\\alpha+7$',glyph:'α',token:'\\alpha',side:'before'},
  {name:'Greek command trailing edge',formula:'$\\alpha+7$',glyph:'α',token:'\\alpha',side:'after'},
  {name:'normalized minus command-free glyph',formula:'$x-7$',glyph:'−',token:'-',side:'after'},
  {name:'nested fraction and script',formula:'$\\frac{x^{7}}{\\sqrt{3+y}}$',glyph:'7',token:'7',side:'after'},
  {name:'matrix second row',formula:'$\\begin{pmatrix}1&2\\\\3&7\\end{pmatrix}$',glyph:'7',token:'7',side:'after'},
  {name:'sum upper limit',formula:'$\\sum_{i=1}^{7}i$',glyph:'7',token:'7',side:'after'},
  {name:'accent base',formula:'$\\hat{x}+7$',glyph:'x',token:'x',side:'after'},
  {name:'text command internal character',formula:'$\\text{abc}+7$',glyph:'b',token:'b',side:'after'},
  {name:'ignored whitespace',formula:'$x +7$',glyph:'7',token:'7',side:'after'},
  {name:'quote-prefixed multiline fraction',formula:'> $$\n> \\frac{1}{7}\n> $$',glyph:'7',token:'7',side:'after'},
  {name:'nested quote multiline script',formula:'> > $$\n> > x^{7}\n> > $$',glyph:'7',token:'7',side:'after'},
  {name:'list-prefixed multiline root',formula:'- $$\n  \\sqrt{x+7}\n  $$',glyph:'7',token:'7',side:'after'},
  {name:'display fraction at 75 percent zoom',formula:'$$\n \\frac{1}{7} \n$$',glyph:'7',token:'7',side:'after',zoom:.75},
] as const;

for(const sample of samples) test(`complex math exact source hit: ${sample.name}`,async({page})=>{
  const source=`😀 前文\n\n${sample.formula}\n\nend`;
  const raw='\ufeff'+source.replaceAll('\n','\r\n');
  const at=source.indexOf(sample.token,source.indexOf('$'))+(sample.side==='after'?sample.token.length:0);
  await page.evaluate(raw=>(window as any).bootNative(raw),raw);
  if('zoom' in sample)await page.evaluate(zoom=>(window as any).nativeCommand('setZoom',{zoom}),sample.zoom);
  await clickGlyph(page,sample.glyph,sample.side);
  expect(await settledSelection(page)).toEqual({anchor:at,head:at});
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.status().canUndo)).toBe(false);
  await page.keyboard.insertText('9');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.slice(0,at)+'9'+source.slice(at));
  await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(raw)));
});
