import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";
test("list Tab moves selected item with its subtree and Shift Tab reverses it", async ({
  page,
}) => {
  await load(page, "* A\n* B\n  * C\n\nkeep");
  await page.locator(".ProseMirror li p").filter({ hasText: /^B$/ }).click();
  await page.keyboard.press("Tab");
  await expect.poll(() => source(page)).toBe("* A\n  * B\n    * C\n\nkeep");
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => source(page)).toBe("* A\n* B\n  * C\n\nkeep");
});
test("table navigation, literal escaping and structural commands share root undo", async ({
  page,
}) => {
  await load(page, "| H | J |\n|---|---|\n| a | b |");
  await page.locator(".ProseMirror td").first().click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.type("|\\");
  await expect
    .poll(() => source(page))
    .toBe("| H | J |\n|---|---|\n| a\\|\\\\ | b |");
  await page.keyboard.press("Tab");
  await page.keyboard.type("中");
  await expect
    .poll(() => source(page))
    .toBe("| H | J |\n|---|---|\n| a\\|\\\\ | 中b |");
  await page.keyboard.press("Shift+Enter");
  await expect(page.getByRole("alert")).toContainText("不支持换行");
  await command(page, "tableAddRow");
  await expect(page.locator(".ProseMirror tr")).toHaveCount(3);
  await command(page, "undo");
  await expect(page.locator(".ProseMirror tr")).toHaveCount(2);
});
test("find searches hidden syntax and replace all is one root history transaction", async ({
  page,
}) => {
  await load(page, "**one** and **two**");
  await command(page, "replace");
  await page.getByLabel("查找内容", { exact: true }).fill("**");
  await page.getByLabel("替换为", { exact: true }).fill("__");
  await expect(page.getByLabel("匹配数量")).toHaveText("4 处匹配");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect.poll(() => source(page)).toBe("__one__ and __two__");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("**one** and **two**");
});
test("full and partial formatted cut produce structural versus text payloads", async ({
  page,
}) => {
  await load(page, "**bold**");
  const full = await page.locator(".ProseMirror strong").evaluate((el) => {
    const t = el.firstChild!;
    const s = window.getSelection()!;
    s.setBaseAndExtent(t, 0, t, 4);
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
  expect(full).toBe("**bold**");
  await expect.poll(() => source(page)).toBe("");
  await command(page, "undo");
  const partial = await page.locator(".ProseMirror strong").evaluate((el) => {
    const t = el.firstChild!;
    window.getSelection()!.setBaseAndExtent(t, 1, t, 3);
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
  expect(partial).toBe("ol");
  await expect.poll(() => source(page)).toBe("**bd**");
});
test("math renders safely and entering its source restores a deterministic bookmark", async ({
  page,
}) => {
  await load(page, "before\n\n$$\n\\frac{1}{2}\n$$\n\nafter");
  await expect(page.locator(".math-preview .katex")).toBeVisible();
  await page.locator(".math-preview").click();
  const cm = page.getByLabel("公式源码", { exact: true });
  await expect(cm).toBeFocused();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- x");
  await expect
    .poll(() => source(page))
    .toBe("before\n\n$$\n\\frac{1}{2}\n\n- x\n$$\n\nafter");
});
test("table paste flattens text and rectangle copy retains generated header semantics", async ({
  page,
}) => {
  await load(page, "| H | J |\n|---|---|\n| a | b |\n| c | d |");
  const cell = page.locator(".ProseMirror td").first();
  await cell.click();
  await cell.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "甲\t乙\n丙");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => source(page)).toContain("甲 乙 丙");
  await command(page, "tableSelectCells");
  await page.keyboard.press("Shift+ArrowDown");
  const payload = await page.locator(".ProseMirror").evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return {
      text: data.getData("text/plain"),
      markdown: data.getData("text/markdown"),
    };
  });
  expect(payload.text).toContain("\nc");
  expect(payload.markdown.startsWith("|  |\n| --- |\n")).toBe(true);
});
test("table boundary navigation creates only necessary paragraphs and undo restores table", async ({
  page,
}) => {
  const original = "| H | J |\n|---|---|\n| a | b |";
  await load(page, original);
  await page.locator(".ProseMirror td").last().click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("after");
  await expect.poll(() => source(page)).toBe(original + "\n\nafter");
  await command(page, "undo");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe(original);
  await page.locator(".ProseMirror th").first().click();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.type("before");
  await expect.poll(() => source(page)).toBe("before\n\n" + original);
});
test("empty cells insert inside delimiters and table Enter stays in same column", async ({
  page,
}) => {
  await load(page, "| H | J |\n|---|---|\n|  | b |\n| c | d |");
  await page.locator(".ProseMirror td").first().click();
  await page.keyboard.type("🙂|");
  await expect
    .poll(() => source(page))
    .toBe("| H | J |\n|---|---|\n|  🙂\\|| b |\n| c | d |");
  await page.keyboard.press("Enter");
  await page.keyboard.type("中");
  await expect.poll(() => source(page)).toContain("| 中c | d |");
});
test("grapheme deletion and repeated empty Enter preserve exact root history", async ({
  page,
}) => {
  await load(page, "A👨‍👩‍👧‍👦é");
  await page.locator(".ProseMirror p").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("A👨‍👩‍👧‍👦");
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("A");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await expect.poll(() => source(page)).toBe("A\n\n\n\nx");
});
test("composition holds active DOM and commits one root edit after input ends", async ({
  page,
}) => {
  await load(page, "before");
  const prose = page.locator(".ProseMirror");
  await prose.click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await prose.evaluate((el) => ((window as any).composingDOM = el));
  await prose.dispatchEvent("compositionstart", { data: "中" });
  await page.keyboard.insertText("中文");
  expect(await source(page)).toBeUndefined();
  await prose.dispatchEvent("compositionend", { data: "中文" });
  await expect.poll(() => source(page)).toBe("before中文");
  expect(
    await prose.evaluate((el) => el === (window as any).composingDOM),
  ).toBe(true);
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("before");
});
test("nested code keeps quote prefixes, language changes only info and empty fences undo", async ({
  page,
}) => {
  await load(page, "> ~~~js meta\n> x\n> ~~~");
  const code = page.locator(".literal .cm-content");
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("y");
  await expect.poll(() => source(page)).toBe("> ~~~js meta\n> x\n> y\n> ~~~");
  await command(page, "codeLanguage");
  await page.getByLabel("代码语言", { exact: true }).fill("unknown");
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect
    .poll(() => source(page))
    .toBe("> ~~~unknown meta\n> x\n> y\n> ~~~");
});
test("image callbacks are cancellable by undo and flushed close, mixed clipboard favors text", async ({
  page,
}) => {
  await load(page, "A");
  await page.locator(".ProseMirror p").click();
  await command(page, "insertImage");
  const request = await page.evaluate(
    () =>
      (window as any).hostMessages.find((m: any) => m.method === "importImage")
        .requestId,
  );
  await command(page, "undo");
  await page.evaluate(
    (request) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: request,
        method: "assetResult",
        payload: { relativePath: "assets/p.png", requestId: request },
      }),
    request,
  );
  expect(await source(page)).toBeUndefined();
  await command(page, "insertImage");
  const second = await page.evaluate(
    () =>
      (window as any).hostMessages
        .filter((m: any) => m.method === "importImage")
        .at(-1).requestId,
  );
  await page.evaluate(
    (request) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: request,
        method: "assetResult",
        payload: { relativePath: "assets/中文.png", requestId: request },
      }),
    second,
  );
  await expect
    .poll(() => source(page))
    .toContain("![图片](assets/%E4%B8%AD%E6%96%87.png)");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("A");
});
test("empty list and quote entries have editable positions and exit one level", async ({
  page,
}) => {
  await load(page, "* item");
  await page.locator(".ProseMirror li p").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Enter");
  await expect.poll(() => source(page)).toBe("* item\n* ");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await expect.poll(() => source(page)).toBe("* item\n\nx");
});
test("closed literal exit and empty literal conversion preserve root undo and focus", async ({
  page,
}) => {
  await load(page, "~~~lang\n~~~");
  const code = page.locator(".literal .cm-content");
  await code.click();
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("~~~lang\n~~~");
  await expect(code).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.type("after");
  await expect.poll(() => source(page)).toBe("~~~lang\n~~~\n\nafter");
});
test("literal boundary arrows transfer owner without editing and Shift extends source selection", async ({
  page,
}) => {
  await load(page, "before\n\n~~~\nx\n~~~\n\nafter");
  const code = page.locator(".literal .cm-content");
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+ArrowRight");
  const payload = await page.locator(".ProseMirror").evaluate((el) => {
    const d = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: d,
        bubbles: true,
        cancelable: true,
      }),
    );
    return d.getData("text/plain");
  });
  expect(payload).toBe("~~~\n\n");
  expect(await source(page)).toBeUndefined();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("Y");
  await expect.poll(() => source(page)).toContain("Yafter");
});
test("source mode unclosed syntax remains exact after rich reentry and literal editing", async ({
  page,
}) => {
  await load(page, "start");
  await command(page, "toggleSource");
  await page.locator(".source-surface .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("$$\n- x");
  await command(page, "toggleSource");
  const math = page.getByLabel("公式源码", { exact: true });
  await math.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y");
  await expect.poll(() => source(page)).toBe("$$\n- x\ny");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(() => source(page)).toBe("$$\n- x\ny");
});
test("literal composition commit refreshes mapping before continued typing", async ({
  page,
}) => {
  await load(page, "~~~\nx\n~~~");
  const cm = page.locator(".literal .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await cm.dispatchEvent("compositionstart", { data: "中" });
  await page.keyboard.insertText("中文");
  expect(await source(page)).toBeUndefined();
  await cm.dispatchEvent("compositionend", { data: "中文" });
  await expect.poll(() => source(page)).toBe("~~~\n中文x\n~~~");
  await page.keyboard.type("Y");
  await expect.poll(() => source(page)).toBe("~~~\n中文Yx\n~~~");
});
