import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

test("trailing spaces have distinct caret positions and survive editing and mode switches", async ({
  page,
}) => {
  await load(page, "A");
  await page.locator(".ProseMirror p").click();
  await page.keyboard.press("End");
  const positions: number[] = [];
  const caret = () =>
    page.evaluate(() => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.setStart(selection.focusNode!, selection.focusOffset);
      range.collapse(true);
      return range.getBoundingClientRect().left;
    });
  positions.push(await caret());
  for (let i = 0; i < 3; i++) {
    await page.keyboard.type(" ");
    positions.push(await caret());
  }
  for (let i = 1; i < positions.length; i++)
    expect(positions[i]! - positions[i - 1]!).toBeGreaterThan(1);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("B");
  await expect.poll(() => source(page)).toBe("A  B");
  await command(page, "toggleSource");
  await command(page, "toggleSource");
  await expect(page.locator(".ProseMirror p")).toHaveText("A  B");
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("A  B");
});

test("bare heading marker stays prose until whitespace and never flashes for #x", async ({
  page,
}) => {
  await load(page, "");
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("#");
  await expect(page.locator(".ProseMirror h1")).toHaveCount(0);
  await expect(page.locator(".ProseMirror p")).toHaveText("#");
  await page.keyboard.type("x");
  await expect.poll(() => source(page)).toBe("#x");
  await expect(page.locator(".ProseMirror h1")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(" 标题");
  await expect(page.locator(".ProseMirror h1")).toHaveText("标题");
  await expect.poll(() => source(page)).toBe("# 标题");
  await command(page, "undo");
  await command(page, "redo");
  await expect.poll(() => source(page)).toBe("# 标题");
});

for (const marker of ["##", "######", "#######"]) {
  test(`heading threshold and separator deletion for ${marker}`, async ({
    page,
  }) => {
    await load(page, "");
    await page.locator(".ProseMirror").click();
    await page.keyboard.type(marker);
    await expect(page.locator(".ProseMirror p")).toHaveText(marker);
    await page.keyboard.type(" ");
    if (marker.length < 7) {
      await expect(page.locator(`.ProseMirror h${marker.length}`)).toHaveCount(
        1,
      );
      await page.keyboard.press("Backspace");
      await expect(page.locator(".ProseMirror p")).toHaveText(marker);
      await page.keyboard.type(" x");
      await expect(page.locator(`.ProseMirror h${marker.length}`)).toHaveText(
        "x",
      );
    } else
      await expect(page.locator(".ProseMirror p")).toHaveText(marker + " ");
  });
}

test("pasted bare heading uses file semantics instead of the typing transition", async ({
  page,
}) => {
  await load(page, "");
  const prose = page.locator(".ProseMirror");
  await prose.click();
  await prose.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "#");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".ProseMirror h1")).toHaveCount(1);
  await expect.poll(() => source(page)).toBe("#");
});

test("empty list continuation owns a new line and Backspace removes the hard break", async ({
  page,
}) => {
  await load(page, "* item");
  await page.locator(".ProseMirror li p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await expect.poll(() => source(page)).toBe("* item  \n  ");
  await expect(page.locator(".ProseMirror li p br")).toHaveCount(2);
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("* item");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("* item  \n  ");
  await page.keyboard.type("next");
  await expect.poll(() => source(page)).toBe("* item  \n  next");
});
