import type { EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Patch, Selection, Source } from '../protocol';
import { inheritedEOL, newlineCount } from './history';

export interface CommandTarget {
  readonly state: EditorState;
  getSource(): Source;
  selection(): Selection;
  edit(patches: readonly Patch[], options?: { selection?: Selection; userEvent?: string }): void;
}
export type FormatOptions = { kind: string; level?: number; url?: string; marker?: string; language?: string };
function patch(source: Source, from: number, to: number, insert: string): Patch {
  return { from, to, insert, eols: Array(newlineCount(insert)).fill(inheritedEOL(source, from)) };
}
function listItemAt(tree: ReturnType<typeof markdownLanguage.parser.parse>, position: number) {
  let item: ReturnType<typeof tree.resolveInner> | null = null;
  for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(position, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return null;
    if (!item && node.name === 'ListItem') item = node;
  }
  return item;
}
function columns(text: string): number {
  let column = 0;
  for (const character of text) column += character === '\t' ? 4 - column % 4 : 1;
  return column;
}

export function format(target: CommandTarget, options: FormatOptions): void {
  const source = target.getSource(), selection = target.selection();
  const from = Math.min(selection.anchor, selection.head), to = Math.max(selection.anchor, selection.head);
  const text = source.text.slice(from, to), line = target.state.doc.lineAt(from);
  const kind = options.kind;
  const wrap = (open: string, close = open) => {
    // Toggle existing delimiters without rewriting any surrounding source.
    if (source.text.slice(Math.max(0, from - open.length), from) === open && source.text.slice(to, to + close.length) === close) {
      target.edit([patch(source, from - open.length, from, ''), patch(source, to, to + close.length, '')], { selection: { anchor: from - open.length, head: to - open.length } });
    } else target.edit([patch(source, from, from, open), patch(source, to, to, close)], { selection: { anchor: from + open.length, head: to + open.length } });
  };
  if (kind === 'bold') return wrap('**');
  if (kind === 'italic') return wrap('*');
  if (kind === 'strike' || kind === 'strikethrough') return wrap('~~');
  if (kind === 'code' || kind === 'inlineCode') {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(s => s.length));
    const fence = '`'.repeat(longest + 1), pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
    return wrap(fence + pad, pad + fence);
  }
  if (kind === 'link') return wrap('[', `](${options.url ?? 'https://' })`);
  if (kind === 'codeBlock') {
    const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(s => s.length));
    const fence = '`'.repeat(longest + 1);
    const open = (from > line.from ? '\n' : '') + `${fence}${options.language ?? ''}\n`;
    const close = (text.endsWith('\n') ? '' : '\n') + fence + (to < source.text.length && source.text[to] !== '\n' ? '\n' : '');
    target.edit([patch(source, from, from, open), patch(source, to, to, close)],
      { selection: { anchor: from + open.length, head: to + open.length } });
    return;
  }
  if (kind === 'newline') {
    const prefix = /^(\s*)((?:[-+*]|\d+[.)])\s+)(\[[ xX]\]\s+)?/.exec(line.text);
    const item = listItemAt(markdownLanguage.parser.parse(source.text), from);
    if (prefix && item && from === to && from >= line.from + prefix[0].length) {
      if (line.text.slice(prefix[0].length).trim() === '') {
        target.edit([patch(source, line.from, line.to, '')], { selection: { anchor: line.from, head: line.from } }); return;
      }
      let marker = prefix[2];
      marker = marker.replace(/^\d+/, n => String(Number(n) + 1));
      const insert = '\n' + prefix[1] + marker + (prefix[3] ? '[ ] ' : '');
      const end = from + insert.length;
      target.edit([patch(source, from, to, insert)], { selection: { anchor: end, head: end }, userEvent: 'input' }); return;
    }
    const insert = '\n' + (/^[\t ]*/.exec(line.text)?.[0] ?? '');
    target.edit([patch(source, from, to, insert)], { selection: { anchor: from + insert.length, head: from + insert.length } }); return;
  }
  const last = target.state.doc.lineAt(to > from ? to - 1 : to);
  const patches: Patch[] = [];
  if (kind === 'indent' || kind === 'outdent') {
    const tree = markdownLanguage.parser.parse(source.text), affected = new Map<number, string>();
    for (let n = line.number; n <= last.number; n++) {
      if (affected.has(n)) continue;
      const selected = target.state.doc.line(n);
      const item = listItemAt(tree, selected.from + (/^[\t ]*/.exec(selected.text)![0].length) + (selected.text.trim() ? 1 : 0));
      const first = item ? target.state.doc.lineAt(item.from).number : n;
      const end = item ? target.state.doc.lineAt(Math.max(item.from, item.to - 1)).number : n;
      const root = target.state.doc.line(first);
      // Remove the root's actual indentation uniformly; never outdent its children alone.
      const remove = /^(?: {1,2}|\t)/.exec(root.text)?.[0] ?? '';
      for (let child = first; child <= end; child++) if (!affected.has(child)) affected.set(child, remove);
    }
    for (const [n, remove] of [...affected].sort(([a], [b]) => a - b)) {
      const l = target.state.doc.line(n);
      if (kind === 'indent') patches.push(patch(source, l.from, l.from, '  '));
      else if (remove && l.text.startsWith(remove)) patches.push(patch(source, l.from, l.from + remove.length, ''));
    }
    target.edit(patches); return;
  }
  if (kind === 'list' || kind === 'bulletList' || kind === 'unorderedList' || kind === 'orderedList' || kind === 'taskList') {
    const requested = options.marker ?? '-';
    if (kind !== 'orderedList' && !/^[-+*]$|^\d+[.)]$/.test(requested)) throw new Error('Invalid list marker');
    const tree = markdownLanguage.parser.parse(source.text);
    type Item = NonNullable<ReturnType<typeof listItemAt>>;
    const items = new Map<number, Item>(), codeLines = new Set<number>();
    const quoteCounts = new Map<number, number>(), literalStarts = new Map<number, number>(), fenceColumns = new Map<number, number>();
    tree.iterate({ enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        const first = target.state.doc.lineAt(node.from).number;
        const end = target.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let n = first; n <= end; n++) codeLines.add(n);
        if (node.name === 'FencedCode') {
          const opening = target.state.doc.lineAt(node.from);
          const column = columns(source.text.slice(opening.from, node.from));
          for (let n = first + 1; n <= end; n++) fenceColumns.set(n, column);
        }
      }
      const n = target.state.doc.lineAt(node.from).number;
      if (node.name === 'QuoteMark') quoteCounts.set(n, (quoteCounts.get(n) ?? 0) + 1);
      if (node.name === 'CodeText' && node.node.parent?.name === 'CodeBlock') literalStarts.set(n, node.from);
      if (node.name === 'ListItem') {
        const mark = node.node.getChild('ListMark');
        if (mark) items.set(target.state.doc.lineAt(mark.from).number, node.node);
      }
    } });
    const seen = new Set<number>(), counts = new Map<string, number>(), selectedMarkers = new Map<number, string>();
    for (let n = line.number; n <= last.number; n++) {
      // A real item marker may precede code on the same line. Resolve that
      // item below, but leave lines wholly inside its code body untouched.
      if (codeLines.has(n) && !items.has(n)) continue;
      const l = target.state.doc.line(n), indent = /^[\t ]*/.exec(l.text)![0].length;
      if (!l.text.trim() && from !== to) continue;
      // A continuation acts on its owning item, never on its literal line prefix.
      const item = items.get(n) ?? listItemAt(tree, l.from + indent + (l.text.trim() ? 1 : 0));
      const mark = item?.getChild('ListMark');
      // Resolve the owner first: a later paragraph must not insert a checkbox
      // into that item's code-opening line (or change its marker/indentation).
      if (mark && kind === 'taskList' && codeLines.has(target.state.doc.lineAt(mark.from).number)) continue;
      if (mark && seen.has(mark.from)) continue;
      if (mark) seen.add(mark.from);
      // Adjacent lists with different bullet tokens still share a sibling sequence.
      const container = item?.parent?.parent;
      const scope = container ? `${container.name}:${container.from}` : 'Document:0';
      const ordinal = (counts.get(scope) ?? 0) + 1;
      counts.set(scope, ordinal);
      const previous = mark ? source.text.slice(mark.from, mark.to) : '';
      const ordered = /^\d+[.)]$/.test(previous);
      const marker = kind === 'orderedList' ? (ordered ? previous : `${ordinal}.`)
        : options.marker ?? (previous && !ordered ? previous : requested);
      if (!mark) {
        patches.push(patch(source, l.from + indent, l.from + indent, marker + (kind === 'taskList' ? ' [ ] ' : ' ')));
        continue;
      }
      const root = target.state.doc.lineAt(mark.from);
      const gap = /^[\t ]*/.exec(source.text.slice(mark.to, root.to))![0];
      selectedMarkers.set(mark.from, marker);
      const task = item!.getChild('Task')?.getChild('TaskMarker');
      if (kind === 'taskList') {
        // Keep an existing checkbox (including x/X) and all original separator bytes.
        if (!task) {
          const at = mark.to + gap.length;
          patches.push(patch(source, at, at, (gap ? '' : ' ') + '[ ] '));
        }
      } else if (task) {
        const gap = /^[\t ]*/.exec(source.text.slice(task.to, target.state.doc.lineAt(task.to).to))![0];
        patches.push(patch(source, task.from, task.to + gap.length, ''));
      }
    }
    const containerPattern = (quotes: number) => new RegExp(`^[\\t ]*(?:>[\\t ]*){0,${quotes}}`);
    const originalPrefixes = new Map<number, string>(), prefixes = new Map<number, string>();
    const originalPrefix = (n: number) => {
      let prefix = originalPrefixes.get(n);
      if (prefix !== undefined) return prefix;
      const l = target.state.doc.line(n);
      prefix = containerPattern(quoteCounts.get(n) ?? 0).exec(l.text)![0];
      // Code-body whitespace is literal. Restrict indentation edits to the
      // grammar's stripped prefix, including any partial-tab overhang.
      const literal = literalStarts.get(n);
      if (literal !== undefined) prefix = prefix.slice(0, literal - l.from);
      const fence = fenceColumns.get(n);
      if (fence !== undefined) {
        let end = 0;
        while (end < prefix.length && columns(prefix.slice(0, end)) < fence) end++;
        prefix = prefix.slice(0, end);
      }
      originalPrefixes.set(n, prefix);
      return prefix;
    };
    const shiftPrefix = (n: number, pattern: RegExp, delta: number) => {
      const before = prefixes.get(n) ?? originalPrefix(n), part = pattern.exec(before)![0];
      const desired = columns(part) + delta;
      const whitespace = /[\t ]*$/.exec(part)![0];
      if (desired < columns(part.slice(0, part.length - whitespace.length))) return false;
      let end = part.length;
      while (end > 0 && columns(part.slice(0, end)) > desired) end--;
      let after = part.slice(0, end) + ' '.repeat(desired - columns(part.slice(0, end)));
      // Deeper quote/container tabs must translate by the same delta. This
      // suffix contains container syntax only; literal code tabs are excluded.
      let oldColumn = columns(part), newColumn = columns(after);
      for (const ch of before.slice(part.length)) {
        const width = ch === '\t' ? 4 - oldColumn % 4 : 1;
        after += ch === '\t' && width !== 4 - newColumn % 4 ? ' '.repeat(width) : ch;
        oldColumn += width; newColumn += width;
      }
      prefixes.set(n, after);
      return true;
    };
    const codeGapBody = (gap: string, column: number) => {
      const body = column + 5; // one list separator plus four code columns
      let end = 0;
      while (end < gap.length && column < body) {
        column += gap[end++] === '\t' ? 4 - column % 4 : 1;
      }
      return ' '.repeat(Math.max(0, column - body)) + gap.slice(end);
    };
    // Plan in source order so every descendant sees its effective prefix,
    // even if it was unselected or its marker already matches the command.
    for (const [n, item] of items) {
      const mark = item.getChild('ListMark')!, root = target.state.doc.line(n);
      const previous = source.text.slice(mark.from, mark.to), marker = selectedMarkers.get(mark.from) ?? previous;
      if (marker === previous && !prefixes.has(n)) continue;
      const before = source.text.slice(root.from, mark.from), after = prefixes.get(n) ?? before;
      const inherited = columns(after) - columns(before);
      const gap = /^[\t ]*/.exec(source.text.slice(mark.to, root.to))![0];
      const oldMarkColumn = columns(before + previous), newMarkColumn = columns(after + marker);
      const oldGapWidth = columns(before + previous + gap) - oldMarkColumn;
      const newGapWidth = columns(after + marker + gap) - newMarkColumn;
      const code = oldGapWidth > 4;
      let nextGap = gap;
      if (code) {
        const body = codeGapBody(gap, oldMarkColumn);
        if (newGapWidth <= 4 || codeGapBody(gap, newMarkColumn) !== body) nextGap = '     ' + body;
      } else if (newGapWidth !== oldGapWidth && (inherited !== 0 || newGapWidth > 4)) nextGap = ' '.repeat(oldGapWidth);
      const oldColumn = code ? oldMarkColumn + 1 : columns(before + previous + gap);
      let delta = (code ? newMarkColumn + 1 : columns(after + marker + nextGap)) - oldColumn - inherited;
      const pattern = containerPattern((before.match(/>/g) ?? []).length);
      const end = target.state.doc.lineAt(Math.max(item.from, item.to - 1)).number;
      const continuations: number[] = [];
      for (let child = n + 1; child <= end; child++) {
        const l = target.state.doc.line(child), indent = pattern.exec(l.text)![0];
        if (l.text.slice(indent.length) && columns(indent) >= oldColumn) continuations.push(child);
      }
      let replacement = marker;
      const padded = marker + ' '.repeat(Math.max(0, -delta));
      if (continuations.length && marker !== previous && delta < 0 && !code &&
          columns(after + padded + nextGap) - newMarkColumn <= 4 &&
          columns(after + padded + nextGap) === oldColumn + inherited) {
        replacement = padded; delta = 0;
      }
      if (delta) for (const child of continuations) {
        // If a structural prefix cannot absorb the shift, preserve the source
        // conservatively instead of emitting a partially planned conversion.
        if (!shiftPrefix(child, pattern, delta)) return;
      }
      if (replacement !== previous || nextGap !== gap) patches.push(patch(source, mark.from,
        mark.to + (nextGap === gap ? 0 : gap.length), replacement + (nextGap === gap ? '' : nextGap)));
    }
    for (const [n, after] of prefixes) {
      const before = originalPrefix(n), oldParts = before.split('>'), newParts = after.split('>');
      let at = target.state.doc.line(n).from;
      for (let part = 0; part < oldParts.length; part++) {
        const old = oldParts[part], next = newParts[part];
        let first = 0, last = 0;
        while (first < old.length && first < next.length && old[first] === next[first]) first++;
        while (last < old.length - first && last < next.length - first && old[old.length - 1 - last] === next[next.length - 1 - last]) last++;
        if (old !== next) patches.push(patch(source, at + first, at + old.length - last, next.slice(first, next.length - last)));
        at += old.length + 1;
      }
    }
    // A continuation can target a marker before the selected lines.
    target.edit(patches.sort((a, b) => a.from - b.from || a.to - b.to)); return;
  }
  for (let n = line.number; n <= last.number; n++) {
    const l = target.state.doc.line(n);
    if (kind === 'heading') {
      const level = options.level ?? 1;
      if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error('Heading level must be 1–6');
      const previous = /^(#{1,6})[\t ]+/.exec(l.text);
      patches.push(patch(source, l.from, l.from + (previous?.[0].length ?? 0), '#'.repeat(level) + ' '));
    } else if (kind === 'quote') patches.push(patch(source, l.from, l.from, '> '));
    else throw new Error(`Unknown format: ${kind}`);
  }
  target.edit(patches);
}


/** Native has already imported these images and installed their capabilities. */
export function insertImages(target: CommandTarget, destinations: readonly string[], alt = ''): void {
  if (!destinations.length || destinations.some(d => typeof d !== 'string' || !d || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(d))) throw new Error('Image destinations must be local relative paths');
  if (typeof alt !== 'string') throw new Error('Image alt must be text');
  const label = alt.replace(/[\\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
  const escapeDestination = (destination: string) => destination.replace(/[\u0000-\u0020<>"\\?#]/g, character => encodeURIComponent(character));
  const insert = destinations.map(destination => `![${label}](<${escapeDestination(destination)}>)`).join('\n');
  const source = target.getSource(), selection = target.selection();
  const from = Math.min(selection.anchor, selection.head), to = Math.max(selection.anchor, selection.head);
  target.edit([patch(source, from, to, insert)], { selection: { anchor: from + insert.length, head: from + insert.length } });
}
