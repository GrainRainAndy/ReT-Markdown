import { parser, GFM } from '@lezer/markdown';
import MarkdownIt from 'markdown-it';
import { installMath } from '../render/math';
import { createEnv, installPositions, type RenderEnv } from '../render/positions';
import type { Range } from '../protocol';

const grammar = parser.configure(GFM);
const renderedGrammar = new MarkdownIt({ html: true });
installPositions(renderedGrammar);
installMath(renderedGrammar);

interface CodePrefix extends Range { insert: string }
export interface RendererFence extends Range {
  opening: Range;
  closing: Range | null;
  bodyRange: Range;
  ownsEOF: boolean;
  content: string;
}
type StructureEnv = RenderEnv & { codePrefixes: CodePrefix[]; fences: RendererFence[] };

/** Keep the shared tree in original source coordinates, but let the renderer
 * decide which lines belong to each fence. No shadow source or tail reparsing. */
function structureTree(text: string, fences: readonly RendererFence[]) {
  const openings = new Map(fences.map(fence => [fence.opening.from, fence]));
  return grammar.configure({ remove: ['FencedCode'], parseBlock: [{
    name: 'RendererFence', before: 'IndentedCode',
    endLeaf: (cx, line) => openings.has(cx.lineStart + line.pos),
    parse(cx, line) {
      const fence = openings.get(cx.lineStart + line.pos);
      if (!fence) return false;
      const marks = [cx.elt('CodeMark', fence.opening.from, fence.opening.to)];
      const infoFrom = line.skipSpace(fence.opening.to - cx.lineStart);
      const infoTo = line.text.replace(/[\t \r]+$/, '').length;
      if (infoTo > infoFrom) marks.push(cx.elt('CodeInfo', cx.lineStart + infoFrom, cx.lineStart + infoTo));
      const codeText = (from: number, to: number) => {
        const previous = marks.at(-1)!;
        if (previous.to === from && cx.parser.nodeSet.types[previous.type].name === 'CodeText') {
          marks[marks.length - 1] = cx.elt('CodeText', previous.from, to);
        } else marks.push(cx.elt('CodeText', from, to));
      };
      let first = true, empty = true, hasLine = false;
      while (cx.nextLine() && (cx.lineStart < fence.to || fence.ownsEOF && cx.lineStart === fence.to)) {
        if (fence.closing && fence.closing.from <= cx.lineStart + line.text.length) {
          marks.push(...line.markers);
          if (empty && hasLine) codeText(cx.lineStart - 1, cx.lineStart);
          marks.push(cx.elt('CodeMark', fence.closing.from, fence.closing.to));
          cx.nextLine();
          break;
        }
        hasLine = true;
        if (!first) { codeText(cx.lineStart - 1, cx.lineStart); empty = false; }
        marks.push(...line.markers);
        const start = cx.lineStart + line.basePos, end = cx.lineStart + line.text.length;
        if (start < end) { codeText(start, end); empty = false; }
        first = false;
      }
      cx.addElement(cx.elt('FencedCode', fence.opening.from, fence.to, marks));
      return true;
    },
  }] }).parse(text);
}
// Capture the renderer's stripped indentation while enclosing containers still
// own bMarks/bsCount. Lezer columns alone cannot describe partial quote Tabs.
const observedStates = new WeakSet<object>();
renderedGrammar.block.ruler.before('code', 'source_code_prefixes', state => {
  if (observedStates.has(state)) return false;
  observedStates.add(state);
  const getLines = state.getLines;
  // Observe the actual extraction, without finding rules by Function.name
  // (bundlers rename those) or guessing which physical line closes a fence.
  state.getLines = function(from, to, indent, keepLastLF) {
    const content = getLines.call(this, from, to, indent, keepLastLF);
    const token = this.tokens[this.tokens.length - 1];
    // These rules set map after extracting their content. Later paragraph and
    // heading rules may call getLines before pushing their own first token.
    if (token?.map || token?.type !== 'code_block' && token?.type !== 'fence') return content;
    const startLine = token.type === 'fence' ? from - 1 : from, end = this.line;
    if (token.type === 'fence') {
      const env = state.env as StructureEnv;
      const lineStart = (line: number) => state.src.lastIndexOf('\n', (state.bMarks[line] ?? state.src.length) - 1) + 1;
      const range = (from: number, to: number): Range => ({ from: env.offsets[from], to: env.offsets[to] });
      const marker = (line: number): Range => {
        const at = state.bMarks[line] + state.tShift[line];
        let last = at + 1;
        while (last < state.eMarks[line] && state.src[last] === state.src[at]) last++;
        return range(at, last);
      };
      // getLines excludes the real closing line; state.line includes it iff
      // fence's parser actually accepted it. A fence-looking body line is not
      // inferred to close merely because it is the last line or a Lezer mark.
      const closing = end > to ? marker(to) : null;
      const last = state.eMarks[end - 1];
      const ownsEOF = !closing && (last === state.src.length || last === state.src.length - 1 && state.src[last] === '\n');
      const blockEnd = ownsEOF ? state.src.length : last;
      const bodyFrom = Math.min(blockEnd, from < end ? lineStart(from) : blockEnd);
      env.fences.push({ ...range(lineStart(startLine), blockEnd), opening: marker(startLine), closing,
        bodyRange: range(bodyFrom, closing ? lineStart(to) : blockEnd), ownsEOF, content });
    }
    for (let line = startLine; line < end; line++) {
      const begin = state.bMarks[line], physical = state.src.lastIndexOf('\n', begin - 1) + 1;
      const quote = physical + state.src.slice(physical, begin).lastIndexOf('>');
      if (quote < physical) continue;
      const markerLine = line < from || line >= to;
      let cursor = begin, column = 0;
      if (markerLine) {
        // Fence delimiters use the block parser's full indentation, including
        // its partially consumed optional quote separator. They are not body
        // lines extracted by getLines; consume the entire structural prefix.
        cursor += state.tShift[line];
        column = state.sCount[line];
      } else {
        // Match getLines' consumed prefix and Tab overhang. It can consume
        // fewer columns than indent (the quote parser's virtual separator can
        // differ from physical whitespace), but a canonical space prefix must
        // still supply indent columns to preserve the code block/extraction.
        while (cursor < state.eMarks[line] && column < indent && /[\t ]/.test(state.src[cursor])) {
          column += state.src[cursor++] === '\t' ? 4 - (column + state.bsCount[line]) % 4 : 1;
        }
        column = Math.max(indent, column);
      }
      const prefix = state.src.slice(quote + 1, cursor);
      // With zero stripping, an optional quote separator may be only virtual:
      // getLines leaves the whole Tab in the literal suffix. Supply a physical
      // space before it, so moving to another column cannot consume that Tab.
      const virtualSeparator = cursor === quote + 1 && state.src[cursor] === '\t';
      if (/^[\t ]*$/.test(prefix) && (prefix.includes('\t') || virtualSeparator)) {
        // One quote separator, stripped code indentation, then partial-Tab
        // overhang. Everything after cursor is literal and stays byte-identical.
        const env = state.env as StructureEnv;
        env.codePrefixes.push({ from: env.offsets[quote + 1], to: env.offsets[cursor], insert: ' '.repeat(1 + column) });
      }
    }
    return content;
  };
  return false;
});

interface Literal extends Range { block: boolean; ownsEnd: boolean }
interface MathRange extends Literal { closed: boolean; display: boolean }
interface Structure {
  tree: ReturnType<typeof grammar.parse>;
  literals: Literal[];
  maths: MathRange[];
  paragraphs: Range[];
  quotes: Range[];
  headings: (Range & { content: string })[];
  codePrefixes: CodePrefix[];
  fences: RendererFence[];
  codeSignatures: { kind: 'fence' | 'code_block'; content: string; info: string }[];
}
// Derived context only. Commands and projection share this bounded cache; Source
// and the root editor history remain the sole document authority.
let cached: { text: string; value: Structure } | undefined;
export function structureContext(text: string): Structure {
  if (cached?.text === text) return cached.value;
  const literals: Literal[] = [], maths: MathRange[] = [], paragraphs: Range[] = [], quotes: Range[] = [];
  const headings: Structure['headings'] = [];
  const codeSignatures: Structure['codeSignatures'] = [];
  const env: StructureEnv = { ...createEnv(text, {}), codePrefixes: [], fences: [] };
  const tokens = renderedGrammar.parse(text, env), starts = [0];
  const tree = structureTree(text, env.fences);
  for (const fence of env.fences) literals.push({ from: fence.from, to: fence.to, block: true, ownsEnd: !fence.closing });
  for (let at = 0; at < env.normalized.length; at++) if (env.normalized[at] === '\n') starts.push(at + 1);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'fence' || token.type === 'code_block') {
      codeSignatures.push({ kind: token.type, content: token.content, info: token.info });
    }
    if (token.type === 'heading_open' && token.map && tokens[i + 1]?.type === 'inline') {
      headings.push({ from: env.offsets[starts[token.map[0]]],
        to: env.offsets[starts[token.map[1]] ?? env.normalized.length], content: tokens[i + 1].content });
    }
  }
  for (const token of tokens.flatMap(t => [t, ...(t.children ?? [])])) {
    if (/^math_(inline|block)$/.test(token.type)) {
      const { from, to, closed } = token.meta as { from: number; to: number; closed: boolean };
      const end = !closed && token.block && text.slice(to) === '\n' ? text.length : to;
      const range = { from, to: end, closed, block: token.block, display: token.type === 'math_block', ownsEnd: !closed };
      maths.push(range); literals.push(range);
    }
    if (!token.map) continue;
    const from = env.offsets[starts[token.map[0]]];
    let end = starts[token.map[1]] ?? env.normalized.length;
    if (env.normalized[end - 1] === '\n') end--;
    const to = env.offsets[end];
    if (token.type === 'paragraph_open' && token.level === 0) paragraphs.push({ from, to });
    if (token.type === 'blockquote_open') quotes.push({ from, to });
    if (token.type === 'html_block') literals.push({ from, to, block: true, ownsEnd: true });
  }
  tree.iterate({ enter(node) {
    // Renderer fences are authoritative, including when Lezer ends one early
    // or invents an additional fence after the renderer's actual closing line.
    if (node.name === 'FencedCode') return false;
    const block = ['CodeBlock', 'HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock'].includes(node.name);
    if (block || ['InlineCode', 'HTMLTag', 'Image', 'URL'].includes(node.name)) {
      literals.push({ from: node.from, to: node.to, block, ownsEnd: block });
      return false;
    }
  } });
  const value = { tree, literals, maths, paragraphs, quotes, headings, codePrefixes: env.codePrefixes, fences: env.fences, codeSignatures };
  cached = { text, value }; return value;
}

/** True for any literal intersection; collapsed selections use insertion ownership. */
export function isLiteralRange(text: string, from: number, to = from): boolean {
  if (from > to) [from, to] = [to, from];
  return structureContext(text).literals.some(r => from === to
    ? (r.block ? from >= r.from : from > r.from) && (from < r.to || r.ownsEnd && from === r.to)
    : from < r.to && to > r.from);
}

/** Physical line overlap protects complete opaque blocks during live formatting. */
export function isLiteralBlockRange(text: string, from: number, to: number): boolean {
  return structureContext(text).literals.some(r => r.block && (from === to
    ? from >= r.from && (from < r.to || r.ownsEnd && from === r.to)
    : from < r.to && to > r.from));
}

export function isOrdinaryParagraphRange(text: string, from: number, to = from): boolean {
  return !isLiteralRange(text, from, to) && structureContext(text).paragraphs.some(r => from >= r.from && to <= r.to);
}
