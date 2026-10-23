import type { Extension } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { cppLanguage } from "@codemirror/lang-cpp";
import { tags } from "@lezer/highlight";

// Parser-only extensions: no completion, auto-closing, local history or network.
export function codeLanguage(name: string): Extension {
  switch (name.trim().toLowerCase()) {
    case "js":
    case "javascript":
      return javascriptLanguage;
    case "c":
    case "h":
    case "cpp":
    case "c++":
    case "cc":
    case "cxx":
    case "hpp":
      return cppLanguage;
    default:
      return [];
  }
}
export const codeHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, class: "tok-keyword" },
    { tag: [tags.string, tags.special(tags.string)], class: "tok-string" },
    { tag: [tags.number, tags.bool, tags.null], class: "tok-number" },
    { tag: tags.comment, class: "tok-comment" },
    { tag: [tags.typeName, tags.className], class: "tok-type" },
    { tag: tags.function(tags.variableName), class: "tok-function" },
  ]),
);
