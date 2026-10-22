import { buildProjection, type ProjectionNode } from "../syntax/projection";
import { renderDocument } from "../render/document";
export function plainMarkdown(source: string): string {
  const text = (n: ProjectionNode): string => {
    if (n.text !== undefined) return n.text;
    if (n.type === "image" || n.type === "imageReference")
      return String(n.attributes.alt ?? "");
    const separator = ["tableRow"].includes(n.type)
      ? "\t"
      : ["list", "listItem", "blockquote", "table"].includes(n.type)
        ? "\n"
        : "";
    return n.children.map(text).join(separator);
  };
  return buildProjection(source).blocks.map(text).join("\n\n");
}
export function clipboardHTML(source: string): string {
  const html = renderDocument(source);
  return html.slice(html.indexOf("<article>") + 9, html.indexOf("</article>"));
}
