// Imported only by the isolated worker, never by the editor/main bundle.
import katex from "katex";
import { mathFallback } from "./document";
export function renderMath(text: string, displayMode = false): string {
  if (text.length > 20000) return mathFallback(text);
  try {
    return katex.renderToString(text, {
      displayMode,
      trust: false,
      strict: "ignore",
      maxExpand: 500,
      maxSize: 20,
      throwOnError: true,
      macros: {},
    });
  } catch {
    return mathFallback(text);
  }
}
