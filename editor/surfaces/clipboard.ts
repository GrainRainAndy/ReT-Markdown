import { parseDocument } from "../syntax/parse";
import { referenceDefinitions } from "../syntax/references";
import { buildProjection, type ProjectionNode } from "../syntax/projection";
import { renderDocument } from "../render/document";
function withReferences(source: string, context?: string): string {
  if (!context || source === context) return source;
  const definitions = [
    ...referenceDefinitions(parseDocument(context).root).values(),
  ];
  const prefix = definitions
    .map((node) => {
      // Keep the original label spelling/escaping, but discard container prefixes and title.
      const label = /^\[((?:\\[\s\S]|[^\]\\])*)\]:/.exec(node.raw)?.[0];
      if (!label) return "";
      const url = String(node.attributes.url ?? "")
        .replace(/[\\<>]/g, "\\$&")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");
      return `${label} <${url}>`;
    })
    .join("\n");
  return prefix ? prefix + "\n\n" + source : source;
}
export function plainMarkdown(source: string, context?: string): string {
  source = withReferences(source, context);
  const text = (n: ProjectionNode): string => {
    if (n.type === "image" || n.type === "imageReference")
      return String(n.attributes.alt ?? "");
    if (n.type === "definition") return "";
    if (n.text !== undefined) return n.text;
    const separator = ["tableRow"].includes(n.type)
      ? "\t"
      : ["list", "listItem", "blockquote", "table"].includes(n.type)
        ? "\n"
        : "";
    return n.children.map(text).join(separator);
  };
  return buildProjection(source)
    .blocks.filter((n) => n.type !== "definition")
    .map(text)
    .join("\n\n");
}
export function clipboardHTML(source: string, context?: string): string {
  const html = renderDocument(withReferences(source, context));
  return html.slice(html.indexOf("<article>") + 9, html.indexOf("</article>"));
}
