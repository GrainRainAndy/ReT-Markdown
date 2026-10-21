import { fromMarkdown, type CompileContext, type Extension as MdastExtension } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import type { Nodes } from 'mdast';
import type { Construct, Extension, State, Token } from 'micromark-util-types';
import type { SourceRange } from '../core/types';

export interface SyntaxNode extends SourceRange {
  /** Identity is local to this parse. Never keep an ID across revisions without remapping. */
  id: string;
  type: string;
  raw: string;
  value?: string;
  /** Actual inline-code data tokens; excludes fences, padding and container prefixes. */
  contentRanges?: SourceRange[];
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
      const content: State = code => {
        if (code === 36 && this.now().offset === end) {
          effects.exit('mathTextData'); effects.enter('mathTextSequence'); effects.consume(code); effects.exit('mathTextSequence'); effects.exit('mathText'); return ok;
        }
        effects.consume(code); return content;
      };
      return code => {
        effects.enter('mathText'); effects.enter('mathTextSequence'); effects.consume(code); effects.exit('mathTextSequence'); effects.enter('mathTextData'); return content;
      };
    },
  };
  return {
    ...extension,
    text: { 36: inline },
    flow: { 36: { ...upstreamFlow, tokenize(effects, ok, nok) {
      if (!/^\$\$[\t ]*(?:\r\n|\r|\n|$)/.test(source.slice(this.now().offset))) return nok;
      const context = this;
      return upstreamFlow.tokenize.call(this, {
        ...effects,
        attempt(construct, success, failure) {
          // Upstream attempts a closing fence at a non-lazy line start, and
          // continuation at an EOL. A longer standalone dollar line is body
          // text in this dialect, so its closing attempt must fail untouched.
          return code => {
            if (failure && /^[ \t]*\${3,}[ \t]*(?:\r\n|\r|\n|$)/.test(source.slice(context.now().offset))) return failure(code);
            return effects.attempt(construct, success, failure)(code);
          };
        },
      }, ok, nok);
    } } },
  };
}

export function parseDocument(source: string): ParsedDocument {
  const bom = source.startsWith('\uFEFF') ? 1 : 0;
  const input = source.slice(bom);
  const fences = new Map<number, SourceRange[]>();
  const codeRanges = new Map<number, { ranges: SourceRange[]; table: boolean }>();
  function recordCodeRange(this: CompileContext, token: Token): void {
    const code = [...this.stack].reverse().find(node => node.type === 'inlineCode');
    const offset = code?.position?.start.offset;
    if (offset === undefined) return;
    const entry = codeRanges.get(offset) ?? { ranges: [], table: this.stack.some(node => node.type === 'tableCell') };
    entry.ranges.push({ from: token.start.offset + bom, to: token.end.offset + bom });
    codeRanges.set(offset, entry);
  }
  function recordFence(this: CompileContext, token: Token): void {
    const literal = [...this.stack].reverse().find(node => node.type === 'code' || node.type === 'math');
    const offset = literal?.position?.start.offset;
    if (offset === undefined) return;
    const ranges = fences.get(offset) ?? [];
    ranges.push({ from: token.start.offset + bom, to: token.end.offset + bom });
    fences.set(offset, ranges);
  }
  const provenance: MdastExtension = { enter: {
    codeTextData(token) {
      recordCodeRange.call(this, token);
      this.config.enter.data!.call(this, token);
    },
    lineEnding: recordCodeRange,
    codeFencedFence: recordFence,
    mathFlowFence: recordFence,
  } };
  const ast = fromMarkdown(source, { extensions: [gfm(), { disable: { null: ['gfmFootnoteDefinition', 'gfmFootnoteCall', 'gfmPotentialFootnoteCall'] } }, mathDialect(input)], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown(), provenance] });
  let nextId = 0;
  const convert = (node: Nodes): SyntaxNode => {
    const from = node.type === 'root' ? 0 : (node.position?.start.offset ?? 0) + bom;
    const to = node.type === 'root' ? source.length : (node.position?.end.offset ?? 0) + bom;
    const raw = source.slice(from, to);
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) if (!['type', 'position', 'children', 'value', 'data'].includes(key)) attributes[key] = value;
    if (node.type === 'code' || node.type === 'math') {
      const ranges = fences.get(from - bom);
      const opening = ranges?.[0];
      if (opening) {
        const fence = /^[ \t]*(`{3,}|~{3,}|\$\$)/.exec(source.slice(opening.from, opening.to))?.[1];
        attributes.closed = ranges!.length > 1;
        attributes.fence = fence;
      } else attributes.closed = true;
    }
    const code = node.type === 'inlineCode' ? codeRanges.get(from - bom) : undefined;
    if (code) attributes.gfmTableCode = code.table;
    return {
      ...(code ? { contentRanges: code.ranges } : {}),
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
