import { referenceResolver } from './references';
import { parseDocument, type ParsedDocument, type SyntaxNode } from './parse';
import { MappingError, mapInlineCode, mapSemanticText, mapText, type TextMapping } from './mapping';
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
  const resolve = referenceResolver(syntax.root);
  const convert = (node: SyntaxNode): ProjectionNode => {
    // Container parsers may stop an empty unclosed fence before its existing
    // ending at EOF. Only then is it a free body anchor; before another block,
    // retain that ending as the separator after newly inserted literal content.
    if (node.attributes.fence && !node.attributes.closed && !/[\r\n]/.test(node.raw)) {
      const ending = /^(\r\n|\r|\n)/.exec(source.slice(node.to));
      if (ending && node.to + ending[0].length === source.length)
        node = { ...node, to: node.to + ending[0].length, raw: node.raw + ending[0] };
    }
    let content = node.raw;
    let from = node.from;
    if (node.type === 'inlineMath') { content = content.slice(1, -1); from++; }
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
    let attributes = resolve(node);
    try {
      if (node.type === 'text' && node.value !== undefined) mapped = mapSemanticText(content, from, node.value);
      if ((node.type === 'code' || node.type === 'math') && node.value !== undefined) {
        const value = node.value.replace(/\r\n?|\n/g, '\n');
        const extraEndings = content.split(/\r\n|\r|\n/).length - value.split('\n').length;
        mapped = mapSemanticText(content, from, value + '\n'.repeat(Math.max(0, extraEndings)), false);
        // An empty semantic line may still contain a parser-confirmed container
        // prefix. Insert after those existing bytes rather than duplicating them.
        if (!mapped.text) mapped = mapText('', from + content.length);
      }
      if (node.type === 'inlineCode' && node.value !== undefined) mapped = mapInlineCode(source, node.contentRanges ?? [], node.value, node.attributes.gfmTableCode === true);
    } catch (error) {
      if (!(error instanceof MappingError)) throw error;
      type = 'raw';
      attributes = { ...attributes, sourceType: node.type, mappingFallback: true };
      mapped = mapText(node.raw, node.from);
    }
    const children = node.children.map(convert);
    if (node.type === 'table') {
      const width = children[0]?.children.length ?? 0;
      children.forEach((row, rowIndex) => {
        const count = row.children.length;
        const trailingPipe = /(\\*)\|[ \t]*$/.exec(row.raw);
        row.children = Array.from({ length: width }, (_, column) => {
          const cell = row.children[column];
          if (cell) return { ...cell, attributes: { ...cell.attributes, row: rowIndex, column } };
          return {
            id: `${row.id}-virtual-${column}`, type: 'tableCell', raw: '',
            from: row.to, to: row.to, text: '', children: [],
            attributes: { virtual: true, row: rowIndex, column, missingBefore: column - count,
              needsSeparator: !trailingPipe || trailingPipe[1]!.length % 2 !== 0 },
            mapping: mapText('', row.to).mapping,
          };
        });
      });
    }
    return {
      id: node.id, type, raw: node.raw, from: node.from, to: node.to,
      attributes, children,
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
      for (let i = 0; i < starts.length; i++)
        if (i < endings.length || trailing) gap(starts[i]!);
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
