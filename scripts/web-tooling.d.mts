import type { Plugin } from 'esbuild';

export function rawCssPlugin(options?: {
  inline?: boolean;
  onRead?: (absolutePath: string, bytes: Uint8Array) => void;
}): Plugin;

export function chromiumFallbackPath(homeDirectory?: string): string;
