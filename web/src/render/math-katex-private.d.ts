/** Minimal private contract inspected against pinned KaTeX 0.19.0.
 * Keep package build-time-only types behind the adapter. Version gating and
 * native-markup parity tests protect this dependency boundary.
 */
declare module 'katex/src/Settings.ts' {
  export default class Settings { constructor(options: Record<string, string | number | boolean>); }
}
declare module 'katex/src/parseTree.ts' {
  import Settings from 'katex/src/Settings.ts';
  export interface MathParseNode {
    type: string;
    text?: string;
    loc?: { start: number; end: number; lexer: { input: string } } | null;
    [key: string]: unknown;
  }
  export default function parseTree(expression: string, settings: Settings): MathParseNode[];
}
declare module 'katex/src/buildTree.ts' {
  import Settings from 'katex/src/Settings.ts';
  import type { MathParseNode } from 'katex/src/parseTree.ts';
  export default function buildTree(tree: MathParseNode[], expression: string, settings: Settings): { toMarkup(): string };
}
declare module 'katex/src/defineFunction.ts' {
  import type { MathParseNode } from 'katex/src/parseTree.ts';
  export const _htmlGroupBuilders: Record<string, (group: MathParseNode, options: unknown) => { toMarkup(): string }>;
}
declare module 'katex/src/domTree.ts' {
  export class SymbolNode { text: string; toMarkup(): string; }
}
// KaTeX's source Parser imports these CommonJS generators without declarations.
// They use only String.normalize and plain data, so esbuild bundles them offline.
declare module '*unicodeAccents' {
  const accents: Record<string, { text: string; math?: string }>;
  export default accents;
}
declare module '*unicodeSymbols' {
  const symbols: Record<string, string>;
  export default symbols;
}
