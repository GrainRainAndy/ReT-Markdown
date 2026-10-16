import path from 'node:path';
import { readFile } from 'node:fs/promises';

/** Import CSS as a JavaScript string, with an optional raw-byte reporting hook. */
export function rawCssPlugin({ inline = false, onRead } = {}) {
  return {
    name: 'raw-css',
    setup(bundle) {
      bundle.onResolve({ filter: inline ? /\.css\?(raw|inline)$/ : /\.css\?raw$/ }, args => ({
        path: path.resolve(args.resolveDir, args.path.replace(/\?(raw|inline)$/, '')),
        namespace: 'raw-css',
      }));
      bundle.onLoad({ filter: /.*/, namespace: 'raw-css' }, async args => {
        const bytes = await readFile(args.path);
        onRead?.(args.path, bytes);
        return { contents: `export default ${JSON.stringify(bytes.toString('utf8'))}`, loader: 'js' };
      });
    },
  };
}

/** Fixed fallback only; callers retain their browser selection policy. */
export function chromiumFallbackPath(homeDirectory = process.env.HOME) {
  return `${homeDirectory}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
}
