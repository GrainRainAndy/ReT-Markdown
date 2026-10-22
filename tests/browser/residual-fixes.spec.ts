import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

for (const kind of ["link", "math", "language", "find", "replace"] as const) {
  test(`${kind} input owns Undo Redo and format shortcuts, including native commands`, async ({
    page,
  }) => {
    const initial =
      kind === "math"
        ? "$old$"
        : kind === "language"
          ? "```js\nold\n```"
          : "old";
    await load(page, initial);
    if (kind === "math") await command(page, "toggleSource");
    const root = page.locator(
      kind === "math" || kind === "language" ? ".cm-content" : ".ProseMirror",
    );
    await root.click();
    await page.keyboard.press("End");
    if (kind === "math") await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    const before = await source(page);
    // Leave both root Undo and Redo available; neither auxiliary shortcut may
    // consume these document history entries.
    await root.evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "Y");
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe(before);
    const rootHistory = await page.evaluate(
      () =>
        (window as any).hostMessages
          .filter((m: any) => m.method === "commandState")
          .at(-1).payload.enabled,
    );
    expect(rootHistory.undo).toBe(true);
    expect(rootHistory.redo).toBe(true);
    await command(
      page,
      kind === "math"
        ? "inlineMathSource"
        : kind === "language"
          ? "codeLanguage"
          : kind,
    );
    const label = {
      link: "链接地址",
      math: "行内公式源码",
      language: "代码语言",
      find: "查找内容",
      replace: "替换为",
    }[kind];
    const input = page.getByRole("textbox", { name: label, exact: true });
    await input.focus();
    await input.evaluate((el) => (el as HTMLInputElement).select());
    await page.keyboard.type("https://example.com");
    // Key events must reach the input's native history instead of root history.
    for (const key of ["Meta+z", "Meta+Shift+z", "Meta+b"]) {
      await page.keyboard.press(key);
      expect(await source(page)).toBe(before);
      if (key === "Meta+z")
        await expect(input).not.toHaveValue("https://example.com");
      if (key === "Meta+Shift+z")
        await expect(input).toHaveValue("https://example.com");
    }
    const state = () =>
      page.evaluate(
        () =>
          (window as any).hostMessages
            .filter((m: any) => m.method === "commandState")
            .at(-1)?.payload.enabled,
      );
    await expect.poll(async () => (await state())?.undo).toBe(false);
    await expect.poll(async () => (await state())?.redo).toBe(false);
    await expect.poll(async () => (await state())?.bold).toBe(false);
    // Also bypass stale native menu state and deliver commands directly.
    for (const id of ["undo", "redo", "bold"]) {
      await command(page, id);
      expect(await source(page)).toBe(before);
      await expect(input).toBeFocused();
    }
    if (kind === "find" || kind === "replace")
      await page.getByRole("button", { name: "关闭查找" }).click();
    else await page.getByRole("button", { name: "取消", exact: true }).click();
    await root.click();
    await expect.poll(async () => (await state())?.undo).toBe(true);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => source(page)).toBe(initial);
    await command(page, "redo");
    await expect.poll(() => source(page)).toBe(before);
  });
}
