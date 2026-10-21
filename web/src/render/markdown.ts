import MarkdownIt, { type Token } from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js';
import { installMath } from './math';
import { validateMarkdownLink } from './link-policy';
import { createEnv, inlineRange, installPositions, type RenderEnv } from './positions';
import typography from '../../styles/typography.css?raw';
import palette from '../../styles/palette.css?raw';

export interface RenderOptions {
  resolveImage?: (destination: string) => string | null;
}
export interface RenderIssue {
  kind: 'math' | 'image';
  message: string;
  from: number;
  to: number;
}
export interface RenderResult {
  html: string;
  issues: RenderIssue[];
}

const md = new MarkdownIt({
  // Tokenize HTML atomically, then escape it below. This keeps Markdown/math inside
  // unsupported HTML from becoming active rendering or spurious export errors.
  html: true,
  linkify: false,
  typographer: false,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return '';
  },
}).use(taskLists, { enabled: false, label: false });

// Links never load resources; the native host intercepts navigation and opens external
// links in the system browser. Unknown/custom schemes in document source stay inert.
md.validateLink = validateMarkdownLink;
md.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  // Local file destinations are parsed for images/reference definitions, never active
  // document navigation. Only the supplied resolver can make them image resources.
  if (/^file:/i.test(String(token.attrGet('href') ?? ''))) token.attrs = token.attrs?.filter(([name]) => name !== 'href') ?? null;
  return renderer.renderToken(tokens, index, options);
};

installPositions(md);
installMath(md);

// A conservative bound keeps small snippets together while letting large or heavily
// wrapped blocks fragment. These classes are layout hints and never alter code text.
for (const type of ['fence', 'code_block']) {
  const defaultRule = md.renderer.rules[type]!;
  md.renderer.rules[type] = (tokens, index, options, env, renderer) => {
    const content = tokens[index].content;
    const lines = content.trimEnd().split('\n');
    const short = lines.length <= 30 && lines.every(line => line.length <= 120) && content.length <= 2400;
    return defaultRule(tokens, index, options, env, renderer).replace('<pre>', `<pre class="${short ? 'short-code' : 'long-code'}">`);
  };
}

md.core.ruler.after('github-task-lists', 'mark-task-checkboxes', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token.type === 'inline' && state.tokens[i - 2].attrGet('class') === 'task-list-item') {
      const checkbox = token.children?.[0];
      if (checkbox?.type === 'html_inline') checkbox.meta = { taskCheckbox: true };
    }
  }
});
md.renderer.rules.html_inline = (tokens, index) => tokens[index].meta?.taskCheckbox
  ? tokens[index].content : md.utils.escapeHtml(tokens[index].content);
md.renderer.rules.html_block = (tokens, index) => `<pre class="raw-html"><code>${md.utils.escapeHtml(tokens[index].content)}</code></pre>\n`;

const imageRule = md.inline.ruler.getRules('').find(rule => rule.name === 'image')!;
md.inline.ruler.at('image', (state, silent) => {
  const start = state.pos;
  const matched = imageRule(state, silent);
  if (matched && !silent && state.src === (state.env as RenderEnv).inlineSource) {
    const token = state.tokens[state.tokens.length - 1];
    token.meta = { ...token.meta, ...inlineRange(state.env as RenderEnv, start, state.pos) };
  }
  return matched;
});

function decodedPath(destination: string): string {
  try { return decodeURIComponent(destination); } catch { return destination; }
}

function localURL(value: string): boolean {
  // Absolute, explicitly resolved local URLs only; never let a relative result inherit
  // an HTTP base URL. Raster data URLs cannot carry active SVG/HTML content.
  return !/[\u0000-\u0020\u007f\\]/.test(value) && (
    /^ret-resource:\/\//i.test(value) || /^file:\/\/(?:\/|localhost\/)/i.test(value)
    || /^blob:(?:null\/|file:\/\/|ret-resource:\/\/)/i.test(value)
    || /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(value)
  );
}

md.renderer.rules.image = (tokens, index, _options, rawEnv, renderer) => {
  const env = rawEnv as RenderEnv;
  const token = tokens[index];
  const reference = String(token.attrGet('src') ?? '');
  const alt = renderer.renderInlineAsText(token.children ?? [], md.options, env);
  const escape = md.utils.escapeHtml;
  if (/^(?:https?:)?\/\//i.test(reference)) {
    return `<span class="image-placeholder remote-image" role="img" aria-label="${escape(alt)}">Remote image: ${escape(reference)}</span>`;
  }
  const destination = decodedPath(reference);
  let resolved: string | null = null;
  let message = `Missing local image: ${destination}`;
  try { resolved = env.options.resolveImage?.(destination) ?? null; }
  catch (error) { message = `Cannot resolve image ${destination}: ${error instanceof Error ? error.message : String(error)}`; }
  if (resolved && localURL(resolved)) {
    return `<img src="${escape(resolved)}" alt="${escape(alt)}"${token.attrGet('title') ? ` title="${escape(String(token.attrGet('title')))}"` : ''}>`;
  }
  const { from, to } = token.meta as { from: number; to: number };
  env.issues.push({ kind: 'image', message, from, to });
  return `<span class="image-placeholder missing-image" role="img" title="${escape(message)}" data-from="${from}" data-to="${to}">${escape(alt)} — ${escape(destination)}</span>`;
};

function render(source: string, options: RenderOptions, clipboard = false): RenderResult {
  const env = createEnv(source, options, clipboard);
  const html = md.render(source, env);
  env.issues.sort((a, b) => a.from - b.from || a.to - b.to);
  return { html, issues: env.issues };
}

export function renderMarkdown(source: string, options: RenderOptions = {}): RenderResult {
  return render(source, options);
}

/** Editing uses the renderer's block grammar, including opaque/unclosed math.
 * Only ordinary top-level prose receives live paragraph breaks. Containers,
 * HTML, headings, tables and code retain their existing Enter semantics.
 */
export function isOrdinaryParagraphRange(source: string, from: number, to: number): boolean {
  const env = createEnv(source, {}), tokens = md.parse(source, env), starts = [0];
  for (let i = 0; i < env.normalized.length; i++) if (env.normalized[i] === '\n') starts.push(i + 1);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'paragraph_open' || token.level !== 0 || !token.map) continue;
    const start = env.offsets[starts[token.map[0]]];
    let end = starts[token.map[1]] ?? env.normalized.length;
    if (env.normalized[end - 1] === '\n') end--;
    if (from < start || to > env.offsets[end]) continue;
    return !(tokens[i + 1]?.children ?? []).some(child => {
      if (!/^math_(inline|block)$/.test(child.type)) return false;
      const meta = child.meta as { from: number; to: number; closed: boolean };
      return from === to ? from > meta.from && (from < meta.to || !meta.closed && from === meta.to)
        : from < meta.to && to > meta.from;
    });
  }
  return false;
}

/** Inline projections share document references, safe renderer rules and original offsets. */
export interface InlineContextResult extends RenderResult { href: string | null }
export function renderInlineContexts(
  source: string,
  ranges: readonly { from: number; to: number }[],
  options: RenderOptions = {},
): InlineContextResult[] {
  const context = createEnv(source, options);
  const document = md.parse(source, context);
  const contextualTokens = new Map(document.flatMap(token => [token, ...(token.children ?? [])])
    .filter(token => ['image', 'math_inline', 'math_block'].includes(token.type))
    .map(token => [`${token.meta?.from}:${token.meta?.to}`, token]));
  return ranges.map(range => {
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to < range.from || range.to > source.length) throw new Error('Invalid inline source range');
    const env: RenderEnv = { ...context, issues: [] };
    // Reuse document tokens: block math has already stripped container prefixes,
    // and images retain reference context. Original UTF-16 metadata stays intact.
    const contextual = contextualTokens.get(`${range.from}:${range.to}`);
    const tokens: Token[] = [];
    if (contextual) tokens.push(contextual);
    else {
      const fragment = createEnv(source.slice(range.from, range.to), options);
      env.inlineSource = fragment.normalized;
      env.inlineOffsets = fragment.offsets.map(offset => range.from + offset);
      md.inline.parse(fragment.normalized, md, env, tokens);
    }
    const html = md.renderer.renderInline(tokens, md.options, env);
    // Read after rendering: the existing file-link rule removes inactive hrefs.
    const target = tokens[0]?.type === 'link_open' ? tokens[0].attrGet('href') : null;
    const href = target === null ? null : String(target);
    return { html, href, issues: [...env.issues].sort((a, b) => a.from - b.from || a.to - b.to) };
  });
}

/** Top-level rendered block ranges in original UTF-16 coordinates.
 * Inline/closing tokens and reference definitions do not create root DOM blocks.
 * Use the same configured grammar as rendering, including HTML and math scope.
 */
export function blockSourceRanges(source: string): { from: number; to: number }[] {
  const env = createEnv(source, {});
  const tokens = md.parse(source, env);
  const starts = [0];
  for (let i = 0; i < env.normalized.length; i++) if (env.normalized[i] === '\n') starts.push(i + 1);
  return tokens.filter(token => token.level === 0 && token.map && token.type !== 'inline' && token.nesting !== -1)
    .map(token => ({
      from: env.offsets[starts[token.map![0]]],
      to: env.offsets[starts[token.map![1]] ?? env.normalized.length],
    }));
}

/** Render one document table's cells in their original inline/reference context.
 * tableFrom is an original UTF-16 offset on the table's opening line. Rows include
 * the header, omit the separator, and contain no block wrappers. Issue offsets
 * retain the original document coordinates. No resources are loaded by this helper.
 */
export function renderTableCells(source: string, tableFrom: number, options: RenderOptions = {}): RenderResult[][] {
  if (!Number.isSafeInteger(tableFrom) || tableFrom < 0 || tableFrom >= source.length) throw new Error('Invalid table offset');
  const line = source.slice(0, tableFrom).split(/\r\n|\r|\n/).length - 1;
  const env = createEnv(source, options);
  const tokens = md.parse(source, env);
  const start = tokens.findIndex(token => token.type === 'table_open' && token.map?.[0] === line);
  if (start < 0) throw new Error('No table at source offset');
  const rows: RenderResult[][] = [];
  for (let i = start + 1; i < tokens.length && tokens[i].type !== 'table_close'; i++) {
    const token = tokens[i];
    if (token.type === 'tr_open') rows.push([]);
    else if (token.type === 'inline') {
      env.issues = [];
      const html = md.renderer.renderInline(token.children ?? [], md.options, env);
      rows[rows.length - 1].push({ html, issues: [...env.issues].sort((a, b) => a.from - b.from || a.to - b.to) });
    }
  }
  return rows;
}

function mathText(token: Token, env: RenderEnv): string {
  return token.meta?.closed === false ? env.original.slice(Number(token.meta.from), Number(token.meta.to)) : token.content;
}

function inlineText(tokens: Token[], env: RenderEnv): string {
  return tokens.map(token => {
    if (token.type === 'image') return inlineText(token.children ?? [], env);
    if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n';
    if (token.type === 'html_inline') return token.meta?.taskCheckbox ? (token.content.includes('checked') ? '[x]' : '[ ]') : token.content;
    if (token.type === 'math_inline' || token.type === 'math_block') return mathText(token, env);
    if (['text', 'code_inline'].includes(token.type)) return token.content;
    return '';
  }).join('');
}

export function plainText(source: string): string {
  const env = createEnv(source, {});
  const tokens = md.parse(source, env);
  let text = '';
  const lists: { ordered: boolean; next: number }[] = [];
  for (const token of tokens) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      lists.push({ ordered: token.type === 'ordered_list_open', next: Number(token.attrGet('start') ?? 1) });
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      lists.pop();
      if (!lists.length) text += '\n';
    } else if (token.type === 'list_item_open') {
      const list = lists[lists.length - 1];
      text += '  '.repeat(Math.max(0, lists.length - 1)) + (list.ordered ? `${list.next++}. ` : '- ');
    } else if (token.type === 'inline') text += inlineText(token.children ?? [], env);
    else if (['paragraph_close', 'heading_close'].includes(token.type)) text += lists.length ? '\n' : '\n\n';
    else if (['fence', 'code_block', 'math_block', 'html_block'].includes(token.type)) text += (token.type === 'math_block' ? mathText(token, env) : token.content).replace(/\n$/, '') + '\n\n';
    else if (['th_close', 'td_close'].includes(token.type)) text += '\t';
    else if (token.type === 'tr_close') text = text.replace(/\t$/, '') + '\n';
    else if (token.type === 'table_close') text += '\n';
    else if (token.type === 'hr') text += '---\n\n';
  }
  return text.trimEnd();
}

export function richClipboard(source: string, options: RenderOptions = {}): { html: string; text: string } {
  const html = render(source, options, true).html;
  // MathML keeps clipboard formulas self-contained without depending on bundled KaTeX
  // font URLs. Target applications may ignore MathML; the text fallback retains TeX.
  return {
    html: `<style>${typography}\n${palette}</style><div class="markdown-body" data-color-scheme="light" style="font-family:Open Sans,Helvetica Neue,Arial,sans-serif;font-size:16px;line-height:1.6;color:#333333;background:#ffffff">${html}</div>`,
    text: plainText(source),
  };
}

