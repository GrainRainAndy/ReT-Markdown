import { it, expect } from "vitest";
import {
  renderDocument,
  renderSourceDocument,
  assetURL,
} from "../../editor/render/document";
it("exports the frozen source as safe standalone html without executable raw HTML or remote images", () => {
  const html = renderDocument(
    "# Title\n\n<script>alert(1)</script>\n\n![bad](https://evil.test/a.png)\n\n$x^2$",
  );
  expect(html).toContain("<h1>Title</h1>");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('src="https:');
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("katex");
  expect(html).toContain("@page");
});
it("encodes local asset segments and refuses external and traversal schemes", () => {
  expect(assetURL("assets/中文 a.png")).toBe(
    "ret-asset://document/assets/%E4%B8%AD%E6%96%87%20a.png",
  );
  expect(assetURL("../secret")).toBeNull();
  expect(assetURL("javascript:alert(1)")).toBeNull();
});
it("main-thread rendering keeps source math and source-only fallback escapes frozen content", () => {
  const html = renderDocument("$x^2$");
  expect(html).toContain('<code class="math-error">x^2</code>');
  expect(html).not.toContain("katex-mathml");
  const fallback = renderSourceDocument(
    "<script>frozen</script>\n\n$x$",
    "timeout",
  );
  expect(fallback).toContain('data-render-state="timeout"');
  expect(fallback).toContain("&lt;script&gt;frozen&lt;/script&gt;");
  expect(fallback).not.toContain("<script>");
});

it("collects only image destinations for the frozen source including reference images", async () => {
  const { collectAssetReferences } =
    await import("../../editor/render/document");
  expect(
    collectAssetReferences(
      "![a](x%20y.svg)\n\n![b][ref]\n\n[ref]: managed/z.png\n\n[link](ignore.png)\n\n`![code](ignore2.png)`",
    ),
  ).toEqual(["x%20y.svg", "managed/z.png"]);
});
it("renders missing and remote image placeholders with their readable path and capability URLs", () => {
  const html = renderDocument(
    "![alt](missing.svg)\n\n![remote](https://example.com/图.png)",
    undefined,
    "capability-test",
  );
  expect(html).toContain("ret-asset://capability-test/missing.svg");
  expect(html).toContain('data-asset-path="missing.svg"');
  expect(html).toContain("https://example.com/图.png");
  expect(html).not.toContain('<img src="https:');
  expect(html).not.toContain("overflow:hidden");
});
