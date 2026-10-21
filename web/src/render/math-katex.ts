/** Private adapter for the pinned KaTeX 0.19.0 parser/HTML builder contract. */
import Settings from 'katex/src/Settings.ts';
import parseTree, { type MathParseNode } from 'katex/src/parseTree.ts';
import buildTree from 'katex/src/buildTree.ts';
import { _htmlGroupBuilders } from 'katex/src/defineFunction.ts';
import { SymbolNode } from 'katex/src/domTree.ts';
import { version } from 'katex/package.json';

export interface MathSource {
  from: number;
  starts: number[];
  ends: number[];
}
type Segment = [number, number, number, number];
const leafTypes = ['mathord', 'textord', 'atom'] as const;
type Leaf = MathParseNode & { text: string };

/** No HTML extensions or added TeX: all attributes originate in validated parser locations. */
export function renderMappedMath(expression: string, displayMode: boolean, clipboard: boolean, source: MathSource): string {
  const settings = new Settings({ displayMode, output: clipboard ? 'mathml' : 'htmlAndMathml',
    trust: false, strict: 'ignore', throwOnError: true, maxExpand: 1000, maxSize: 50 });
  const tree = parseTree(expression, settings);
  const build = () => buildTree(tree, expression, settings).toMarkup();
  if (clipboard || version !== '0.19.0' || source.starts.length !== expression.length || source.ends.length !== expression.length ||
      /\\(?:def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand)\b/.test(expression)) return build();

  // Count AST occurrences, including repeated macro arguments, before touching builders.
  const leaves: Leaf[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as MathParseNode;
    if (leafTypes.some(type => type === node.type) && typeof node.text === 'string') leaves.push(node as Leaf);
    else for (const [key, child] of Object.entries(value)) if (key !== 'loc') visit(child);
  };
  visit(tree);
  const counts = new Map<string, number>();
  for (const leaf of leaves) {
    if (leaf.loc) {
      const key = `${leaf.loc.start}:${leaf.loc.end}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const valid = new Set<Leaf>();
  const at = new Map<number, Leaf>();
  for (const leaf of leaves) {
    const loc = leaf.loc;
    if (!loc || loc.lexer.input !== expression || !Number.isSafeInteger(loc.start) || !Number.isSafeInteger(loc.end) ||
        loc.start < 0 || loc.end <= loc.start || loc.end > expression.length ||
        expression.slice(loc.start, loc.end) !== leaf.text || counts.get(`${loc.start}:${loc.end}`) !== 1) continue;
    valid.add(leaf); at.set(loc.start, leaf);
  }

  const interval = (start: number, end: number): [number, number] | null => {
    const from = source.starts[start] - source.from, to = source.ends[end - 1] - source.from;
    return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from ? [from, to] : null;
  };
  const original = leafTypes.map(type => [type, _htmlGroupBuilders[type]] as const);
  try {
    for (const [type, builder] of original) {
      _htmlGroupBuilders[type] = (group, options) => {
        const node = builder(group, options);
        if (!valid.has(group as Leaf) || !(node instanceof SymbolNode)) return node;
        const initialText = node.text, loc = group.loc!;
        const serialize = node.toMarkup;
        node.toMarkup = function () {
          const markup = serialize.call(this);
          if (!markup.startsWith('<span')) return markup;
          const segments: Segment[] = [];
          if (this.text === initialText) {
            const range = interval(loc.start, loc.end);
            if (range) segments.push([0, this.text.length, ...range]);
          } else {
            // Native tryCombineChars keeps the first SymbolNode. Only a contiguous
            // literal source run can extend that node's proven location. Neither
            // displayed order nor a text search is used to recover provenance.
            if (expression.slice(loc.start, loc.start + this.text.length) !== this.text) return markup;
            let offset = 0;
            while (offset < this.text.length) {
              const leaf = at.get(loc.start + offset);
              if (!leaf?.loc || leaf.text.startsWith('\\') || leaf.text !== expression.slice(leaf.loc.start, leaf.loc.end)) return markup;
              const length = leaf.loc.end - leaf.loc.start, range = interval(leaf.loc.start, leaf.loc.end);
              if (!range || offset + length > this.text.length) return markup;
              segments.push([offset, offset + length, ...range]); offset += length;
            }
          }
          if (!segments.length) return markup;
          return markup.replace('<span', `<span data-math-start="${segments[0][2]}" data-math-end="${segments.at(-1)![3]}" data-math-map="${JSON.stringify(segments)}"`);
        };
        return node;
      };
    }
    return build();
  } finally {
    for (const [type, builder] of original) _htmlGroupBuilders[type] = builder;
  }
}
