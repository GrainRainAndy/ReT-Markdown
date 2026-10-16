import { blockSourceRanges, renderMarkdown, type RenderIssue } from './render/markdown';
import printStyles from '../styles/print.css?raw';

// Structurally compatible with the editor's flat Snapshot; no editor/session
// dependency is loaded into the dedicated printing WebView.
export interface ExportSnapshot { text: string; eols: readonly string[]; bom: boolean; revision: number }
export interface ExportRange { from: number; to: number }
export type AssetMap = Readonly<Record<string, string>>;
export interface ExportReady {
  revision: number;
  issues: RenderIssue[];
  overflow: ExportRange[];
  ready: boolean;
  failure?: string;
}
export interface ExportHost {
  mount(html: string, source: string): void;
  fontsReady(): Promise<void>;
  imagesReady(): Promise<RenderIssue[]>;
  layoutReady(): Promise<void>;
  overflow(): ExportRange[];
}
export const printGeometry = Object.freeze({
  // WebKit lays out CSS px at 96/in; NSPrintInfo coordinates are 72/in.
  width: (595.276 - 2 * 56.693) * 96 / 72,
  height: (841.890 - 2 * 56.693) * 96 / 72,
});

function validate(snapshot: ExportSnapshot): void {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
    || typeof snapshot.text !== 'string' || snapshot.text.includes('\r')
    || typeof snapshot.bom !== 'boolean' || !Array.isArray(snapshot.eols)
    || snapshot.eols.length !== (snapshot.text.match(/\n/g) ?? []).length
    || snapshot.eols.some(eol => !['\n', '\r\n', '\r'].includes(eol))) {
    throw new Error('Invalid export snapshot');
  }
}

async function timed<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Export readiness timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Call once in a dedicated page. Copy all inputs before the first await. */
export async function prepareExport(
  snapshot: ExportSnapshot, assets: AssetMap,
  options: { host?: ExportHost; timeoutMs?: number } = {},
): Promise<ExportReady> {
  validate(snapshot);
  const frozen = { ...snapshot, eols: [...snapshot.eols] };
  const capabilities = Object.freeze({ ...assets });
  // Native scan results retain Markdown destination spelling, while the shared
  // renderer decodes percent escapes and Markdown punctuation escapes before
  // asking its resolver. Keep URLs opaque and normalize keys only.
  const decodedCapabilities = new Map(Object.entries(capabilities).map(([key, value]) => {
    const unescaped = key.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
    try { return [decodeURIComponent(unescaped), value]; }
    catch { return [unescaped, value]; }
  }));
  const host = options.host ?? browserExportHost();
  const rendered = renderMarkdown(frozen.text, {
    resolveImage: destination => Object.hasOwn(capabilities, destination) ? capabilities[destination] : decodedCapabilities.get(destination) ?? null,
  });
  const result: ExportReady = { revision: frozen.revision, issues: [...rendered.issues], overflow: [], ready: false };
  try {
    host.mount(rendered.html, frozen.text);
    // All loads begin together, but diagnostics/layout are consumed only once
    // both font shaping and image decoding have settled.
    const loaded = await timed(Promise.all([host.fontsReady(), host.imagesReady()]), options.timeoutMs ?? 10_000);
    result.issues.push(...loaded[1]);
    await timed(host.layoutReady(), options.timeoutMs ?? 10_000);
    result.overflow = host.overflow();
    result.ready = result.issues.length === 0 && result.overflow.length === 0;
  } catch (error) {
    result.failure = error instanceof Error ? error.message : String(error);
  }
  return result;
}

function setRange(element: Element, range: ExportRange): void {
  element.setAttribute('data-export-from', String(range.from));
  element.setAttribute('data-export-to', String(range.to));
}
function rangeOf(element: Element, length: number): ExportRange {
  const mapped = element.closest('[data-export-from]');
  return mapped ? { from: Number(mapped.getAttribute('data-export-from')), to: Number(mapped.getAttribute('data-export-to')) }
    : { from: 0, to: length };
}

/** Ranges and HTML use the same configured renderer grammar. Inline image
 * errors retain the precise token range; decode/layout errors reveal the block. */
function mapSource(root: HTMLElement, source: string): void {
  const blocks = blockSourceRanges(source);
  // Reference definitions and inline/closing tokens emit no root element;
  // atomic HTML, lists, tables and math each emit one with this shared grammar.
  [...root.children].forEach((element, index) => {
    setRange(element, blocks[index] ?? { from: 0, to: source.length });
  });
}

export function browserExportHost(doc: Document = document): ExportHost {
  let root: HTMLElement;
  let sourceLength = 0;
  return {
    mount(html, source) {
      sourceLength = source.length;
      // Local-file stylesheets have opaque origins in some browsers. Import the
      // owner's stylesheet at build time, rather than reading its CSSOM. This
      // disposable page uses the exact print rules for readiness and printing.
      const style = doc.createElement('style');
      style.textContent = printStyles.replace(/@media\s+print\b/g, '@media all');
      doc.head.append(style);
      doc.documentElement.style.fontSize = '13px';
      root = doc.createElement('main'); root.className = 'markdown-body';
      root.dataset.colorScheme = 'light'; root.dataset.exportRoot = '';
      root.style.width = `${printGeometry.width}px`;
      root.innerHTML = html;
      doc.body.replaceChildren(root);
      // On macOS, PingFang's PDF glyph map can substitute Kangxi-radical code
      // points for ordinary Han characters, breaking literal search/extraction.
      // Keep the renderer's Latin/mono faces and choose the system's offline
      // Hiragino CJK face before any generic fallback. Do this before readiness
      // and measurement, so pagination uses the fonts that will be printed.
      const view = doc.defaultView!;
      root.style.fontFamily = `"Open Sans", "Hiragino Sans GB", ${view.getComputedStyle(root).fontFamily}`;
      for (const code of root.querySelectorAll<HTMLElement>('pre, code')) {
        const namedFaces = view.getComputedStyle(code).fontFamily.split(',')
          .filter(face => !['monospace', 'ui-monospace'].includes(face.trim()));
        code.style.fontFamily = [...namedFaces, '"Hiragino Sans GB"', 'ui-monospace', 'monospace'].join(',');
      }
      mapSource(root, source);
    },
    async fontsReady() {
      // Force the bundled primary faces, including a bold heading face. ready
      // alone resolves even when a font failed and the browser used a fallback.
      const faces = await Promise.all([
        doc.fonts.load('13px "Open Sans"'), doc.fonts.load('700 13px "Open Sans"'),
      ]);
      if (faces.some(group => group.length === 0)) throw new Error('Required export font is unavailable');
      await doc.fonts.ready;
      let failed = false;
      doc.fonts.forEach(face => { if (face.status === 'error') failed = true; });
      if (failed) throw new Error('Export font load failed');
    },
    async imagesReady() {
      return (await Promise.all([...root.querySelectorAll('img')].map(async image => {
        try {
          await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
          return null;
        } catch {
          return { kind: 'image' as const, message: 'Local image decode failed', ...rangeOf(image, sourceLength) };
        }
      }))).filter(issue => issue !== null);
    },
    async layoutReady() {
      // KaTeX renders synchronously; two frames settle font reflow and image
      // intrinsic sizes. A detached WKWebView may throttle rAF, so use timers
      // and a forced layout rather than relying on a visible editor frame.
      await new Promise(resolve => setTimeout(resolve, 0));
      void root.offsetHeight;
      for (const block of root.querySelectorAll<HTMLElement>('pre, blockquote, .katex-display, table')) {
        if (block.getBoundingClientRect().height <= printGeometry.height) block.style.breakInside = 'avoid-page';
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      void root.offsetHeight;
    },
    overflow() {
      const bounds = root.getBoundingClientRect();
      const ranges = new Map<string, ExportRange>();
      for (const element of root.querySelectorAll<HTMLElement>('*')) {
        // Accessibility-only MathML is clipped intentionally by KaTeX.
        if (element.closest('.katex-mathml') || !element.getClientRects().length) continue;
        const box = element.getBoundingClientRect();
        const horizontal = box.right > bounds.right + 1 || box.left < bounds.left - 1
          || (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1);
        const unbreakable = (element.matches('img, .katex-display') && box.height > printGeometry.height + 1);
        if (horizontal || unbreakable) {
          const range = rangeOf(element, sourceLength);
          ranges.set(`${range.from}:${range.to}`, range);
        }
      }
      return [...ranges.values()].sort((a, b) => a.from - b.from);
    },
  };
}

/** Completeness checks exclude formula glyph extraction (not an acceptance
 * requirement). First/last visible text samples catch a truncated final page. */
export function exportValidation(doc: Document = document): { minimumPages: number; textSamples: string[] } {
  const root = doc.querySelector<HTMLElement>('[data-export-root]');
  if (!root) throw new Error('Export has not been prepared');
  const walker = doc.createTreeWalker(root, 4);
  const samples: string[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('.katex, .katex-display, .math-error, script, style')) continue;
    const text = (node.textContent ?? '').trim();
    if (text) samples.push(text);
  }
  return {
    minimumPages: Math.max(1, Math.ceil((root.getBoundingClientRect().height - 2) / printGeometry.height)),
    textSamples: samples.length ? [samples[0].slice(0, 80), samples[samples.length - 1].slice(-80)] : [],
  };
}
