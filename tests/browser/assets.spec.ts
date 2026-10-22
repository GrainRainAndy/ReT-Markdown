import { test, expect } from "@playwright/test";
import { load } from "./helpers";
test("live missing/remote images display readable paths without fetching remote image", async ({
  page,
}) => {
  let remote = false;
  page.on("request", (r) => {
    if (r.url().startsWith("https://remote.invalid/")) remote = true;
  });
  await load(
    page,
    "![alt](missing%20图.svg)\n\n![remote](https://remote.invalid/pic.png)",
    { assetToken: "test-capability" },
  );
  await expect(page.locator(".image-object").first()).toContainText(
    "missing%20图.svg",
  );
  await expect(page.locator(".image-object").nth(1)).toContainText(
    "https://remote.invalid/pic.png",
  );
  expect(remote).toBe(false);
});
test("native frozen asset manifest excludes code and links and echoes requested revision", async ({
  page,
}) => {
  await load(page, "current");
  await page.evaluate(() => {
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "manifest-N",
      method: "collectAssets",
      payload: {
        source:
          "![frozen](N.assets/图.png)\n\n`![code](ignore.png)`\n\n[link](ignore2.png)",
        revision: 42,
      },
    });
  });
  const manifest = await page.evaluate(() =>
    (window as any).hostMessages.find((m: any) => m.method === "assetManifest"),
  );
  expect(manifest.requestId).toBe("manifest-N");
  expect(manifest.payload).toEqual({
    paths: ["N.assets/图.png"],
    revision: 42,
  });
});
for (const mode of ["rich", "source"])
  test(`image drag in ${mode} uses one import bookmark and preserves special path`, async ({
    page,
  }) => {
    await load(page, "start");
    if (mode === "source")
      await page.getByRole("button", { name: "源码", exact: true }).click();
    const editor = page.locator(
      mode === "rich" ? ".ProseMirror" : ".cm-content",
    );
    await editor.click();
    await editor.evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(["<svg/>"], "图 #%.svg", { type: "image/svg+xml" }),
      );
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: rect.left + 12,
          clientY: rect.top + 12,
        }),
      );
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).hostMessages.filter(
              (m: any) => m.method === "importImage",
            ).length,
        ),
      )
      .toBe(1);
    await page.evaluate(() => {
      const req = (window as any).hostMessages.find(
        (m: any) => m.method === "importImage",
      );
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: req.requestId,
        method: "assetResult",
        payload: { relativePath: "draft.assets/图 #%.svg" },
      });
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).hostMessages
              .filter((m: any) => m.method === "checkpoint")
              .at(-1)?.payload.source,
        ),
      )
      .toContain("draft.assets/%E5%9B%BE%20%23%25.svg");
  });
