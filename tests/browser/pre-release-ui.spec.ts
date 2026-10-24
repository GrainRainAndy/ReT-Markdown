import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

for (const appearance of ["dark", "system", "light"]) {
  test(`source caret follows ${appearance} appearance`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await load(page, "中文 caret", { appearance });
    await command(page, "toggleSource");
    const cm = page.locator(".source-surface .cm-content");
    await cm.click();
    const colors = await cm.evaluate((el) => ({
      caret: getComputedStyle(el).caretColor,
      text: getComputedStyle(document.body).color,
    }));
    expect(colors.caret).toBe(colors.text);
    expect(await source(page)).toBeUndefined();
  });
}
test("source shortcut and footer hint share the command definition", async ({
  page,
}) => {
  await load(page, "**keep**");
  await page.locator(".ProseMirror").focus();
  await expect(page.locator("#mode")).toHaveAttribute(
    "title",
    "切换源码（⌘/）",
  );
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".source-surface")).toBeVisible();
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".rich-surface")).toBeVisible();
  expect(await source(page)).toBeUndefined();
});
test("macOS control strike and option list shortcuts execute only their own command", async ({
  page,
}) => {
  await load(page, "word");
  const prose = page.locator(".ProseMirror");
  await prose.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Control+Shift+Backquote");
  await expect.poll(() => source(page)).toBe("~~word~~");
  await command(page, "undo");
  await page.keyboard.press("Meta+Shift+Backquote");
  await expect.poll(() => source(page)).toBe("`word`");
  await command(page, "undo");
  await page.keyboard.press("Meta+Alt+u");
  await expect(page.locator(".ProseMirror ul li")).toHaveCount(1);
  await command(page, "undo");
  await page.keyboard.press("Meta+h");
  await expect(page.getByLabel("替换为")).toBeVisible();
});
test("footer shows only save state and count and ignores recovery acknowledgements", async ({
  page,
}) => {
  await load(page, "A");
  await expect(page.locator("#status")).toHaveText("已保存基线 · 1 字符");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("End");
  await page.keyboard.type("B");
  await expect(page.locator("#status")).toHaveText("未保存 · 2 字符");
  await page.evaluate(() => {
    const send = (method: string, payload: unknown) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: method,
        method,
        payload,
      });
    send("checkpointAck", { revision: 8, stage: "durable" });
    send("saved", { revision: 7, source: "A" });
  });
  await expect(page.locator("#status")).toHaveText("未保存 · 2 字符");
});
