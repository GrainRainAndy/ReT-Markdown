import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

test("composition retains the active formatted DOM and commits once before continued typing", async ({
  page,
}) => {
  await load(page, "**中文**\n\nkeep");
  const prose = page.locator(".ProseMirror");
  await page.locator(".ProseMirror strong").click();
  await expect(page.locator(".syntax-marker")).toHaveCount(2);
  await page.locator(".ProseMirror strong").evaluate((el) => {
    window
      .getSelection()!
      .setBaseAndExtent(el.firstChild!, 1, el.firstChild!, 1);
    (window as any).activeFormat = el;
  });
  await prose.dispatchEvent("compositionstart");
  await page.keyboard.insertText("你");
  expect(await source(page)).toBeUndefined();
  expect(
    await page.evaluate(() => (window as any).activeFormat.isConnected),
  ).toBe(true);
  await expect(page.locator(".syntax-marker")).toHaveCount(2);
  await prose.dispatchEvent("compositionend");
  await expect.poll(() => source(page)).toBe("**中你文**\n\nkeep");
  await page.keyboard.type("X");
  await expect.poll(() => source(page)).toBe("**中你X文**\n\nkeep");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("**中你文**\n\nkeep");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("**中文**\n\nkeep");
});

test("reverse drag freezes presentation and preserves exact selected bytes on release", async ({
  page,
}) => {
  await load(page, "**bold**\n\nplain");
  const prose = page.locator(".ProseMirror");
  await page.locator(".ProseMirror p").last().click();
  await prose.dispatchEvent("mousedown");
  await prose.evaluate((el) => {
    const bold = el.querySelector("strong")!.firstChild!,
      plain = el.querySelector("p:last-child")!.firstChild!;
    window.getSelection()!.setBaseAndExtent(plain, 3, bold, 2);
  });
  await expect(page.locator(".syntax-marker")).toHaveCount(0);
  await prose.dispatchEvent("mouseup");
  await expect(page.locator(".syntax-marker")).toHaveCount(2);
  expect(
    await page.evaluate(() => window.getSelection()!.toString()),
  ).toContain("ld**");
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("**boin");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("**bold**\n\nplain");
});

test("nested active formats reveal editable delimiters without changing content or neighbors", async ({
  page,
}) => {
  await load(page, "**a *b* c** and *other*\n\nplain");
  await page.locator(".ProseMirror em").first().click();
  await expect(page.locator(".syntax-marker")).toHaveText([
    "**",
    "*",
    "*",
    "**",
  ]);
  await expect(page.locator(".ProseMirror strong em")).toHaveText("b");
  await expect(page.locator(".ProseMirror em").last()).toHaveText("other");
  expect(await source(page)).toBeUndefined();
  await page.locator(".ProseMirror p").last().click();
  await expect(page.locator(".syntax-marker")).toHaveCount(0);
  expect(await source(page)).toBeUndefined();
});

test("one revealed delimiter can be deleted and restored through root history", async ({
  page,
}) => {
  await load(page, "**bold**\n\nkeep");
  await page.locator(".ProseMirror strong").click();
  await expect(page.locator(".syntax-marker")).toHaveCount(2);
  await page
    .locator(".syntax-marker")
    .first()
    .evaluate((el) => {
      window
        .getSelection()!
        .setBaseAndExtent(el.firstChild!, 0, el.firstChild!, 1);
    });
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("*bold**\n\nkeep");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("**bold**\n\nkeep");
  await command(page, "redo");
  await expect.poll(() => source(page)).toBe("*bold**\n\nkeep");
});

test("revealed marker copy is exact while complete content cut retains Markdown", async ({
  page,
}) => {
  await load(page, "**bold**");
  await page.locator(".ProseMirror strong").click();
  await expect(page.locator(".syntax-marker")).toHaveCount(2);
  const copy = await page
    .locator(".syntax-marker")
    .first()
    .evaluate((el) => {
      window
        .getSelection()!
        .setBaseAndExtent(el.firstChild!, 0, el.firstChild!, 1);
      const data = new DataTransfer();
      el.dispatchEvent(
        new ClipboardEvent("copy", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      return data.getData("text/plain");
    });
  expect(copy).toBe("*");
  const cut = await page.locator(".ProseMirror strong").evaluate((el) => {
    window
      .getSelection()!
      .setBaseAndExtent(el.firstChild!, 0, el.firstChild!, 4);
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("cut", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return data.getData("text/plain");
  });
  expect(cut).toBe("**bold**");
  await expect.poll(() => source(page)).toBe("");
});
