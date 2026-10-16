import {beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import { rawCssPlugin } from '../../scripts/web-tooling.mjs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {indexedContains,syntaxSpans} from '../src/live/syntax';

// Instrument range/discriminant reads in the real owned modules, not elapsed
// time. This catches full-array containment scans regardless of machine speed.
// Nothing is added to the production API or production bundle.
let api:any,reads:{syntax:number;projection:number};
beforeAll(async()=>{
 reads={syntax:0,projection:0};
 const output=await build({stdin:{contents:`import {syntaxSpans} from './web/src/live/syntax';import {liveExtensions} from './web/src/live/decorations';import {EditorState,StateEffect} from '@codemirror/state';globalThis.api={syntaxSpans,liveExtensions,EditorState,StateEffect};`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'node',plugins:[rawCssPlugin(),{name:'operation-count',setup(b){
  b.onLoad({filter:/web\/src\/live\/(syntax|decorations)\.ts$/},async a=>{
   const scope=a.path.endsWith('syntax.ts')?'syntax':'projection';
   const source=(await readFile(a.path,'utf8')).replace(/(?<![.\w$])([\w$]+)\.(from|to|kind)\b(?!\s*\()/g,(_all,value,key)=>`__read(${value},'${key}')`);
   return {contents:`const __read=(value:any,key:string)=>{globalThis.reads.${scope}++;return value[key];};\n${source}`,loader:'ts'};
  });
 }}]});
 const context:any={reads,console,TextEncoder,TextDecoder,setTimeout,clearTimeout,queueMicrotask};runInNewContext(output.outputFiles[0].text,context);api=context.api;
});
const document=(n:number)=>'## heading\n\nfirst\nsoft\n\n> quote\n>\n> second\n\n5. a\n1. b\n\n```js\nlet n=1\n```\n\n'.repeat(n);
const options={getMode:()=> 'live',composition:()=>({composing:false,range:null}),resolveImage:()=>null,getSource:()=>({text:''}),apply:()=>{}};

it('bounds source-block containment work as paragraph/quote count doubles',()=>{
 const count=(n:number)=>{reads.syntax=0;const spans=api.syntaxSpans(document(n));expect(spans.filter((s:any)=>s.kind==='quote')).toHaveLength(n);return reads.syntax;};
 const small=count(100),large=count(200);expect(large).toBeLessThan(small*2.6);expect(large).toBeLessThan(100_000);
});

it('bounds projection containment work instead of scanning all spans per paragraph/gap/mark',()=>{
 const count=(n:number)=>{reads.projection=0;api.EditorState.create({doc:document(n),extensions:api.liveExtensions(options)});return reads.projection;};
 const small=count(100),large=count(200);expect(large).toBeLessThan(small*2.6);expect(large).toBeLessThan(100_000);
});

it('unrelated effects reuse the existing projection without scanning source ranges',()=>{
 const state=api.EditorState.create({doc:document(100),extensions:api.liveExtensions(options)}),effect=api.StateEffect.define();
 reads.projection=0;const next=state.update({effects:effect.of(null)}).state;
 expect(next.doc).toBe(state.doc);expect(reads.projection).toBe(0);
});

it('indexed containment retains nested owners without bridging disjoint source ranges',()=>{
 const contains=indexedContains([{from:0,to:10},{from:2,to:4},{from:12,to:14}]);
 expect(contains({from:3,to:9})).toBe(true);
 expect(contains({from:4,to:4})).toBe(true);
 expect(contains({from:9,to:13})).toBe(false);
 expect(contains({from:10,to:11})).toBe(false);
 expect(indexedContains([])({from:0,to:0})).toBe(false);
});

it.each([
 ['regular-256k','8006de70d5b4ee7c60b93245f810f326114c2da32009477c1564b2152756c6e8'],
 ['boundary-1m','e7e3ea9bc3c87efc5d1f2c70a8088baa2393bf678efe6b50b3c155b330d48b11'],
])('preserves every frozen %s projection span after containment optimization',async(name,digest)=>{
 const source=await readFile(`build/fixtures/${name}.md`,'utf8');
 expect(createHash('sha256').update(JSON.stringify(syntaxSpans(source))).digest('hex')).toBe(digest);
});
