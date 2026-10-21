import { ChangeSet, type EditorState } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Mode, Patch, Range, Selection, Source } from '../protocol';
import { inheritedEOL, newlineCount } from './history';
import { isLiteralRange, isLiteralBlockRange, isOrdinaryParagraphRange, structureContext } from './structure';

export interface CommandTarget {
  readonly state: EditorState;
  getSource(): Source;
  selection(): Selection;
  getMode?(): Mode;
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

function quotePrefix(text: string, depth = Infinity): string {
  let prefix = '';
  while (depth-- > 0) {
    const next = /^[\t ]*>[\t ]?/.exec(text.slice(prefix.length));
    if (!next) break;
    prefix += next[0];
  }
  return prefix;
}

/** The inverse boundary of live ordinary paragraph splitting, not a generic delete. */
export function joinParagraphBackward(target: CommandTarget): boolean {
  const source = target.getSource(), { anchor, head } = target.selection(), at = head;
  if (target.getMode?.() !== 'live' || anchor !== head || at < 2 ||
      source.text.slice(at - 2, at) !== '\n\n' || source.text[at - 3] === '\n' ||
      target.state.doc.lineAt(at).from !== at || !source.text.slice(at).trim()) return false;
  const { paragraphs } = structureContext(source.text);
  if (!paragraphs.some(p => p.to === at - 2) || !paragraphs.some(p => p.from === at) ||
      isLiteralRange(source.text, at - 2) || isLiteralRange(source.text, at)) return false;
  target.edit([patch(source, at - 2, at, '')], { selection: { anchor: at - 2, head: at - 2 }, userEvent: 'delete.backward' });
  return true;
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
    const { tree, quotes } = structureContext(source.text);
    const literal = isLiteralRange(source.text, from);
    const item = listItemAt(tree, from);
    const mark = item?.getChild('ListMark');
    // A quote between the caret and a list item owns this newline; the outer
    // item contributes continuation indentation, not another sibling marker.
    let insideQuote = false;
    for (let node = tree.resolveInner(from, -1); node && node !== item; node = node.parent!) {
      if (node.name === 'Blockquote') insideQuote = true;
      if (node.name === 'ListItem') break;
    }
    const continuation = (end: number) => {
      let value = source.text.slice(line.from, end);
      const marks: Range[] = [];
      tree.iterate({ from: line.from, to: end, enter(node) {
        if (node.name === 'ListMark' && node.from >= line.from && node.to <= end) marks.push({ from: node.from, to: node.to });
      } });
      for (const m of marks.reverse()) value = value.slice(0, m.from - line.from) + ' '.repeat(m.to - m.from) + value.slice(m.to - line.from);
      return value;
    };
    let quoteEnd = line.from;
    let quoteDepth = quotes.filter(q => from >= q.from && from <= q.to).length;
    tree.iterate({ from: line.from, to: from, enter(node) {
      if (node.name === 'QuoteMark' && node.from >= line.from && node.to <= from && quoteDepth-- > 0) {
        quoteEnd = Math.max(quoteEnd, node.to + (/^[\t ]/.test(source.text.slice(node.to)) ? 1 : 0));
      }
    } });
    // Never copy a container prefix that is still in the untouched suffix.
    const quote = quoteEnd <= from ? continuation(quoteEnd) : '';
    const prefix = mark && mark.from >= line.from && !insideQuote
      ? /^((?:[-+*]|\d+[.)])[\t ]+)(\[[ xX]\]([\t ]+))?/.exec(source.text.slice(mark.from, line.to)) : null;
    if (!literal && prefix && mark && from >= mark.from + prefix[0].length) {
      const outer = continuation(mark.from);
      if (from === to && source.text.slice(mark.from + prefix[0].length, line.to).trim() === '') {
        const at = /^[\t ]*$/.test(source.text.slice(quoteEnd, mark.from)) ? quoteEnd : mark.from;
        target.edit([patch(source, at, line.to, '')], { selection: { anchor: at, head: at } }); return;
      }
      let marker = prefix[1];
      marker = marker.replace(/^\d+/, n => String(Number(n) + 1));
      const insert = '\n' + outer + marker + (prefix[2] ? '[ ]' + prefix[3] : '');
      const end = from + insert.length;
      target.edit([patch(source, from, to, insert)], { selection: { anchor: end, head: end }, userEvent: 'input' }); return;
    }
    const paragraph = target.getMode?.() === 'live' && line.text.trim() !== '' && !literal
      && isOrdinaryParagraphRange(source.text, from);
    const indent = /^[\t ]*/.exec(line.text.slice(quote.length))?.[0] ?? '';
    // Four-column indentation may be ordinary prose continuation before the
    // break, but would start a code block in the newly separated paragraph.
    const nextIndent = paragraph && (columns(indent) >= 4 || from < line.from + indent.length) ? '' : indent;
    const insert = (paragraph ? '\n\n' : '\n') + quote + nextIndent;
    target.edit([patch(source, from, to, insert)], { selection: { anchor: from + insert.length, head: from + insert.length } }); return;
  }
  const last = target.state.doc.lineAt(to > from ? to - 1 : to);
  const patches: Patch[] = [];
  if (kind === 'indent' || kind === 'outdent') {
    const beforeContext = structureContext(source.text), { tree } = beforeContext;
    const affected = new Map<number, { delta: number; quote: string; raw: boolean }>();
    const literalStarts = new Map<number, number>(), fenceColumns = new Map<number, number>();
    const listMarks = new Map<number, { from: number; to: number }>();
    tree.iterate({ enter(node) {
      const n = target.state.doc.lineAt(node.from).number;
      if (node.name === 'ListMark') listMarks.set(n, { from: node.from, to: node.to });
      if (node.name === 'CodeText' && node.node.parent?.name === 'CodeBlock') literalStarts.set(n, node.from);
      if (node.name === 'FencedCode') {
        const column = columns(source.text.slice(target.state.doc.line(n).from, node.from));
        const end = target.state.doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let child = n + 1; child <= end; child++) fenceColumns.set(child, column);
      }
    } });
    for (let n = line.number; n <= last.number; n++) {
      if (affected.has(n)) continue;
      const selected = target.state.doc.line(n);
      const quote = quotePrefix(selected.text);
      const item = isLiteralRange(source.text, selected.from + quote.length) ? null : listItemAt(tree,
        selected.from + quote.length + (/^[\t ]*/.exec(selected.text.slice(quote.length))![0].length) + (selected.text.trim() ? 1 : 0));
      const first = item ? target.state.doc.lineAt(item.from).number : n;
      const end = item ? target.state.doc.lineAt(Math.max(item.from, item.to - 1)).number : n;
      const root = target.state.doc.line(first);
      const rootQuote = quotePrefix(root.text), mark = item?.getChild('ListMark');
      const indent = /^[\t ]*/.exec(root.text.slice(rootQuote.length))![0];
      const current = columns(root.text.slice(0, mark ? mark.from - root.from : rootQuote.length + indent.length));
      const remove = /^(?: {1,2}|\t)/.exec(indent)?.[0] ?? '';
      let delta = kind === 'indent' ? 2 : columns(rootQuote) - columns(rootQuote + remove);
      if (mark && kind === 'indent') {
        let previous = item!.prevSibling;
        while (previous && previous.name !== 'ListItem') previous = previous.prevSibling;
        const previousMark = previous?.getChild('ListMark');
        if (previousMark) {
          const previousLine = target.state.doc.lineAt(previousMark.from);
          const gap = /^[\t ]*/.exec(source.text.slice(previousMark.to, previousLine.to))![0];
          const markColumn = columns(source.text.slice(previousLine.from, previousMark.to));
          const contentColumn = columns(source.text.slice(previousLine.from, previousMark.to) + gap);
          const previousShift = affected.get(previousLine.number)?.delta;
          delta = previousShift ?? (contentColumn - markColumn > 4 ? markColumn + 1 : contentColumn) - current;
          // An ordered list starting above 1 cannot interrupt the parent's
          // paragraph in the renderer, even though Lezer accepts it. Preserve
          // the marker and add only the local separator needed for nesting.
          const ordinal = /^\d+/.exec(source.text.slice(mark.from, mark.to));
          const priorLine = first > 1 ? target.state.doc.line(first - 1).text : '';
          if (previousShift === undefined && delta > 0 && ordinal && Number(ordinal[0]) !== 1 &&
              ['Paragraph', 'Task'].includes(previous!.lastChild?.name ?? '') &&
              priorLine.slice(quotePrefix(priorLine).length).trim()) {
            patches.push(patch(source, root.from, root.from, rootQuote + '\n'));
          }
        }
      } else if (mark) {
        let parent = item!.parent?.parent;
        while (parent && parent.name !== 'ListItem') parent = parent.parent;
        const parentMark = parent?.getChild('ListMark');
        if (parentMark) delta = columns(source.text.slice(target.state.doc.lineAt(parentMark.from).from, parentMark.from)) - current;
      }
      for (let child = first; child <= end; child++) if (!affected.has(child)) affected.set(child, { delta, quote: rootQuote, raw: !item });
    }
    for (const [n, { delta, quote, raw }] of [...affected].sort(([a], [b]) => a - b)) {
      const l = target.state.doc.line(n);
      if (raw) {
        const remove = /^(?: {1,2}|\t)/.exec(l.text)?.[0] ?? '';
        if (kind === 'indent') patches.push(patch(source, l.from, l.from, '  '));
        else if (remove) patches.push(patch(source, l.from, l.from + remove.length, ''));
        continue;
      }
      // Insert after the owning quote's prefix, before any descendant container.
      const at = quote ? quotePrefix(l.text).slice(0, quote.length).length : 0;
      let indent = /^[\t ]*/.exec(l.text.slice(at))![0];
      const literal = literalStarts.get(n), fence = fenceColumns.get(n);
      if (literal !== undefined) indent = indent.slice(0, Math.max(0, literal - l.from - at));
      if (fence !== undefined) {
        let end = 0;
        while (end < indent.length && columns(l.text.slice(0, at) + indent.slice(0, end)) < fence) end++;
        indent = indent.slice(0, end);
      }
      const base = columns(l.text.slice(0, at)), width = columns(l.text.slice(0, at) + indent) - base;
      if (delta > 0) patches.push(patch(source, l.from + at, l.from + at + indent.length, ' '.repeat(width + delta)));
      else if (delta < 0 && width) patches.push(patch(source, l.from + at, l.from + at + indent.length, ' '.repeat(Math.max(0, width + delta))));
      if (delta) for (const prefix of beforeContext.codePrefixes) {
        if (prefix.from >= l.from + at + indent.length && prefix.from <= l.to) {
          patches.push(patch(source, prefix.from, prefix.to, prefix.insert));
        }
      }
      const mark = listMarks.get(n);
      if (mark && delta) {
        const gap = /^[\t ]*/.exec(source.text.slice(mark.to, l.to))![0];
        const before = source.text.slice(l.from, mark.to), oldColumn = columns(before);
        const oldWidth = columns(before + gap) - oldColumn;
        const nextColumn = oldColumn + delta;
        const nextWidth = columns(' '.repeat(Math.max(0, nextColumn)) + gap) - nextColumn;
        if (oldWidth !== nextWidth) {
          let replacement = ' '.repeat(oldWidth);
          if (oldWidth > 4) {
            // The first five columns are list separator + code indentation;
            // everything beyond them is literal code, including partial tabs.
            let end = 0, column = oldColumn;
            while (end < gap.length && column < oldColumn + 5) {
              column += gap[end++] === '\t' ? 4 - column % 4 : 1;
            }
            replacement = '     ' + ' '.repeat(Math.max(0, column - oldColumn - 5)) + gap.slice(end);
          }
          patches.push(patch(source, mark.to, mark.to + gap.length, replacement));
        }
      }
    }
    patches.sort((a, b) => a.from - b.from || a.to - b.to);
    const fences = beforeContext.fences.filter(fence => {
      const move = affected.get(target.state.doc.lineAt(fence.opening.from).number);
      return move && !move.raw && move.delta !== 0;
    });
    if (patches.length && [...affected.values()].some(move => !move.raw)) {
      // Extraction-equivalent whitespace need not preserve fence classification:
      // a body line can become a real closer after its container columns move.
      // Parse the proposed local edit before committing any history operation.
      const plan = ChangeSet.of(patches, source.text.length);
      let proposed = structureContext(plan.apply(target.state.doc).toString());
      const prefixPatchCount = patches.length;
      const byOpening = new Map(proposed.fences.map(fence => [fence.opening.from, fence]));
      for (const fence of fences) {
        const next = byOpening.get(plan.mapPos(fence.opening.from, 1));
        if (!next?.closing || next.closing.from < plan.mapPos(fence.bodyRange.from, 1) ||
            next.closing.from >= plan.mapPos(fence.bodyRange.to, -1)) continue;
        const marker = source.text[fence.opening.from];
        let length = fence.opening.to - fence.opening.from;
        // Grow past every matching body run, not just the first premature
        // closer: otherwise the repair could expose another one further down.
        for (const match of fence.content.matchAll(/^[\t ]*(`{3,}|~{3,})[\t ]*$/gm)) {
          if (match[1][0] === marker) length = Math.max(length, match[1].length + 1);
        }
        if (length > fence.opening.to - fence.opening.from) {
          patches.push(patch(source, fence.opening.from, fence.opening.to, marker.repeat(length)));
          if (fence.closing && length > fence.closing.to - fence.closing.from) {
            patches.push(patch(source, fence.closing.from, fence.closing.to, marker.repeat(length)));
          }
        }
      }
      if (patches.length !== prefixPatchCount) {
        patches.sort((a, b) => a.from - b.from || a.to - b.to);
        proposed = structureContext(ChangeSet.of(patches, source.text.length).apply(target.state.doc).toString());
      }
      // A structural move is unsupported if even the repaired final plan
      // changes any literal code or creates/removes/reclassifies a code block.
      // Returning before edit preserves Source, selection, revision and history
      // atomically. Pure raw indentation intentionally edits code and bypasses
      // this gate; mixed raw/structural selections must satisfy it as a whole.
      const before = beforeContext.codeSignatures, after = proposed.codeSignatures;
      if (before.length !== after.length || before.some((block, i) =>
        block.kind !== after[i].kind || block.content !== after[i].content || block.info !== after[i].info)) return;
    }
    target.edit(patches.sort((a, b) => a.from - b.from || a.to - b.to)); return;
  }
  if (kind === 'list' || kind === 'bulletList' || kind === 'unorderedList' || kind === 'orderedList' || kind === 'taskList') {
    const requested = options.marker ?? '-';
    if (kind !== 'orderedList' && !/^[-+*]$|^\d+[.)]$/.test(requested)) throw new Error('Invalid list marker');
    const tree = structureContext(source.text).tree;
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
      const selectedLine = target.state.doc.line(n);
      if (target.getMode?.() === 'live' && isLiteralBlockRange(source.text, selectedLine.from, selectedLine.to)) continue;
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
  const headings = new Map<number, ReturnType<typeof structureContext>['tree']['topNode']>();
  if (kind === 'heading') structureContext(source.text).tree.iterate({ enter(node) {
    if (node.name.startsWith('SetextHeading')) {
      for (let n = target.state.doc.lineAt(node.from).number; n <= target.state.doc.lineAt(node.to).number; n++) headings.set(n, node.node);
    }
  } });
  const handled = new Set<number>();
  for (let n = line.number; n <= last.number; n++) {
    const l = target.state.doc.line(n);
    if (target.getMode?.() === 'live' && (isLiteralBlockRange(source.text, l.from, l.to) || from !== to && !l.text.trim())) continue;
    if (kind === 'heading') {
      const level = options.level ?? 1;
      if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error('Heading level must be 1–6');
      const heading = headings.get(n);
      if (heading) {
        if (handled.has(heading.from)) continue;
        handled.add(heading.from);
        const mark = heading.getChild('HeaderMark')!;
        if (level <= 2) {
          const before = source.text.slice(mark.from, mark.to), after = before.replace(/[=-]/g, level === 1 ? '=' : '-');
          if (before !== after) patches.push(patch(source, mark.from, mark.to, after));
        } else {
          const parsed = structureContext(source.text).headings.find(h => h.from <= heading.from && h.to >= heading.to);
          if (!parsed) continue;
          // Setext trailing hashes are literal; in ATX the final run would
          // become a closing delimiter. Escape its first hash to keep the text.
          const body = parsed.content.split('\n').map(part => part.trim()).join(' ')
            .replace(/([\t ]+)(#+)$/, '$1\\$2');
          patches.push(patch(source, heading.from, heading.to, '#'.repeat(level) + ' ' + body));
        }
        continue;
      }
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
