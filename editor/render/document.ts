import { parseDocument, type SyntaxNode } from "../syntax/parse";
export const escapeHTML = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let capability = "document";
export const setAssetCapability = (value: string): void => {
  capability = value;
};
export const getAssetCapability = (): string => capability;
export function assetURL(value: string, token = capability): string | null {
  if (
    !value ||
    /^(?:[a-z][\w+.-]*:|\/|\\)/i.test(value) ||
    /[\u0000-\u001f]/.test(value)
  )
    return null;
  let path: string;
  try {
    path = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (path.split(/[\\/]/).some((p) => p === "..") || path.includes("\\"))
    return null;
  return (
    "ret-asset://" +
    token +
    "/" +
    path.split("/").map(encodeURIComponent).join("/")
  );
}
export function mathFallback(text: string): string {
  return `<code class="math-error">${escapeHTML(text)}</code>`;
}
export const printCSS = `:root{color-scheme:light}body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#24292f;background:#fff;margin:0;padding:30px;overflow-wrap:break-word}article{max-width:860px;margin:auto}h1,h2,h3{line-height:1.25;margin:1.4em 0 .65em}h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}h1{font-size:2em}h2{font-size:1.5em}p{margin:0 0 1em}pre{padding:16px;background:#f6f8fa;white-space:pre-wrap;font-size:13px;line-height:1.5}code{font-family:ui-monospace,Menlo,monospace}blockquote{border-left:4px solid #d0d7de;padding-left:1em;color:#57606a}table{border-collapse:collapse;max-width:100%}th,td{border:1px solid #d0d7de;padding:6px 13px}img{max-width:100%;height:auto}.image-placeholder,.math-error{color:#57606a}a{color:#0969da}.katex-display{overflow:visible}@page{size:A4}@media print{body{padding:0;font-size:11pt;font-family:"Hiragino Sans GB",-apple-system,sans-serif}code{font-family:Menlo,"Hiragino Sans GB",monospace}article>:last-child{margin-bottom:0}h1,h2,h3,h4,h5,h6{break-after:avoid}thead{display:table-header-group}tr,img{break-inside:avoid}pre{overflow-wrap:anywhere;break-inside:auto}table{width:100%;table-layout:fixed}td,th{overflow-wrap:anywhere}}`;
function documentHTML(article: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src ret-asset: data:"><link rel="stylesheet" href="katex.css"><style>${printCSS}</style></head><body><article>${article}</article></body></html>`;
}
/** Safe source-only export if workers are unavailable, fail, or exceed deadline. */
export function renderSourceDocument(source: string, status: string): string {
  return documentHTML(
    `<p>公式渲染未完成，显示冻结源文。</p><pre data-render-state="${escapeHTML(status)}">${escapeHTML(source)}</pre>`,
  );
}
export function renderDocument(
  source: string,
  math: (text: string, displayMode?: boolean) => string = mathFallback,
  token = capability,
): string {
  const syntax = parseDocument(source);
  const definitions = new Map(
    syntax.root.children
      .filter((n) => n.type === "definition")
      .map((n) => [String(n.attributes.identifier), n]),
  );
  const render = (n: SyntaxNode): string => {
    const content = () => n.children.map(render).join("");
    switch (n.type) {
      case "text":
        return escapeHTML(n.value ?? n.raw);
      case "paragraph":
        return `<p>${content()}</p>`;
      case "heading": {
        const d = Number(n.attributes.depth) || 1;
        return `<h${d}>${content()}</h${d}>`;
      }
      case "strong":
        return `<strong>${content()}</strong>`;
      case "emphasis":
        return `<em>${content()}</em>`;
      case "delete":
        return `<s>${content()}</s>`;
      case "inlineCode":
        return `<code>${escapeHTML(n.value ?? "")}</code>`;
      case "code":
        return `<pre><code>${escapeHTML(n.value ?? "")}</code></pre>`;
      case "math":
        return math(n.value ?? "", true);
      case "inlineMath":
        return math(n.value ?? "");
      case "break":
        return "<br>";
      case "thematicBreak":
        return "<hr>";
      case "blockquote":
        return `<blockquote>${content()}</blockquote>`;
      case "list":
        return n.attributes.ordered
          ? `<ol start="${Number(n.attributes.start) || 1}">${content()}</ol>`
          : `<ul>${content()}</ul>`;
      case "listItem":
        return `<li>${typeof n.attributes.checked === "boolean" ? (n.attributes.checked ? "☑ " : "☐ ") : ""}${content()}</li>`;
      case "table":
        return `<table><thead>${n.children[0] ? render(n.children[0]) : ""}</thead><tbody>${n.children.slice(1).map(render).join("")}</tbody></table>`;
      case "tableRow":
        return `<tr>${content()}</tr>`;
      case "tableCell":
        return `<td>${content()}</td>`;
      case "image":
      case "imageReference": {
        const ref =
          n.type === "imageReference"
            ? definitions.get(String(n.attributes.identifier))
            : n;
        const url = assetURL(String(ref?.attributes.url ?? ""), token);
        return url
          ? `<img data-asset-path="${escapeHTML(String(ref?.attributes.url ?? ""))}" src="${escapeHTML(url)}" alt="${escapeHTML(String(n.attributes.alt ?? ""))}">`
          : `<span class="image-placeholder">[图片：${escapeHTML(String(ref?.attributes.url ?? n.attributes.alt ?? ""))}]</span>`;
      }
      case "link":
      case "linkReference": {
        const ref =
          n.type === "linkReference"
            ? definitions.get(String(n.attributes.identifier))
            : n;
        const url = String(ref?.attributes.url ?? "");
        return /^(https?:|mailto:)/i.test(url)
          ? `<a href="${escapeHTML(url)}" rel="noreferrer">${content()}</a>`
          : content();
      }
      case "definition":
        return "";
      default:
        return `<pre class="raw">${escapeHTML(n.raw)}</pre>`;
    }
  };
  return documentHTML(syntax.root.children.map(render).join("\n"));
}

/** Parse image destinations only; code, prose and unrelated links grant no asset access. */
export function collectAssetReferences(source: string): string[] {
  const tree = parseDocument(source).root;
  const definitions = new Map(
    tree.children
      .filter((n) => n.type === "definition")
      .map((n) => [String(n.attributes.identifier), n]),
  );
  const paths: string[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.type === "image" || n.type === "imageReference") {
      const ref =
        n.type === "imageReference"
          ? definitions.get(String(n.attributes.identifier))
          : n;
      const path = String(ref?.attributes.url ?? "");
      if (path && !paths.includes(path)) paths.push(path);
    }
    n.children.forEach(visit);
  };
  visit(tree);
  return paths;
}
