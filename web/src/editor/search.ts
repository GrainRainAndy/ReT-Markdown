import type { Range, Source, Patch } from '../protocol';
import { decodeSource } from './source';
export interface FindOptions { query: string; caseSensitive?: boolean; regexp?: boolean; backwards?: boolean; replacement?: string }
export function findRanges(text: string, options: FindOptions): Range[] {
  if (!options.query) return [];
  const pattern = options.regexp ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu');
  const ranges: Range[] = [];
  for (const match of text.matchAll(re)) if (match[0].length) ranges.push({ from: match.index, to: match.index + match[0].length });
  return ranges;
}
export function replacePatches(source: Source, options: FindOptions, ranges = findRanges(source.text, options)): Patch[] {
  const replacement = decodeSource(new TextEncoder().encode(options.replacement ?? ''));
  if (replacement.bom) replacement.text = '\uFEFF' + replacement.text;
  return ranges.map(range => ({ ...range, insert: replacement.text, eols: [...replacement.eols] }));
}
export function nextRange(ranges: Range[], position: number, backwards = false): Range | undefined {
  return backwards ? [...ranges].reverse().find(r => r.to <= position) ?? ranges.at(-1)
    : ranges.find(r => r.from >= position) ?? ranges[0];
}
