import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

test.afterEach(async ({ page }, info) => {
  const directory = process.env.RET_ACCEPTANCE_EVIDENCE;
  if (!directory || info.status !== "passed") return;
  await mkdir(directory, { recursive: true });
  const name =
    info.title.replace(/[^a-zA-Z0-9]+/g, "-") +
    createHash("sha256").update(info.title).digest("hex").slice(0, 8);
  await page.screenshot({ path: join(directory, name + ".png") });
  await writeFile(
    join(directory, name + ".json"),
    JSON.stringify(
      await page.evaluate(() => ({
        messages: (window as any).hostMessages,
        activeElement: document.activeElement?.outerHTML,
        content: document.querySelector(".ProseMirror")?.innerHTML,
      })),
      null,
      2,
    ),
  );
});
for (const opening of ["```", "```js", "~~~", "~~~js"])
  test(`typed ${opening} transfers focus and retains history`, async ({
    page,
  }) => {
    await load(page, "");
    await page.locator(".ProseMirror").click();
    await page.keyboard.type(opening);
    await page.keyboard.press("Enter");
    await expect(page.locator(".literal .cm-content")).toBeFocused();
    await page.keyboard.type("xhello");
    await expect.poll(() => source(page)).toBe(opening + "\nxhello");
    await expect(
      page.getByRole("dialog", { name: "恢复未提交输入" }),
    ).toHaveCount(0);
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe(opening + "\n");
    await command(page, "redo");
    await expect.poll(() => source(page)).toBe(opening + "\nxhello");
    await command(page, "toggleSource");
    await expect(page.locator(".source-surface .cm-content")).toHaveText(
      opening + "xhello",
    );
    await command(page, "toggleSource");
    await expect(page.locator(".literal .cm-content")).toBeFocused();
    await page.keyboard.type("!");
    await expect.poll(() => source(page)).toBe(opening + "\nxhello!");
  });
for (const initial of [
  "```js",
  "> ```\n> ```",
  "- ```\n  ```",
  "$$",
  "> $$\r\n> $$",
])
  test(`empty literal edits without recovery ${JSON.stringify(initial)}`, async ({
    page,
  }) => {
    await load(page, initial);
    await page.locator(".literal .cm-content").click();
    await page.keyboard.type("x");
    await expect.poll(() => source(page)).toContain("x");
    await expect(
      page.getByRole("dialog", { name: "恢复未提交输入" }),
    ).toHaveCount(0);
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe(initial);
    await command(page, "redo");
    await expect.poll(() => source(page)).toContain("x");
  });
test("ragged table virtual cells navigate and materialize only through edited column", async ({
  page,
}) => {
  const initial = "| A | B | C |\n|---|---|---|\n| one |";
  await load(page, initial);
  const cells = page.locator("td");
  await expect(cells).toHaveCount(3);
  await cells.nth(0).click();
  await page.keyboard.press("Tab");
  expect(await source(page)).toBeUndefined();
  await page.keyboard.type("two");
  await expect.poll(() => source(page)).toBe(initial + " two |");
  await page.keyboard.press("Tab");
  await page.keyboard.type("three");
  await expect.poll(() => source(page)).toBe(initial + " two | three |");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe(initial + " two |");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe(initial);
  await cells.nth(2).click();
  await page.keyboard.type("last");
  await expect.poll(() => source(page)).toBe(initial + "  | last |");
});
test("command clicking linked image routes through the existing bridge", async ({
  page,
}) => {
  await load(
    page,
    "[![logo](https://invalid.test/logo.png)](https://example.com)",
  );
  await page.locator(".image-object").click({ modifiers: ["Meta"] });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).hostMessages
          .filter((m: any) => m.method === "openLink")
          .map((m: any) => m.payload.url),
      ),
    )
    .toEqual(["https://example.com"]);
});
test("source mode caret on an empty opening fence enters its valid body anchor", async ({
  page,
}) => {
  await load(page, "> ```js");
  await command(page, "toggleSource");
  await page.locator(".source-surface .cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await command(page, "toggleSource");
  await expect(page.locator(".literal .cm-content")).toBeFocused();
  await page.keyboard.type("x");
  await expect.poll(() => source(page)).toBe("> ```js\n> x");
  await expect(
    page.getByRole("dialog", { name: "恢复未提交输入" }),
  ).toHaveCount(0);
});
test("ragged table Enter navigation and paste retain surplus source cells", async ({
  page,
}) => {
  const initial = "| A | B | C |\n|---|---|---|\n| one\n| a | b | c | hidden |";
  await load(page, initial);
  await page.locator("th").nth(2).click();
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "x|y\nz");
    document.querySelector(".ProseMirror")!.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect
    .poll(() => source(page))
    .toBe(
      "| A | B | C |\n|---|---|---|\n| one |  | x\\|y z |\n| a | b | c | hidden |",
    );
  await expect(page.locator("td")).toHaveCount(6);
  await expect(page.locator(".ProseMirror")).not.toContainText("hidden");
  await page.keyboard.press("Enter");
  await page.keyboard.type("!");
  await expect.poll(() => source(page)).toContain("| a | b | !c | hidden |");
});
test("empty virtual cell deletion preserves source and selected-cell commands keep column identity", async ({
  page,
}) => {
  const initial = "| A | B | C |\n|---|---|---|\n| one |";
  await load(page, initial);
  await page.locator("td").nth(2).click();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  expect(await source(page)).toBeUndefined();
  await command(page, "tableSelectCells");
  await command(page, "tableDeleteColumn");
  await expect
    .poll(() => source(page))
    .toBe("| A | B |\n| --- | --- |\n| one |  |");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe(initial);
});
test("selection from a real cell into a missing cell remains a source range", async ({
  page,
}) => {
  await load(page, "| A | B | C |\n|---|---|---|\n| one |");
  await page.locator("td").first().click();
  await page.evaluate(() => {
    const cells = document.querySelectorAll("td");
    window
      .getSelection()!
      .setBaseAndExtent(cells[0]!.firstChild!, 0, cells[2]!, 0);
    const data = new DataTransfer();
    data.setData("text/plain", "X");
    document.querySelector(".ProseMirror")!.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  await expect
    .poll(() => source(page))
    .toBe("| A | B | C |\n|---|---|---|\n| X");
});
for (const slashes of [1, 2, 3, 4])
  for (const column of [1, 2])
    test(`virtual column ${column} preserves trailing escape parity ${slashes}`, async ({
      page,
    }) => {
      const initial =
        "| A | B | C |\n|---|---|---|\n| one " + "\\".repeat(slashes) + "|";
      await load(page, initial);
      await page.locator("td").nth(column).click();
      await page.keyboard.type("X");
      const edited =
        initial + (slashes % 2 ? " |" : "") + "  |".repeat(column - 1) + " X |";
      await expect.poll(() => source(page)).toBe(edited);
      await expect(page.locator("td").nth(column)).toHaveText("X");
      await command(page, "undo");
      await expect.poll(() => source(page)).toBe(initial);
      await command(page, "redo");
      await expect(page.locator("td").nth(column)).toHaveText("X");
      await expect.poll(() => source(page)).toBe(edited);
    });
for (const eol of ["\n", "\r\n"])
  test(`empty quote literal keeps following paragraph separate ${JSON.stringify(eol)}`, async ({
    page,
  }) => {
    const initial = "> ```" + eol + "outside";
    await load(page, initial);
    await page.locator(".literal .cm-content").click();
    await page.keyboard.type("x");
    await expect
      .poll(() => source(page))
      .toBe("> ```" + eol + "> x" + eol + "outside");
    await expect(page.locator(".ProseMirror > p")).toHaveText("outside");
    await expect(
      page.getByRole("dialog", { name: "恢复未提交输入" }),
    ).toHaveCount(0);
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe(initial);
  });
