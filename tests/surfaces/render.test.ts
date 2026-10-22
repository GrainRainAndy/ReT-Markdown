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
