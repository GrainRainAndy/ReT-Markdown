import type { SyntaxNode } from "./parse";
/** CommonMark identifiers collapse whitespace and compare Unicode case-insensitively. */
export const normalizeReference = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .toUpperCase();
export function referenceDefinitions(
  root: SyntaxNode,
): Map<string, SyntaxNode> {
  const definitions = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode): void => {
    if (node.type === "definition") {
      const key = normalizeReference(node.attributes.identifier);
      if (!definitions.has(key)) definitions.set(key, node);
    }
    node.children.forEach(visit);
  };
  visit(root);
  return definitions;
}
export function referenceResolver(
  root: SyntaxNode,
): (
  node: Pick<SyntaxNode, "type" | "attributes">,
) => Readonly<Record<string, unknown>> {
  const definitions = referenceDefinitions(root);
  return (node) =>
    node.type === "linkReference" || node.type === "imageReference"
      ? {
          ...node.attributes,
          ...definitions.get(normalizeReference(node.attributes.identifier))
            ?.attributes,
        }
      : node.attributes;
}
