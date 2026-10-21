import {expect,it} from 'vitest';
import {EditorState} from '@codemirror/state';
import {EditorView, type DecorationSet} from '@codemirror/view';
import {liveExtensions} from '../src/live/decorations';
import type {LiveOptions} from '../src/editor/live-contract';

function lines(text:string,anchor=text.length,mode:'live'|'source'='live',head=anchor) {
  const options:LiveOptions={getSource:()=>({text,eols:[],bom:false}),apply:()=>{},resolveImage:()=>null,
    getMode:()=>mode,composition:()=>({composing:false,range:null})};
  const state=EditorState.create({doc:text,selection:{anchor,head},extensions:liveExtensions(options)});
  const result:{from:number;class:string}[]=[];
  for(const provider of state.facet(EditorView.decorations)) {
    const set:DecorationSet=typeof provider==='function'?provider({state} as EditorView):provider;
    set.between(0,text.length,(from,_to,value)=>{
      if(value.spec.class) result.push({from,class:value.spec.class});
    });
  }
  return result;
}
const hidden=(text:string,anchor=text.length)=>lines(text,anchor).filter(l=>l.class==='cm-live-gap').map(l=>l.from);

it('retains extra root blank rows after leaving them, hiding only the structural separator',()=>{
  expect(hidden('Alpha\n\nBeta')).toEqual([6]);
  expect(hidden('Alpha\n\n\nBeta')).toEqual([6]);
  expect(hidden('Alpha\n\n\n\nBeta')).toEqual([6]);
  expect(hidden('Alpha\n \n\t\nBeta')).toEqual([6]);
});

it('activating an extra row or the following paragraph does not reveal the preceding separator',()=>{
  expect(hidden('Alpha\n\n\nBeta',7)).toEqual([6]);
  expect(hidden('Alpha\n\n\nBeta',8)).toEqual([6]);
});

it('reveals the selected structural LF in either selection direction',()=>{
  for(const [anchor,head] of [[6,7],[7,6]]) {
    const projected=lines('Alpha\n\nBeta',anchor,'live',head);
    expect(projected).toContainEqual({from:6,class:'cm-live-blank'});
    expect(projected).not.toContainEqual({from:6,class:'cm-live-gap'});
  }
});

it('projects active root blanks and empty EOF into the paragraph-aligned line style',()=>{
  expect(lines('Alpha\n\n\nBeta',7)).toContainEqual({from:7,class:'cm-live-blank'});
  expect(lines('Alpha\n\nBeta',6)).toContainEqual({from:6,class:'cm-live-blank'});
  expect(lines('Alpha\n',6)).toContainEqual({from:6,class:'cm-live-blank'});
  expect(lines('',0)).toContainEqual({from:0,class:'cm-live-blank'});
});

it('keeps source mode and container-owned blank rows outside the root blank projection',()=>{
  expect(lines('Alpha\n\n\nBeta',0,'source')).toEqual([]);
  for(const text of ['```\na\n\n\nb\n```','    a\n\n\n    b','- a\n\n  b','> a\n>\n>\n> b','| A |\n| - |\n| b |','$$\na\n\nb\n$$']) {
    expect(lines(text,text.length).filter(l=>l.class==='cm-live-blank')).toEqual([]);
  }
  expect(hidden('> a\n>\n>\n> b\n\nend')).toEqual([4,6,12]);
});
