import MarkdownIt from 'markdown-it';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Mode, Range, Selection, Source } from '../protocol';
import { decodeSource, encodeSource } from './source';
import { newlineCount } from './history';
import { plainText, richClipboard, type RenderOptions } from '../render/markdown';
import { validateMarkdownLink } from '../render/link-policy';

export type ClipboardPayload = { text: string; html?: string };
export type PasteInput = { text: string | null; html?: string; hasImage?: boolean };
export interface InlineSelectionSpan extends Range { contentFrom: number; contentTo: number }

// Parse logical references with the same CommonMark engine/link policy as the renderer.
// The parser consumes continuation lines and container prefixes; raw source ranges do not.
const referenceParser = new MarkdownIt({ html: true, linkify: false, typographer: false });
referenceParser.validateLink = validateMarkdownLink;
function conversionContext(text: string): string {
  const env: { references?: Record<string, { href: string; title: string }> } = {};
  referenceParser.parse(text, env);
  const escape = (value: string) => referenceParser.utils.escapeHtml(value.replace(/\\/g, '\\\\'))
    .replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
  // Parsed labels retain their Markdown escapes and already have normalized whitespace.
  // The parser keeps only the first definition; serialize its semantic URL/title safely.
  return Object.entries(env.references ?? {}).map(([label, ref]) =>
    `[${label}]: <${escape(ref.href)}> "${escape(ref.title)}"`).join('\n');
}

function inlineSpans(text: string): InlineSelectionSpan[] {
  const spans: InlineSelectionSpan[] = [];
  markdownLanguage.parser.parse(text).iterate({ enter(node) {
    if (!['StrongEmphasis', 'Emphasis', 'InlineCode', 'Strikethrough', 'Link', 'Image'].includes(node.name)) return;
    const children = node.node;
    const first = children.firstChild;
    if (!first) return;
    if (node.name === 'Link' || node.name === 'Image') {
      let mark = first.nextSibling;
      while (mark && mark.name !== 'LinkMark') mark = mark.nextSibling;
      if (mark) spans.push({ from: node.from, to: node.to, contentFrom: first.to, contentTo: mark.from });
    } else {
      const last = children.lastChild;
      if (last) spans.push({ from: node.from, to: node.to, contentFrom: first.to, contentTo: last.from });
    }
  } });
  return spans;
}
export function selectedRange(source: Source, selection: Selection, mode: Mode, spans = inlineSpans(source.text)): Range {
  let from = Math.min(selection.anchor, selection.head), to = Math.max(selection.anchor, selection.head);
  if (mode === 'live' && from !== to) {
    // Revisit outer spans after nested contents expand to their complete source.
    let expanded: boolean;
    do {
      expanded = false;
      for (const span of spans) if (from <= span.contentFrom && to >= span.contentTo && from < span.to && to > span.from) {
        const a = Math.min(from, span.from), b = Math.max(to, span.to);
        if (a !== from || b !== to) { from = a; to = b; expanded = true; }
      }
    } while (expanded);
  }
  return { from, to };
}
export function sourceSelection(source: Source, selection: Selection, mode: Mode): string {
  const { from, to } = selectedRange(source, selection, mode);
  const text = source.text.slice(from, to), first = newlineCount(source.text.slice(0, from));
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(encodeSource({ text, eols: source.eols.slice(first, first + newlineCount(text)), bom: false }));
}
export function clipboardPayload(source: Source, selection: Selection, mode: Mode, format: 'source' | 'plain' | 'rich' = 'source', options?: RenderOptions): ClipboardPayload {
  const selected = sourceSelection(source, selection, mode);
  if (format === 'source') return { text: selected };
  const normalized = selected.replace(/\r\n|\r/g, '\n');
  const definitions = conversionContext(source.text);
  // Canonical, container-free definitions are invisible to the existing renderer helpers.
  const contextual = definitions ? definitions + '\n\n' + normalized : normalized;
  return format === 'plain' ? { text: plainText(contextual) } : richClipboard(contextual, options);
}
export function pastePayload(input: PasteInput): { kind: 'text'; source: Source } | { kind: 'image' } | { kind: 'none' } {
  if (input.text !== null && input.text !== '') {
    const source = decodeSource(new TextEncoder().encode(input.text));
    // A clipboard-leading U+FEFF is content, not a file-level BOM.
    if (source.bom) { source.text = '\uFEFF' + source.text; source.bom = false; }
    return { kind: 'text', source };
  }
  return input.hasImage ? { kind: 'image' } : { kind: 'none' };
}
