// Run with the candidate verification server on :4173. No product hooks.
import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const output = resolve(
  process.env.RET_VISUAL_DIR ||
    "build/rewrite/verification/2026-10-23/iteration-2/visual",
);
await mkdir(output, { recursive: true });
const source = await readFile("fixtures/visual-acceptance.md", "utf8");
const browser = await chromium.launch();
const results = {
  fixture: "fixtures/visual-acceptance.md",
  fixtureSHA256: createHash("sha256").update(source).digest("hex"),
  runtime: process.version,
  browser: browser.version(),
  cases: [],
};
try {
  for (const appearance of ["light", "dark"])
    for (const width of [600, 1100, 1900]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.addInitScript(
        ({ source, appearance }) => {
          window.hostMessages = [];
          window.webkit = {
            messageHandlers: {
              ret: {
                postMessage(message) {
                  window.hostMessages.push(message);
                  if (message.method === "ready")
                    queueMicrotask(() =>
                      window.retNative.receive({
                        v: 1,
                        documentId: "visual",
                        epoch: "visual",
                        requestId: "load",
                        method: "load",
                        payload: {
                          source,
                          revision: 0,
                          displayName: "visual-acceptance.md",
                          fileURL: null,
                          appearance,
                        },
                      }),
                    );
                },
              },
            },
          };
        },
        { source, appearance },
      );
      await page.goto("http://127.0.0.1:4173/");
      await page.locator(".math-preview .katex").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => {
        const fields = [
          "fontFamily",
          "fontSize",
          "fontWeight",
          "lineHeight",
          "color",
          "backgroundColor",
          "width",
          "maxWidth",
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
          "marginTop",
          "marginBottom",
          "borderLeftWidth",
          "borderLeftColor",
          "borderBottomWidth",
          "borderBottomColor",
          "borderRadius",
        ];
        const selectors = [
          "#workspace",
          ".ProseMirror",
          ...Array.from({ length: 6 }, (_, i) => ".ProseMirror h" + (i + 1)),
          ".ProseMirror p",
          ".ProseMirror ul",
          ".ProseMirror ol",
          ".ProseMirror blockquote",
          ".literal",
          ".literal-label",
          ".cm-content",
          ".tok-keyword",
          ".tok-number",
          ".tok-comment",
          ".ProseMirror table",
          ".ProseMirror th",
          ".ProseMirror td",
          ".math-preview",
          ".katex",
        ];
        return {
          viewport: {
            width: innerWidth,
            height: innerHeight,
            devicePixelRatio,
            scale: visualViewport.scale,
          },
          editZoom:
            getComputedStyle(document.documentElement).getPropertyValue(
              "--edit-zoom",
            ) || "1",
          styles: Object.fromEntries(
            selectors.map((selector) => {
              const el = document.querySelector(selector);
              if (!el) return [selector, null];
              const s = getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return [
                selector,
                {
                  ...Object.fromEntries(fields.map((k) => [k, s[k]])),
                  rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  },
                  visible: rect.height > 0,
                },
              ];
            }),
          ),
          sourceMutations: window.hostMessages.filter(
            (m) => m.method === "checkpoint",
          ).length,
        };
      });
      const client = await context.newCDPSession(page);
      await client.send("DOM.enable");
      await client.send("CSS.enable");
      const { root } = await client.send("DOM.getDocument");
      metrics.platformFonts = {};
      for (const selector of [
        ".ProseMirror h1",
        ".ProseMirror p",
        ".cm-line",
        ".katex .mathnormal",
      ]) {
        const { nodeId } = await client.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector,
        });
        metrics.platformFonts[selector] = (
          await client.send("CSS.getPlatformFontsForNode", { nodeId })
        ).fonts;
      }
      const name = `github-${appearance}-${width}`;
      await page.screenshot({ path: resolve(output, name + "-viewport.png") });
      await page.screenshot({
        path: resolve(output, name + ".png"),
        fullPage: true,
      });
      const preview = page.locator(".math-preview");
      await preview.scrollIntoViewIfNeeded();
      metrics.math = {
        folded: await page.locator(".literal").last().boundingBox(),
        previewBefore: await preview.boundingBox(),
        scrollBefore: await page.evaluate(() => scrollY),
      };
      await preview.click();
      metrics.math.expanded = await page
        .locator(".literal")
        .last()
        .boundingBox();
      metrics.math.previewAfter = await preview.boundingBox();
      metrics.math.scrollAfter = await page.evaluate(() => scrollY);
      await page.screenshot({ path: resolve(output, name + "-math-edit.png") });
      await page
        .locator(".literal .cm-content")
        .last()
        .evaluate((el) => el.blur());
      await page
        .locator(".literal .cm-content")
        .last()
        .waitFor({ state: "hidden" });
      metrics.math.previewAfterBlur = await preview.boundingBox();
      await page
        .locator(".ProseMirror p")
        .last()
        .evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          el.closest(".ProseMirror").focus();
        });
      await page.locator(".ProseMirror p").last().scrollIntoViewIfNeeded();
      metrics.selection = await page.evaluate(() => ({
        text: getSelection().toString(),
        rects: Array.from(getSelection().getRangeAt(0).getClientRects()).map(
          (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }),
        ),
        anchorOffset: getSelection().anchorOffset,
        focusOffset: getSelection().focusOffset,
        declaredBackground: getComputedStyle(
          document.querySelector(".ProseMirror p"),
          "::selection",
        ).backgroundColor,
      }));
      await page.screenshot({ path: resolve(output, name + "-selection.png") });
      results.cases.push({ name, ...metrics });
      await context.close();
    }
  const sample = await readFile("fixtures/highlighting-acceptance.md", "utf8");
  const samplePage = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  await samplePage.addInitScript((source) => {
    window.webkit = {
      messageHandlers: {
        ret: {
          postMessage(message) {
            if (message.method === "ready")
              queueMicrotask(() =>
                window.retNative.receive({
                  v: 1,
                  documentId: "sample",
                  epoch: "sample",
                  requestId: "load",
                  method: "load",
                  payload: {
                    source,
                    revision: 0,
                    displayName: "highlighting-acceptance.md",
                    fileURL: null,
                    appearance: "light",
                  },
                }),
              );
          },
        },
      },
    };
  }, sample);
  await samplePage.goto("http://127.0.0.1:4173/");
  await samplePage.locator(".tok-keyword").first().waitFor();
  await samplePage.context().setOffline(true);
  await samplePage.screenshot({
    path: resolve(output, "offline-cpp-js-plaintext.png"),
    fullPage: true,
  });
  const sampleMetrics = await samplePage
    .locator(".literal")
    .evaluateAll((blocks) =>
      blocks.map((el) => ({
        language: el.querySelector(".literal-label").textContent,
        tokens: Array.from(el.querySelectorAll('[class*="tok-"]')).map((t) => ({
          text: t.textContent,
          class: t.className,
          color: getComputedStyle(t).color,
        })),
      })),
    );
  await writeFile(
    resolve(output, "highlight-samples.json"),
    JSON.stringify(
      {
        fixture: "fixtures/highlighting-acceptance.md",
        sha256: createHash("sha256").update(sample).digest("hex"),
        blocks: sampleMetrics,
      },
      null,
      2,
    ) + "\n",
  );
  await samplePage.close();
  await writeFile(
    resolve(output, "measurements.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
