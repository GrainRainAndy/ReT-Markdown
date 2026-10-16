import type { Extension } from '@codemirror/state';
import type { Mode, Patch, Range, Selection, Source } from '../protocol';

/** Stable adapter: live UI projects edits into the root session's sole history. */
export interface LiveOptions {
  /** Current root source (includes provisional preedit while composing). */
  getSource(): Source;
  /** One atomic root transaction; blocked while composing. */
  apply(patches: readonly Patch[], options?: { selection?: Selection; userEvent?: string }): void;
  /** Capability URLs only; null means an offline placeholder. */
  resolveImage(destination: string): string | null;
  getMode(): Mode;
  composition(): { composing: boolean; range: Range | null };
}
export type LiveExtensionFactory = (options: LiveOptions) => Extension;
