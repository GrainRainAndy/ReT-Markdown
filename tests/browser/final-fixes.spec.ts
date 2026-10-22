import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";
for (const mode of ["source", "code", "math"])
  test(`${mode} separates typing, two compositions and paste across root history`, async ({
    page,
  }) => {
    await load(
      page,
      mode === "source" ? "" : mode === "code" ? "```\n\n```" : "$$\n\n$$",
    );
    if (mode === "source") await command(page, "toggleSource");
    const input = page.locator(".cm-content");
    await input.click();
    await page.keyboard.type("A");
    for (const text of ["中文", "测试"]) {
      await input.dispatchEvent("compositionstart");
      await page.keyboard.insertText(text);
      await input.dispatchEvent("compositionend");
      await expect.poll(() => source(page)).toContain(text);
    }
    await command(page, "undo");
    await expect.poll(() => source(page)).not.toContain("测试");
    await expect.poll(() => source(page)).toContain("A中文");
    await command(page, "redo");
    await input.evaluate((el) => {
      const d = new DataTransfer();
      d.setData("text/markdown", "PASTE");
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: d,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.keyboard.type("Z");
    await command(page, "toggleSource");
    await command(page, "undo");
    await expect.poll(() => source(page)).toContain("PASTE");
    await expect.poll(() => source(page)).not.toContain("Z");
    await command(page, "undo");
    await expect.poll(() => source(page)).not.toContain("PASTE");
    await expect.poll(() => source(page)).toContain("A中文测试");
  });

test("reload barrier rejects composition, cancels safely, and accepts only its frozen candidate", async ({
  page,
}) => {
  await load(page, "old");
  const send = (
    method: string,
    id: string,
    payload: any = {},
    epoch = "epoch-a",
  ) =>
    page.evaluate(
      ({ method, id, payload, epoch }) =>
        (window as any).retNative.receive({
          v: 1,
          documentId: "doc-a",
          epoch,
          requestId: id,
          method,
          payload,
        }),
      { method, id, payload, epoch },
    );
  const candidate = {
    epoch: "epoch-b",
    load: { source: "external", savedSource: "external", revision: 0 },
  };
  const editor = page.locator(".ProseMirror");
  await editor.dispatchEvent("compositionstart");
  await send("reloadPrepare", "rejected", candidate);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostMessages.find(
            (m: any) => m.requestId === "rejected",
          )?.payload.status,
      ),
    )
    .toBe("pending");
  await editor.dispatchEvent("compositionend");
  await send("reloadPrepare", "cancelled", candidate);
  await expect(page.locator("#workspace")).toHaveAttribute("inert", "");
  await send("reloadCancel", "cancelled");
  await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
  await send("reloadPrepare", "cancelled", candidate); // delayed request cannot reacquire a cancelled transaction
  await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
  await send("reloadPrepare", "accepted", candidate);
  await send(
    "load",
    "unsolicited",
    { source: "wrong", revision: 0 },
    "epoch-c",
  );
  await send("reloadCommit", "wrong", {}, "epoch-b");
  await expect(editor).toHaveText("old");
  await send("reloadCommit", "accepted", {}, "epoch-b");
  await expect(editor).toHaveText("external");
  await send("reloadCommit", "accepted", {}, "epoch-b"); // lost completion replay
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostMessages.filter(
            (m: any) => m.method === "reloadComplete",
          ).length,
      ),
    )
    .toBe(2);
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect.poll(() => source(page)).toBe("external!");
  await send("flush", "save", {}, "epoch-b");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostMessages.find((m: any) => m.requestId === "save")
            ?.payload.source,
      ),
    )
    .toBe("external!");
});

test("links expose safe native activation without losing caret editing", async ({
  page,
}) => {
  await load(
    page,
    "[direct](https://example.com) [ref][r] <mailto:test@example.com> [bad](javascript:alert)\n\n> [r]: https://example.org",
  );
  const links = page.locator(".ProseMirror a");
  await links.nth(0).click();
  expect(
    await page.evaluate(() =>
      (window as any).hostMessages.filter((m: any) => m.method === "openLink"),
    ),
  ).toHaveLength(0);
  for (const index of [0, 1, 2, 3])
    await links.nth(index).click({ modifiers: ["Meta"] });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).hostMessages
          .filter((m: any) => m.method === "openLink")
          .map((m: any) => m.payload.url),
      ),
    )
    .toEqual([
      "https://example.com",
      "https://example.org",
      "mailto:test@example.com",
    ]);
  expect(page.url()).toBe("http://127.0.0.1:4173/");
  await expect(links.first()).toHaveAttribute("title", /⌘/);
});
test("command state follows history and owner; edit zoom never changes source or export", async ({
  page,
}) => {
  await load(
    page,
    "text\n\n```js\ncode\n```\n\n| A | B |\n| - | - |\n| x | y |",
  );
  const state = () =>
    page.evaluate(
      () =>
        (window as any).hostMessages
          .filter((m: any) => m.method === "commandState")
          .at(-1)?.payload.enabled,
    );
  await expect.poll(async () => (await state())?.undo).toBe(false);
  await page.locator(".ProseMirror p").first().click();
  await expect.poll(async () => (await state())?.codeLanguage).toBe(false);
  await page.locator(".cm-content").click();
  await expect.poll(async () => (await state())?.codeLanguage).toBe(true);
  await expect.poll(async () => (await state())?.bold).toBe(false);
  await page.locator("td").first().click();
  await expect.poll(async () => (await state())?.tableAddRow).toBe(true);
  const before = await page
    .locator("#workspace")
    .evaluate((el) => getComputedStyle(el).fontSize);
  await command(page, "zoomIn");
  expect(
    await page
      .locator("#workspace")
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).not.toBe(before);
  expect(await source(page)).toBeUndefined();
  await command(page, "zoomReset");
  expect(
    await page
      .locator("#workspace")
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe(before);
  await page.keyboard.press("Meta+Shift+m");
  await expect(page.locator('[aria-label="Markdown 源码"]')).toBeVisible();
  await command(page, "strike");
  await expect.poll(() => source(page)).toContain("~~");
  await expect.poll(async () => (await state())?.undo).toBe(true);
});

for (const [key, expected] of [
  ["Alt+Backspace", "hello "],
  ["Meta+Backspace", ""],
] as const)
  test(`${key} deletes the intended word or line in prose`, async ({
    page,
  }) => {
    await load(page, "hello world");
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("End");
    await page.keyboard.press(key);
    await expect.poll(() => source(page)).toBe(expected);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => source(page)).toBe("hello world");
  });
test("fence-growing paste keeps code ownership and one-step root undo", async ({
  page,
}) => {
  await load(page, "> ~~~js\r\n> a\r\n> b\r\n> ~~~");
  const input = page.locator(".cm-content");
  await input.click();
  await page.keyboard.press("Home");
  await input.evaluate((el) => {
    const d = new DataTransfer();
    d.setData("text/plain", "~~~\n~~~~~~\n");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: d,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => source(page)).toContain("~~~~~~~js");
  await expect(page.locator(".literal")).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  await expect.poll(() => source(page)).toBe("> ~~~js\r\n> a\r\n> b\r\n> ~~~");
});
test("source toggle permits source formatting immediately after a literal owner", async ({
  page,
}) => {
  await load(page, "```\ncode\n```");
  await page.locator(".cm-content").click();
  await command(page, "toggleSource");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostMessages
            .filter((m: any) => m.method === "commandState")
            .at(-1)?.payload.enabled.bold,
      ),
    )
    .toBe(true);
  await command(page, "bold");
  await expect.poll(() => source(page)).toContain("**");
});
