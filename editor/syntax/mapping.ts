import { decodeString } from 'micromark-util-decode-string';
import type { Affinity, SourceRange } from '../core/types';

export interface TextSegment extends SourceRange { textFrom: number; textTo: number }
export interface TextMapping { from: number; to: number; textLength: number; segments: readonly TextSegment[] }
export class MappingError extends Error {}
export interface MappedText { text: string; mapping: TextMapping }

/** Retains both endpoints of escapes, entities and CRLF normalization. */
export function mapText(raw: string, sourceFrom: number, decode = false): MappedText {
  let text = '';
  const segments: TextSegment[] = [];
  const tokens = /\r\n|\r|\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);|[\s\S]/gu;
  for (const match of raw.matchAll(tokens)) {
    const value = match[0];
    const decoded = value === '\r\n' || value === '\r' ? '\n' : decode ? decodeString(value) : value;
    const from = sourceFrom + match.index;
    segments.push({ from, to: from + value.length, textFrom: text.length, textTo: text.length + decoded.length });
    text += decoded;
  }
  return { text, mapping: { from: sourceFrom, to: sourceFrom + raw.length, textLength: text.length, segments } };
}

/** Remove parser-confirmed container prefixes, retaining their source gaps. */
export function mapSemanticText(raw: string, sourceFrom: number, value: string, decode = true): MappedText {
  const mapped = mapText(raw, sourceFrom, decode);
  const expected = value.replace(/\r\n?|\n/g, '\n');
  const rawLines = mapped.text.split('\n');
  const valueLines = expected.split('\n');
  if (rawLines.length !== valueLines.length) throw new MappingError('Semantic line count cannot be mapped safely');
  const segments: TextSegment[] = [];
  let rawOffset = 0;
  let textOffset = 0;
  let segmentIndex = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    const valueLine = valueLines[i]!;
    if (!rawLine.endsWith(valueLine)) throw new MappingError('Semantic text cannot be mapped safely');
    const start = rawOffset + rawLine.length - valueLine.length;
    const end = rawOffset + rawLine.length + (i < rawLines.length - 1 ? 1 : 0);
    while (segmentIndex < mapped.mapping.segments.length) {
      const segment = mapped.mapping.segments[segmentIndex]!;
      if (segment.textFrom >= end) break;
      if (segment.textFrom >= start && segment.textTo <= end) segments.push({ ...segment, textFrom: textOffset + segment.textFrom - start, textTo: textOffset + segment.textTo - start });
      segmentIndex++;
    }
    rawOffset += rawLine.length + 1;
    textOffset += valueLine.length + 1;
  }
  return { text: expected, mapping: { from: segments[0]?.from ?? sourceFrom, to: segments.at(-1)?.to ?? sourceFrom, textLength: expected.length, segments } };
}

/** Project only tokenizer-confirmed code data; validate against parser semantics. */
export function mapInlineCode(source: string, ranges: readonly SourceRange[], value: string, table: boolean): MappedText {
  let text = '';
  const segments: TextSegment[] = [];
  for (const range of ranges) {
    const mapped = mapText(source.slice(range.from, range.to), range.from);
    for (const segment of mapped.mapping.segments) {
      const raw = source.slice(segment.from, segment.to);
      const decoded = /^\r\n$|^[\r\n]$/.test(raw) ? ' ' : table && raw === '\\|' ? '|' : raw;
      segments.push({ from: segment.from, to: segment.to, textFrom: text.length, textTo: text.length + decoded.length });
      text += decoded;
    }
  }
  if (text !== value.replace(/\r\n?|\n/g, ' ')) throw new MappingError('Inline code semantics cannot be mapped safely');
  const from = segments[0]?.from ?? ranges[0]?.from ?? 0;
  const to = segments.at(-1)?.to ?? from;
  return { text, mapping: { from, to, textLength: text.length, segments } };
}

export function mapTextToSource(mapping: TextMapping, offset: number, affinity: Affinity = 'after'): number {
  if (!Number.isInteger(offset) || offset < 0 || offset > mapping.textLength) throw new RangeError('Text offset out of range');
  const candidates: number[] = [];
  for (const segment of mapping.segments) {
    if (offset < segment.textFrom || offset > segment.textTo) continue;
    if (segment.to - segment.from === segment.textTo - segment.textFrom) candidates.push(segment.from + offset - segment.textFrom);
    else if (offset === segment.textFrom) candidates.push(segment.from);
    else if (offset === segment.textTo) candidates.push(segment.to);
    else candidates.push(affinity === 'before' ? segment.from : segment.to);
  }
  if (candidates.length) return affinity === 'before' ? Math.min(...candidates) : Math.max(...candidates);
  if (offset === 0) return mapping.from;
  if (offset === mapping.textLength) return mapping.to;
  throw new RangeError('Unmapped text position');
}
export function mapSourceToText(mapping: TextMapping, offset: number, affinity: Affinity = 'after'): number {
  if (!Number.isInteger(offset) || offset < mapping.from || offset > mapping.to) throw new RangeError('Source offset out of range');
  let previous = 0;
  for (const segment of mapping.segments) {
    if (offset < segment.from) return previous;
    if (offset <= segment.to) {
      if (segment.to - segment.from === segment.textTo - segment.textFrom) return segment.textFrom + offset - segment.from;
      if (offset === segment.from) return segment.textFrom;
      if (offset === segment.to) return segment.textTo;
      return affinity === 'before' ? segment.textFrom : segment.textTo;
    }
    previous = segment.textTo;
  }
  return mapping.textLength;
}
