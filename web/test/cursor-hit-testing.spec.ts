import {test,expect} from 'playwright/test';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {rawCssPlugin,chromiumFallbackPath} from '../../scripts/web-tooling.mjs';

let bundle:string,styles:string;
test.use({launchOptions:{executablePath:process.env.RET_CHROMIUM||chromiumFallbackPath()}});
test.beforeAll(async()=>{
  const result=await build({entryPoints:['web/test/final-live-browser-harness.ts'],bundle:true,write:false,format:'iife',plugins:[rawCssPlugin()]});
  bundle=result.outputFiles[0].text;
  styles=(await Promise.all(['typography','palette','print'].map(n=>readFile(`web/styles/${n}.css`,'utf8')))).join('\n');
  styles+=(await readFile('node_modules/katex/dist/katex.min.css','utf8')).replace(/@font-face\{[^}]*\}/g,'');
});

// A visible glyph must hit its source character even when preceding rendered
// headings and hidden Markdown lines have different heights from source mode.
for(const target of ['正文：','列表：','代码：','末尾。']) test(`rendered mouse click maps the visible ${target} glyph to its source`,async({page})=>{
  await page.setViewportSize({width:940,height:740});
  await page.setContent('<main id="editor"></main>');await page.addStyleTag({content:styles});
  await page.evaluate(()=>{(window as any).webkit={messageHandlers:{ret:{postMessage:()=>{}}}};});
  await page.addScriptTag({content:bundle});
  const source='# 中文输入验收\n\n正文：\n\n- 列表：\n\n```text\n代码：\n```\n\n行内公式：$x+1$\n\n$$\nx^2+y^2=z^2\n$$\n\n| 项目 | 输入 |\n| --- | --- |\n| 表格 | 待输入 |\n\n末尾。\n';
  await page.evaluate(raw=>(window as any).bootNative(raw),source);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const point=await page.evaluate(text=>{
    const walker=document.createTreeWalker(document.querySelector('#editor')!,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()) {
      const at=node.textContent!.indexOf(text);if(at<0)continue;
      const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+1);
      const box=range.getBoundingClientRect();
      return {x:box.left+box.width*.1,y:(box.top+box.bottom)/2};
    }
    throw new Error(`Missing visible text ${text}`);
  },target);
  await page.mouse.click(point.x,point.y);
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.selection().head)).toBe(source.indexOf(target));
  await page.keyboard.insertText('中');
  expect(await page.evaluate(()=>(window as any).nativeTransport.session.snapshot().text)).toBe(source.replace(target,'中'+target));
  await page.evaluate(()=>(window as any).nativeCommand('undo'));
  expect(await page.evaluate(()=>(window as any).nativeBytes())).toEqual(Array.from(new TextEncoder().encode(source)));
});
