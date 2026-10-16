import {expect,it} from 'vitest';
import * as renderer from '../src/render/markdown';

it('FR1/FR2 shared inline context resolves links/images and keeps original issue ranges',()=>{
 expect(renderer).toHaveProperty('renderInlineContexts');
 const render=renderer.renderInlineContexts;
 const source='😀\r\n\r\n[go][ref]\r\n\r\n![alt][pic]\r\n\r\n[ref]: https://example.com/a?q=1&b=2\r\n[pic]:\r\n  missing.png';
 const start=source.indexOf('[go]'),image=source.indexOf('![alt]');
 const results=render(source,[{from:start,to:start+9},{from:image,to:image+11}]);
 expect(results[0]).toMatchObject({href:'https://example.com/a?q=1&b=2',html:'<a href="https://example.com/a?q=1&amp;b=2">go</a>',issues:[]});
 expect(results[1].issues).toEqual([{kind:'image',message:'Missing local image: missing.png',from:image,to:image+11}]);
 expect(results[1].html).toContain(`data-from="${image}" data-to="${image+11}"`);
});

it('FR1 contextual targets keep unsupported schemes inert under the renderer grammar',()=>{
 expect(renderer).toHaveProperty('renderInlineContexts');
 const render=renderer.renderInlineContexts;
 for(const input of ['[x](javascript:alert(1))','[x](data:text/html,hi)','[x](ftp://example.com)','[x](file:///tmp/x)']) {
  const result=render(input,[{from:0,to:input.length}])[0];expect(result.href).toBeNull();
 }
});
