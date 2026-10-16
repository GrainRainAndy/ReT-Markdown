import katex from 'katex';
import type { MarkdownIt, Token } from 'markdown-it';
import { inlineRange, type RenderEnv } from './positions';

interface MathMeta extends Record<string, unknown> { from: number; to: number; closed: boolean }

function renderMath(token: Token, env: RenderEnv, escape: (value: string) => string): string {
  const meta = token.meta as MathMeta;
  try {
    if (!meta.closed) throw new Error('Unclosed math delimiter');
    return katex.renderToString(token.content, {
      displayMode: token.type === 'math_block',
      output: env.clipboard ? 'mathml' : 'htmlAndMathml',
      trust: false,
      strict: 'ignore',
      throwOnError: true,
      maxExpand: 1000,
      maxSize: 50,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid mathematical expression';
    env.issues.push({ kind: 'math', message, from: meta.from, to: meta.to });
    const tag = token.type === 'math_block' ? 'div' : 'span';
    return `<${tag} class="math-error" title="${escape(message)}" data-from="${meta.from}" data-to="${meta.to}">${escape(env.original.slice(meta.from, meta.to))}</${tag}>`;
  }
}

export function installMath(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos;
    const env = state.env as RenderEnv;
    if (state.src !== env.inlineSource || state.src[start] !== '$') return false;
    // Dollar followed by whitespace is ordinary text (e.g. currency); escaped dollars
    // are consumed by markdown-it's escape rule before this position is reached.
    const delimiter = state.src.startsWith('$$', start) ? '$$' : '$';
    if (delimiter === '$' && /\s/.test(state.src[start + 1] ?? ' ')) return false;
    const lineEnd = state.src.indexOf('\n', start);
    const max = lineEnd < 0 ? state.posMax : Math.min(lineEnd, state.posMax);
    let close = start + delimiter.length;
    while (close < max) {
      close = state.src.indexOf(delimiter, close);
      if (close < 0 || close >= max) { close = -1; break; }
      let slashes = 0;
      for (let j = close - 1; state.src[j] === '\\'; j--) slashes++;
      if (slashes % 2 === 0) break;
      close += delimiter.length;
    }
    const closed = close >= start + delimiter.length && close < max;
    const end = closed ? close + delimiter.length : max;
    if (!silent) {
      const token = state.push(delimiter === '$$' ? 'math_block' : 'math_inline', '', 0);
      token.content = state.src.slice(start + delimiter.length, closed ? close : max);
      token.meta = { ...inlineRange(env, start, end), closed } satisfies MathMeta;
    }
    state.pos = end;
    return true;
  });

  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4 || !state.src.startsWith('$$', start)) return false;
    if (silent) return true;
    const env = state.env as RenderEnv;
    let line = startLine;
    let close = state.src.indexOf('$$', start + 2);
    let closed = close >= 0 && close <= state.eMarks[startLine] - 2;
    let content = '';
    if (closed) {
      if (state.src.slice(close + 2, state.eMarks[line]).trim()) return false;
      content = state.src.slice(start + 2, close);
    } else {
      content = state.src.slice(start + 2, state.eMarks[startLine]);
      for (line = startLine + 1; line < endLine; line++) {
        const lineStart = state.bMarks[line] + state.tShift[line];
        // Lists can pass an endLine beyond the item. Leave nonempty outdented
        // lines (including apparent closing delimiters) to the enclosing parser.
        if (lineStart < state.eMarks[line] && state.sCount[line] < state.blkIndent) break;
        const text = state.src.slice(lineStart, state.eMarks[line]);
        if (text.trimEnd().endsWith('$$')) {
          close = state.eMarks[line] - text.length + text.trimEnd().length - 2;
          content += '\n' + state.src.slice(lineStart, close);
          closed = true;
          break;
        }
        content += '\n' + text;
      }
      if (!closed) line = Math.max(startLine, line - 1);
    }
    const end = closed ? close + 2 : state.eMarks[line];
    const token = state.push('math_block', '', 0);
    token.block = true;
    token.map = [startLine, line + 1];
    token.content = content.trim();
    token.meta = { from: env.offsets[start], to: env.offsets[end], closed } satisfies MathMeta;
    state.line = line + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  for (const type of ['math_inline', 'math_block']) {
    md.renderer.rules[type] = (tokens, index, _options, env) => renderMath(tokens[index], env as RenderEnv, md.utils.escapeHtml);
  }
}
