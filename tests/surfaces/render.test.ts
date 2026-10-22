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

it("shares recursive first-definition reference semantics across projection, assets and clipboard", async () => {
  const { RichProjection } = await import("../../editor/surfaces/projection");
  const { collectAssetReferences } =
    await import("../../editor/render/document");
  const { plainMarkdown, clipboardHTML } =
    await import("../../editor/surfaces/clipboard");
  for (const suffix of ["[Asset Label]", "[]", ""]) {
    const source = `> [ASSET   label]: images/first.png\n\n[asset label]: images/second.png\n\n![Asset Label]${suffix} and [Asset Label]${suffix}`;
    const projection = new RichProjection(source);
    let imageURL = "",
      linkURL = "";
    projection.doc.descendants((n) => {
      if (n.type.name === "image") imageURL = n.attrs.url;
      for (const m of n.marks)
        if (m.type.name === "link") linkURL = m.attrs.url;
    });
    expect(imageURL).toBe("images/first.png");
    expect(linkURL).toBe("images/first.png");
    expect(collectAssetReferences(source)).toEqual(["images/first.png"]);
    expect(clipboardHTML(source)).toContain(
      'data-asset-path="images/first.png"',
    );
    expect(
      plainMarkdown(
        `hello ![alt](images/x.png) and ![Asset Label]${suffix}\n\n[Asset Label]: images/first.png`,
      ),
    ).toContain("hello alt and Asset Label");
    const changed = new RichProjection(
      source.replace("images/first.png", "images/changed.png"),
    );
    changed.doc.descendants((n) => {
      if (n.type.name === "image")
        expect(n.attrs.url).toBe("images/changed.png");
    });
  }
});
it("exports table header semantics and each column alignment", () => {
  const html = renderDocument("| L | R |\n| :-- | --: |\n| a | b |");
  expect(html).toContain('<th style="text-align:left">L</th>');
  expect(html).toContain('<th style="text-align:right">R</th>');
  expect(html).toContain('<td style="text-align:right">b</td>');
});
it("print CSS shares approved typography tokens while keeping its searchable CJK overrides", async () => {
  const { printCSS } = await import("../../editor/render/document");
  expect(printCSS).toContain("--h1:2.25em");
  expect(printCSS).toContain("--h2:1.75em");
  expect(printCSS).toContain("--block-gap:0.8em");
  expect(printCSS).toContain('"Hiragino Sans GB"');
});
it("shared block spacing reaches tables, literals, and all heading levels", async () => {
  const { printCSS } = await import("../../editor/render/document");
  expect(printCSS).toContain(
    "h1,h2,h3,h4,h5,h6{line-height:1.25;margin:var(--block-gap) 0}",
  );
  expect(printCSS).toContain(
    "pre,blockquote,table{margin:0 0 var(--block-gap)}",
  );
  expect(printCSS).toContain("font:var(--body-size)/var(--body-leading)");
});
it("semantic clipboard resolves selected reference fragments against document-wide first definitions", async () => {
  const { plainMarkdown, clipboardHTML } =
    await import("../../editor/surfaces/clipboard");
  const context =
    "> [asset]: images/first.png\n\n[asset]: images/second.png\n\n[link]: https://example.com";
  for (const fragment of ["![alt][asset]", "![asset][]", "![asset]"]) {
    expect(plainMarkdown(fragment, context)).toBe(
      fragment.includes("alt") ? "alt" : "asset",
    );
    expect(clipboardHTML(fragment, context)).toContain(
      'data-asset-path="images/first.png"',
    );
  }
  expect(clipboardHTML("[go][link]", context)).toContain(
    'href="https://example.com"',
  );
});
