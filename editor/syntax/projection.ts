import { parseDocument, type ParsedDocument, type SyntaxNode } from './parse';
import { MappingError, mapSemanticText, mapText, type TextMapping } from './mapping';
import type { SourceRange } from '../core/types';

export interface ProjectionNode extends SourceRange {
  id: string;
  type: string;
  raw: string;
  attributes: Readonly<Record<string, unknown>>;
  children: ProjectionNode[];
  text?: string;
  /** Text-local UTF16 to source. PM positions are assigned by the surface adapter. */
  mapping: TextMapping;
}
export interface DocumentProjection { source: string; syntax: ParsedDocument; blocks: ProjectionNode[] }

export function buildProjection(source: string): DocumentProjection {
  const syntax = parseDocument(source);
  const convert = (node: SyntaxNode): ProjectionNode => {
    let content = node.raw;
    let from = node.from;
    if (node.type === 'inlineMath') { content = content.slice(1, -1); from++; }
    if (node.type === 'inlineCode') {
      const fence = /^`+/.exec(content)?.[0].length ?? 0;
      content = content.slice(fence, -fence);
      from += fence;
      const normalized = content.replace(/\r\n?|\n/g, ' ');
      if (normalized.startsWith(' ') && normalized.endsWith(' ') && /[^ ]/.test(normalized)) {
        const leading = /^\r\n|^\r|^\n|^ /.exec(content)![0].length;
        const trailing = /\r\n$|\r$|\n$| $/.exec(content)![0].length;
        content = content.slice(leading, -trailing); from += leading;
      }
    }
    if ((node.type === 'code' || node.type === 'math') && node.attributes.fence) {
      const firstEnding = /\r\n|\r|\n/.exec(content);
      const bodyStart = firstEnding ? firstEnding.index + firstEnding[0].length : content.length;
      let bodyEnd = content.length;
      if (node.attributes.closed) {
        const endings = [...content.matchAll(/\r\n|\r|\n/g)];
        // AST normally ends at the closing fence, not its following newline.
        const closingLine = endings.at(-1);
        bodyEnd = closingLine ? closingLine.index + closingLine[0].length : bodyStart;
      }
      content = content.slice(bodyStart, bodyEnd); from += bodyStart;
    }
    let mapped = mapText(content, from);
    let type = node.type;
    let attributes = node.attributes;
    try {
      if (node.type === 'text' && node.value !== undefined) mapped = mapSemanticText(content, from, node.value);
      if ((node.type === 'code' || node.type === 'math') && node.value !== undefined) {
        const value = node.value.replace(/\r\n?|\n/g, '\n');
        const extraEndings = content.split(/\r\n|\r|\n/).length - value.split('\n').length;
        mapped = mapSemanticText(content, from, value + '\n'.repeat(Math.max(0, extraEndings)), false);
      }
      if (node.type === 'inlineCode') mapped = { ...mapped, text: mapped.text.replace(/\n/g, ' ') };
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      type = 'raw';
      attributes = { ...attributes, sourceType: node.type, mappingFallback: true };
      mapped = mapText(node.raw, node.from);
    }
    return {
      id: node.id, type, raw: node.raw, from: node.from, to: node.to,
      attributes, children: node.children.map(convert),
      ...(node.children.length === 0 ? { text: mapped.text } : {}), mapping: mapped.mapping,
    };
  };
  const blocks: ProjectionNode[] = [];
  const gap = (offset: number): void => {
    blocks.push({ id: `gap-${offset}`, type: 'gap', raw: '', from: offset, to: offset, attributes: {}, children: [], text: '', mapping: mapText('', offset).mapping });
  };
  const addGaps = (from: number, to: number, leading: boolean, trailing: boolean): void => {
    const raw = source.slice(from, to);
    const endings = [...raw.matchAll(/\r\n|\r|\n/g)].map(match => from + match.index + match[0].length);
    if (leading) {
      // Leading whitespace lines are editable; the last line belongs to the next block.
      const starts = [from, ...endings];
      for (const offset of starts) if (offset < to || trailing) gap(offset);
    } else {
      // Two line endings separate blocks. Each additional ending owns one blank.
      for (let i = 1; i < endings.length; i++) if (trailing || i < endings.length - 1) gap(endings[i]!);
    }
  };
  let cursor = source.startsWith('\uFEFF') ? 1 : 0;
  let first = true;
  for (const node of syntax.root.children) {
    addGaps(cursor, node.from, first, false);
    blocks.push(convert(node));
    cursor = node.to; first = false;
  }
  addGaps(cursor, source.length, syntax.root.children.length === 0, true);
  return { source, syntax, blocks };
}
