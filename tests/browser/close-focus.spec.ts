import { test, expect, type Page } from "@playwright/test";
import { load, command, source } from "./helpers";

async function bridge(page: Page, method: string, payload = {}) {
  await page.evaluate(
    ({ method, payload }) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: `focus-${method}`,
        method,
        payload,
      }),
    { method, payload },
  );
}

// Focus restoration is a prerequisite for the next native compositionstart to
// reach its editor. These browser tests do not substitute for real macOS IME QA.
for (const mode of ["prose", "code", "math", "source"] as const) {
  test(`cancel close restores ${mode} input without another click`, async ({
    page,
  }) => {
    const initial =
      mode === "code"
        ? "```\nbase\n```"
        : mode === "math"
          ? "$$\nx\n$$"
          : "base";
    await load(page, initial);
    if (mode === "source") await command(page, "toggleSource");
    if (mode === "math") await page.locator(".math-preview").click();
    const input = page.locator(
      mode === "prose" ? ".ProseMirror" : ".cm-content",
    );
    await input.click();
    for (let i = 0; i < initial.length; i++)
      await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() => page.evaluate(() => getSelection()?.focusOffset))
      .toBe(0);
    await bridge(page, "flush", { holdInput: true });
    await expect(page.locator("#workspace")).toHaveJSProperty("inert", true);
    await bridge(page, "flush", { holdInput: true });
    await bridge(page, "flushRelease");
    await expect(input).toBeFocused();
    await page.keyboard.insertText("Z");
    const expected =
      mode === "code"
        ? "```\nZbase\n```"
        : mode === "math"
          ? "$$\nZx\n$$"
          : "Zbase";
    await expect.poll(() => source(page)).toBe(expected);
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe(initial);
  });
}

test("release without an acquired hold preserves another focused control", async ({
  page,
}) => {
  await load(page, "base");
  await page.locator("#mode").focus();
  await bridge(page, "flushRelease");
  await expect(page.locator("#mode")).toBeFocused();
  expect(await source(page)).toBeUndefined();
});

test("close hold preserves a focused non-editor control on cancellation", async ({
  page,
}) => {
  await load(page, "base");
  await page.locator("#mode").focus();
  await bridge(page, "flush", { holdInput: true });
  await bridge(page, "flushRelease");
  await expect(page.locator("#mode")).toBeFocused();
  expect(await source(page)).toBeUndefined();
});

test("release while composition is pending keeps the composing editor intact", async ({
  page,
}) => {
  await load(page, "base");
  const prose = page.locator(".ProseMirror");
  await prose.click();
  await prose.dispatchEvent("compositionstart");
  await bridge(page, "flush", { holdInput: true });
  await bridge(page, "flushRelease");
  await expect(prose).toBeFocused();
  await expect(page.locator("#status")).toContainText("正在输入");
  await expect(page.locator("#workspace")).toHaveJSProperty("inert", false);
  expect(await source(page)).toBeUndefined();
  await prose.dispatchEvent("compositionend");
});

test("close release cannot unlock an external replacement", async ({
  page,
}) => {
  await load(page, "base");
  await page.locator(".ProseMirror").click();
  await bridge(page, "reloadPrepare", {
    epoch: "epoch-b",
    load: { source: "external", revision: 0 },
  });
  await bridge(page, "flush", { holdInput: true });
  await bridge(page, "flushRelease");
  await expect(page.locator("#workspace")).toHaveJSProperty("inert", true);
  await expect(page.locator(".ProseMirror")).not.toBeFocused();
  expect(await source(page)).toBeUndefined();
});

test("close release leaves recovery input blocked", async ({ page }) => {
  await load(page, "base", {
    recoveryDraft: {
      baseRevision: 7,
      owner: "prose",
      format: "text",
      content: "recovered",
      recoverySource: "recovered",
      reason: "conversion failed",
    },
  });
  await bridge(page, "flush", { holdInput: true });
  await bridge(page, "flushRelease");
  await expect(
    page.getByRole("dialog", { name: "恢复未提交输入" }),
  ).toBeVisible();
  await expect(page.locator("#workspace")).toHaveJSProperty("inert", true);
  await expect(page.locator(".ProseMirror")).not.toBeFocused();
  expect(await source(page)).toBeUndefined();
});
