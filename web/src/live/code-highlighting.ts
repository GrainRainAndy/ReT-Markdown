import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting, type Language } from '@codemirror/language';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { pythonLanguage } from '@codemirror/lang-python';
import { jsonLanguage } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';

/** Eager, bundled languages: unknown fence info retains Markdown's plain fallback. */
export function codeLanguage(info:string):Language|null {
  const name=info.trim().split(/\s+/)[0].toLowerCase();
  if(['js','javascript','jsx','mjs','cjs'].includes(name)) return javascriptLanguage;
  if(['py','python'].includes(name)) return pythonLanguage;
  if(name==='json') return jsonLanguage;
  return null;
}
export const fencedCodeHighlighting=[
  ...[javascriptLanguage,pythonLanguage,jsonLanguage].map(scope=>syntaxHighlighting(HighlightStyle.define([
    {tag:tags.keyword,class:'cm-code-keyword'},
    {tag:tags.string,class:'cm-code-string'},
    {tag:[tags.number,tags.bool,tags.null],class:'cm-code-number'},
    {tag:tags.propertyName,class:'cm-code-property'},
    {tag:tags.comment,class:'cm-code-comment'},
  ],{scope}))),
  EditorView.baseTheme({
    '.cm-code-keyword':{color:'var(--syntax-keyword, #a626a4)'},
    '.cm-code-string, .cm-code-property':{color:'var(--syntax-string, #4078f2)'},
    '.cm-code-number':{color:'var(--syntax-number, #986801)'},
    '.cm-code-comment':{color:'var(--muted, #777)',fontStyle:'italic'},
  }),
];
