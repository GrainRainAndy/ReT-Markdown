import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

for (const [language, body, keyword] of [
  ["javascript", "const answer = 42; // sample", "const"],
  ["cpp", "int main() { return 42; } // sample", "return"],
] as const)
  test(`${language} tokens are styled offline without editing source`, async ({
    page,
    context,
  }) => {
    await load(page, "```" + language + "\n" + body + "\n```\n\nafter");
    await context.setOffline(true);
    const token = page.locator(".cm-line .tok-keyword", { hasText: keyword });
    await expect(token).toBeVisible();
    expect(await token.evaluate((el) => getComputedStyle(el).color)).not.toBe(
      await page
        .locator(".cm-content")
        .evaluate((el) => getComputedStyle(el).color),
    );
    expect(await source(page)).toBeUndefined();
  });

test("language reconfiguration preserves reverse selection, body and root undo", async ({
  page,
}) => {
  const initial = "```javascript\nconst answer = 42;\n```";
  await load(page, initial);
  const input = page.locator(".cm-content");
  await input.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowLeft");
  await command(page, "codeLanguage");
  await page.getByRole("dialog").getByRole("textbox").fill("unknown-language");
  await page.getByRole("dialog").getByRole("button", { name: "应用" }).click();
  await expect
    .poll(() => source(page))
    .toBe("```unknown-language\nconst answer = 42;\n```");
  await expect(page.locator(".cm-line [class*='tok-']")).toHaveCount(0);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "o",
  );
  await page.keyboard.type("X");
  await expect
    .poll(() => source(page))
    .toBe("```unknown-language\ncXnst answer = 42;\n```");
  await command(page, "undo");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe(initial);
  await expect(page.locator(".tok-keyword")).toHaveText("const");
});

test("valid math folds on blur and restores its bookmark without adding history", async ({
  page,
}) => {
  const initial = "before\n\n$$\nx+y\n$$\n\nafter";
  await load(page, initial);
  const preview = page.locator(".math-preview"),
    input = page.locator(".literal .cm-content");
  await expect(preview).toHaveAttribute("data-render-state", "ready");
  await preview.click();
  await expect(input).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await page.locator(".ProseMirror p").last().click();
  await expect(input).toBeHidden();
  expect(await source(page)).toBeUndefined();
  await preview.click();
  await expect(input).toBeFocused();
  await page.keyboard.type("2");
  await expect.poll(() => source(page)).toBe("before\n\n$$\nx2+y\n$$\n\nafter");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe(initial);
  await command(page, "toggleSource");
  await command(page, "toggleSource");
  await expect(input).toBeFocused();
  await page.keyboard.type("3");
  await expect.poll(() => source(page)).toBe("before\n\n$$\nx3+y\n$$\n\nafter");
});

test("invalid math remains editable after blur and recovery preview never becomes source", async ({
  page,
}) => {
  await load(page, "$$\n\\badcommand\n$$\n\nafter");
  const input = page.locator(".literal .cm-content");
  await expect(page.locator(".math-error")).toBeVisible();
  await input.click();
  await page.locator(".ProseMirror p").click();
  await expect(input).toBeVisible();
  await input.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ControlOrMeta+Shift+End");
  await page.keyboard.type("x+y");
  await expect.poll(() => source(page)).toBe("$$\nx+y\n$$\n\nafter");
  await expect(page.locator(".math-preview .katex")).toBeVisible();
  await page.locator(".ProseMirror p").click();
  await expect(input).toBeHidden();
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("$$\n\\badcommand\n$$\n\nafter");
  await expect(input).toBeVisible();
});

test("math folding waits for active composition and keeps the same source DOM", async ({
  page,
}) => {
  await load(page, "$$\nx\n$$\n\nafter");
  await page.locator(".math-preview").click();
  const input = page.locator(".literal .cm-content");
  await input.evaluate((el) => ((window as any).originalMathInput = el));
  await input.dispatchEvent("compositionstart");
  await page.keyboard.insertText("y");
  await page.locator(".ProseMirror p").click();
  await expect(input).toBeVisible();
  await input.dispatchEvent("compositionend");
  await expect.poll(() => source(page)).toContain("y");
  // Root projection restores the committed literal owner; folding must not
  // hide the newly focused composition target. A subsequent real blur folds.
  await expect(input).toBeFocused();
  await expect(input).toBeVisible();
  await page.locator(".ProseMirror p").click();
  await expect(input).toBeHidden();
  expect(
    await input.evaluate((el) => el === (window as any).originalMathInput),
  ).toBe(true);
});

test("math expansion changes height while keeping the scrolled preview anchor stable", async ({
  page,
}) => {
  await load(
    page,
    "paragraph\n\n".repeat(35) +
      "$$\nx+y\n$$\n\nafter\n\n" +
      "tail\n\n".repeat(20),
  );
  const preview = page.locator(".math-preview"),
    input = page.locator(".literal .cm-content");
  await expect(preview).toHaveAttribute("data-render-state", "ready");
  await expect(input).toBeHidden();
  await preview.scrollIntoViewIfNeeded();
  const folded = await page.locator(".literal").boundingBox();
  const top = (await preview.boundingBox())!.y;
  await preview.click();
  await expect(input).toBeFocused();
  expect(
    (await page.locator(".literal").boundingBox())!.height,
  ).toBeGreaterThan(folded!.height);
  expect(Math.abs((await preview.boundingBox())!.y - top)).toBeLessThan(2);
  await input.evaluate((el) => (el as HTMLElement).blur());
  await expect(input).toBeHidden();
  expect(Math.abs((await preview.boundingBox())!.y - top)).toBeLessThan(2);
  expect(await source(page)).toBeUndefined();
});

test("blur to a following paragraph preserves its visible reading anchor", async ({
  page,
}) => {
  await load(
    page,
    "before\n\n".repeat(35) +
      "$$\nx+y\n$$\n\nafter\n\n" +
      "tail\n\n".repeat(20),
  );
  const preview = page.locator(".math-preview");
  await expect(preview).toHaveAttribute("data-render-state", "ready");
  await preview.scrollIntoViewIfNeeded();
  await preview.click();
  const target = page.locator(".ProseMirror p", { hasText: /^after$/ });
  await target.scrollIntoViewIfNeeded();
  const before = (await target.boundingBox())!.y;
  await target.click();
  await expect(page.locator(".literal .cm-content")).toBeHidden();
  expect(Math.abs((await target.boundingBox())!.y - before)).toBeLessThan(2);
  await page.keyboard.type("!");
  await expect.poll(() => source(page)).toContain("after!");
});

test("host copy command reopens a folded math selection and copies its source", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await load(page, "before\n\n$$\nx+y\n$$\n\nafter");
  await page.locator(".math-preview").click();
  const input = page.locator(".literal .cm-content");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+ArrowRight");
  await page.locator("#mode").focus();
  await expect(input).toBeHidden();
  // Keyboard focus on the preview belongs to Markdown but does not activate
  // its click entry. The host command must use the same activation path.
  await page.locator(".math-preview").focus();
  await expect(input).toBeHidden();
  await command(page, "copyMarkdown");
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("x");
  expect(await source(page)).toBeUndefined();
});
