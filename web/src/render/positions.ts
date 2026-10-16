import type { MarkdownIt, Env, Token } from 'markdown-it';
import type { RenderIssue, RenderOptions } from './markdown';

export interface RenderEnv extends Env {
  original: string;
  normalized: string;
  offsets: number[];
  issues: RenderIssue[];
  options: RenderOptions;
  inlineSource: string;
  inlineOffsets: number[];
  clipboard: boolean;
}

export function createEnv(source: string, options: RenderOptions, clipboard = false): RenderEnv {
  const offsets: number[] = [];
  let normalized = '';
  for (let i = 0; i < source.length; i++) {
    offsets.push(i);
    const ch = source[i];
    normalized += ch === '\r' ? '\n' : ch === '\0' ? '\ufffd' : ch;
    if (ch === '\r' && source[i + 1] === '\n') i++;
  }
  offsets.push(source.length);
  return { original: source, normalized, offsets, issues: [], options, inlineSource: '', inlineOffsets: [], clipboard };
}

export function inlineRange(env: RenderEnv, from: number, to: number): { from: number; to: number } {
  const start = env.inlineOffsets[from];
  const end = to > from ? env.inlineOffsets[to - 1] + 1 : start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > env.original.length) {
    throw new Error('Invalid inline source mapping');
  }
  return { from: start, to: end };
}

/** Split exactly as markdown-it's table rule does, keeping a source index per UTF-16 unit.
 * A pipe immediately preceded by a backslash loses that one backslash, even in a run
 * of backslashes. Only unescaped pipes are cell boundaries; backticks do not hide them.
 */
function tableCells(source: string, from: number, to: number): { content: string; offsets: number[] }[] {
  const raw = source.slice(from, to);
  from += raw.length - raw.trimStart().length;
  to = from + raw.trim().length;
  const cells: { content: string; offsets: number[] }[] = [];
  let content = '';
  let offsets: number[] = [];
  for (let i = from; i < to; i++) {
    if (source[i] === '|' && source[i - 1] !== '\\') {
      cells.push({ content, offsets: [...offsets, i] });
      content = '';
      offsets = [];
    } else {
      if (source[i] === '|') {
        content = content.slice(0, -1);
        offsets.pop();
      }
      content += source[i];
      offsets.push(i);
    }
  }
  cells.push({ content, offsets: [...offsets, to] });
  if (cells[0]?.content === '') cells.shift();
  if (cells[cells.length - 1]?.content === '') cells.pop();
  return cells.map(cell => {
    const start = cell.content.length - cell.content.trimStart().length;
    const content = cell.content.trim();
    return { content, offsets: cell.offsets.slice(start, start + content.length + 1) };
  });
}

/** Map parser-local characters back through CRLF normalization and stripped block prefixes. */
export function installPositions(md: MarkdownIt): void {
  const cellOffsets = new WeakMap<Token, number[]>();
  const tableRule = md.block.ruler.getRules('').find(rule => rule.name === 'table')!;
  md.block.ruler.at('table', (state, startLine, endLine, silent) => {
    const firstToken = state.tokens.length;
    const matched = tableRule(state, startLine, endLine, silent);
    if (!matched || silent) return matched;
    let cells: ReturnType<typeof tableCells> = [];
    let column = 0;
    let rowEnd = 0;
    for (let i = firstToken; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === 'tr_open') {
        const line = token.map![0];
        rowEnd = state.eMarks[line];
        // Capture while the enclosing block's bMarks/tShift still strip its prefixes.
        cells = tableCells(state.src, state.bMarks[line] + state.tShift[line], rowEnd);
        column = 0;
      } else if (token.type === 'inline') {
        // markdown-it pads short rows with empty cells and ignores excess columns.
        const cell = cells[column++] ?? { content: '', offsets: [rowEnd] };
        if (cell.content !== token.content) throw new Error('Table cell source mapping mismatch');
        cellOffsets.set(token, cell.offsets);
      }
    }
    return true;
  }, { alt: ['paragraph', 'reference'] });

  md.core.ruler.at('inline', state => {
    const env = state.env as RenderEnv;
    const starts = [0];
    for (let i = 0; i < state.src.length; i++) if (state.src[i] === '\n') starts.push(i + 1);
    starts.push(state.src.length);
    let cursor = 0;
    let limit = state.src.length;
    for (const token of state.tokens) {
      if (token.map) {
        cursor = Math.max(cursor, starts[token.map[0]]);
        limit = starts[token.map[1]] ?? state.src.length;
      }
      if (token.type !== 'inline') continue;
      const cell = cellOffsets.get(token);
      if (cell) {
        env.inlineSource = token.content;
        env.inlineOffsets = cell.map(offset => env.offsets[offset]);
        md.inline.parse(token.content, md, env, token.children!);
        continue;
      }
      const locations: number[] = [];
      const lines = token.content.split('\n');
      for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        const exact = state.src.indexOf(line, cursor);
        if (exact >= cursor && exact + line.length <= limit) {
          for (let j = 0; j < line.length; j++) locations.push(env.offsets[exact + j]);
          cursor = exact + line.length;
        } else {
          // Keep any alignment through stripped block prefixes inside the block span.
          for (const ch of line.split('')) {
            while (cursor < limit && state.src[cursor] !== ch) cursor++;
            if (cursor >= limit) throw new Error('Inline content exceeds its source span');
            locations.push(env.offsets[cursor]);
            cursor++;
          }
        }
        if (n < lines.length - 1) {
          const newline = state.src.indexOf('\n', cursor);
          if (newline < cursor || newline >= limit) throw new Error('Inline newline exceeds its source span');
          locations.push(env.offsets[newline]);
          cursor = newline + 1;
        }
      }
      locations.push(env.offsets[cursor]);
      env.inlineSource = token.content;
      env.inlineOffsets = locations;
      md.inline.parse(token.content, md, env, token.children!);
    }
  });
}
