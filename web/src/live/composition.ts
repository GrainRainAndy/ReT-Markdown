import type { Patch } from '../protocol';

/** Smallest single replacement, widened to Unicode scalar boundaries. */
export function netPatch(before: string, after: string, offset = 0): Patch | null {
  if (before === after) return null;
  let from = 0, oldEnd = before.length, newEnd = after.length;
  while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
  const low = (s:string, i:number) => /[\udc00-\udfff]/.test(s[i] ?? '');
  if (low(before, from) || low(after, from)) from--;
  while (oldEnd > from && newEnd > from && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (low(before, oldEnd) || low(after, newEnd)) { oldEnd++; newEnd++; }
  const insert = after.slice(from, newEnd);
  return { from: offset + from, to: offset + oldEnd, insert, eols: Array.from(insert.matchAll(/\n/g), () => '\n' as const) };
}
