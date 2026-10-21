import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import type { Nodes } from 'mdast';
import type { Construct, Extension, State } from 'micromark-util-types';
import type { SourceRange } from '../core/types';

export interface SyntaxNode extends SourceRange {
  /** Identity is local to this parse. Never keep an ID across revisions without remapping. */
  id: string;
  type: string;
  raw: string;
  value?: string;
  attributes: Readonly<Record<string, unknown>>;
  children: SyntaxNode[];
}
export interface SourceSpan extends SourceRange { kind: 'content' | 'syntax' | 'gap' | 'raw'; nodeId: string }
export interface ParsedDocument { source: string; root: SyntaxNode; spans: SourceSpan[] }

/** Narrow upstream math to the project's single-dollar, single-line inline dialect. */
function mathDialect(source: string): Extension {
  const extension = math();
  const upstreamFlow = extension.flow?.[36] as Construct;
  const inline: Construct = {
    name: 'mathText',
    tokenize(effects, ok, nok) {
      const start = this.now().offset;
      if (source[start - 1] === '$' || source[start + 1] === '$' || /\s/.test(source[start + 1] ?? ' ')) return nok;
      let end = start + 1;
      while (end < source.length) {
        if (source[end] === '\r' || source[end] === '\n') return nok;
        if (source[end] === '$') {
          let slashes = 0;
          for (let i = end - 1; source[i] === '\\'; i--) slashes++;
          if (slashes % 2 === 0) break;
        }
        end++;
      }
      if (end >= source.length || /\s/.test(source[end - 1]!) || /[\d$]/.test(source[end + 1] ?? '')) return nok;
      let position = start;
      const content: State = code => {
        if (position === end) {
          effects.exit('mathTextData'); effects.enter('mathTextSequence'); effects.consume(code); effects.exit('mathTextSequence'); effects.exit('mathText'); return ok;
        }
        effects.consume(code); position++; return content;
      };
      return code => {
        effects.enter('mathText'); effects.enter('mathTextSequence'); effects.consume(code); effects.exit('mathTextSequence'); effects.enter('mathTextData'); position++; return content;
      };
    },
  };
  return {
    ...extension,
    text: { 36: inline },
    flow: { 36: { ...upstreamFlow, tokenize(effects, ok, nok) {
      if (!/^\$\$[\t ]*(?:\r\n|\r|\n|$)/.test(source.slice(this.now().offset))) return nok;
      return upstreamFlow.tokenize.call(this, effects, ok, nok);
    } } },
  };
}

export function parseDocument(source: string): ParsedDocument {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const input = source.slice(bom);
  const ast = fromMarkdown(source, { extensions: [gfm(), { disable: { null: ['gfmFootnoteDefinition', 'gfmFootnoteCall', 'gfmPotentialFootnoteCall'] } }, mathDialect(input)], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] });
  let nextId = 0;
  const convert = (node: Nodes): SyntaxNode => {
    const from = node.type === 'root' ? 0 : (node.position?.start.offset ?? 0) + bom;
    const to = node.type === 'root' ? source.length : (node.position?.end.offset ?? 0) + bom;
    const raw = source.slice(from, to);
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) if (!['type', 'position', 'children', 'value', 'data'].includes(key)) attributes[key] = value;
    if (node.type === 'code' || node.type === 'math') {
      const opening = /^(?:[ \t]*)(`{3,}|~{3,}|\$\$)/.exec(raw);
      if (opening) {
        const fence = opening[1]!;
        const lines = raw.split(/\r\n|\r|\n/);
        while (lines.at(-1) === '') lines.pop();
        const last = lines.at(-1) ?? '';
        attributes.closed = lines.length > 1 && new RegExp('^[ >\\t]*' + (fence[0] === '$' ? '\\$\\$' : fence[0] + '{' + fence.length + ',}') + '[ \\t]*$').test(last);
        attributes.fence = fence;
      } else attributes.closed = true;
    }
    return {
      id: `n${nextId++}`, type: node.type === 'html' ? 'raw' : node.type, from, to, raw,
      ...('value' in node ? { value: node.value } : {}), attributes,
      children: 'children' in node ? node.children.map(convert) : [],
    };
  };
  const root = convert(ast);
  const spans: SourceSpan[] = [];
  const cover = (node: SyntaxNode): void => {
    if (!node.children.length) {
      if (node.to > node.from) spans.push({ from: node.from, to: node.to, kind: node.type === 'raw' ? 'raw' : node.type === 'root' ? 'gap' : 'content', nodeId: node.id });
      return;
    }
    let cursor = node.from;
    for (const child of node.children) {
      if (child.from > cursor) spans.push({ from: cursor, to: child.from, kind: node.type === 'root' ? 'gap' : 'syntax', nodeId: node.id });
      cover(child);
      cursor = child.to;
    }
    if (cursor < node.to) spans.push({ from: cursor, to: node.to, kind: node.type === 'root' ? 'gap' : 'syntax', nodeId: node.id });
  };
  cover(root);
  return { source, root, spans };
}
