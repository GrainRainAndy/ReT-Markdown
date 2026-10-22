import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

async function selectText(
  page: any,
  selector: string,
  anchor: number,
  head: number,
) {
  await page
    .locator(selector)
    .first()
    .evaluate(
      (el: HTMLElement, range: number[]) => {
        el.closest<HTMLElement>(".ProseMirror")!.focus();
        window
          .getSelection()!
          .setBaseAndExtent(
            el.firstChild!,
            range[0]!,
            el.firstChild!,
            range[1]!,
          );
      },
      [anchor, head],
    );
}

test("complete formatted selection deletes delimiters and partial deletion preserves them", async ({
  page,
}) => {
  await load(page, "**bold**");
  await selectText(page, ".ProseMirror strong", 4, 0);
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("");
  await command(page, "undo");
  await selectText(page, ".ProseMirror strong", 1, 3);
  await page.keyboard.press("Delete");
  await expect.poll(() => source(page)).toBe("**bd**");
});

test("empty quote exits create an editable paragraph outside the quote", async ({
  page,
}) => {
  await load(page, "> a");
  await page.locator(".ProseMirror blockquote p").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await expect.poll(() => source(page)).toBe("> a\n\nx");
  await expect(page.locator(".ProseMirror > p")).toHaveText("x");
});

test("ATX and Setext heading splits retain only the first heading", async ({
  page,
}) => {
  await load(page, "Title\n=====  \n\nkeep");
  await selectText(page, ".ProseMirror h1", 2, 2);
  await page.keyboard.press("Enter");
  await expect.poll(() => source(page)).toBe("Ti\n=====  \n\ntle\n\nkeep");
  await expect(page.locator(".ProseMirror h1")).toHaveText("Ti");
  await command(page, "undo");
  await command(page, "heading3");
  await selectText(page, ".ProseMirror h3", 2, 2);
  await page.keyboard.press("Enter");
  await expect.poll(() => source(page)).toBe("### Ti\n\ntle\n\nkeep");
});

test("Shift literal exit keeps a noncollapsed browser selection in either direction", async ({
  page,
}) => {
  await load(page, "before\n\n~~~\nx\n~~~\n\nafter");
  await page.locator(".literal .cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+ArrowRight");
  expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(
    false,
  );
  await page.keyboard.press("ArrowLeft");
  await page.locator(".literal .cm-content").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(
    false,
  );
});

test("source paste prefers Markdown and rich-text-only paste remains plain", async ({
  page,
}) => {
  await load(page, "");
  await command(page, "toggleSource");
  const cm = page.locator(".source-surface .cm-content");
  await cm.click();
  await cm.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/markdown", "**raw**");
    data.setData("text/plain", "raw");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => source(page)).toBe("**raw**");
});

test("ordered task continuation uses next number and a fresh unchecked marker", async ({
  page,
}) => {
  await load(page, "9. [x] done");
  await page.locator(".ProseMirror li p").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.type("next");
  await expect.poll(() => source(page)).toBe("9. [x] done\n10. [ ] next");
  await command(page, "undo");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("9. [x] done");
});

test("plain and rich copy commands use independent safe payloads", async ({
  page,
}) => {
  await load(page, "**bold**");
  await selectText(page, ".ProseMirror strong", 0, 4);
  await page.evaluate(() => {
    document.addEventListener("copy", (e) => {
      (window as any).copyPayload = {
        plain: e.clipboardData?.getData("text/plain"),
        markdown: e.clipboardData?.getData("text/markdown"),
        html: e.clipboardData?.getData("text/html"),
      };
    });
  });
  await command(page, "copyPlain");
  await expect
    .poll(() => page.evaluate(() => (window as any).copyPayload?.plain))
    .toBe("bold");
  await command(page, "copyRich");
  await expect
    .poll(() => page.evaluate(() => (window as any).copyPayload?.html))
    .toContain("<strong>bold</strong>");
});

test("source copy modes and image paste use the same public host workflow", async ({
  page,
}) => {
  await load(page, "**bold**");
  await command(page, "toggleSource");
  const cm = page.locator(".source-surface .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(() => {
    document.addEventListener("copy", (e) => {
      (window as any).copyPayload = {
        plain: e.clipboardData?.getData("text/plain"),
        html: e.clipboardData?.getData("text/html"),
      };
    });
  });
  await command(page, "copyPlain");
  await expect
    .poll(() => page.evaluate(() => (window as any).copyPayload?.plain))
    .toBe("bold");
  await cm.evaluate((el) => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "clip.png", {
        type: "image/png",
      }),
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
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
});

test("code copy modes keep literal payload and clipboard paste never creates structure", async ({
  page,
}) => {
  await load(page, "~~~\n**raw**\n~~~");
  const cm = page.locator(".literal .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(() => {
    document.addEventListener("copy", (e) => {
      (window as any).copyPayload = {
        plain: e.clipboardData?.getData("text/plain"),
        html: e.clipboardData?.getData("text/html"),
      };
    });
  });
  await command(page, "copyPlain");
  await expect
    .poll(() => page.evaluate(() => (window as any).copyPayload?.plain))
    .toBe("**raw**\n");
  await cm.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "- x\n- y");
    data.setData("text/html", "<ul><li>x</li><li>y</li></ul>");
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => source(page)).toBe("~~~\n- x\n- y\n~~~");
});

test("mixed clipboard uses text while pure image waits for a cancellable native result", async ({
  page,
}) => {
  await load(page, "A");
  const p = page.locator(".ProseMirror p");
  await p.click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await p.evaluate((el) => {
    const d = new DataTransfer();
    d.setData("text/plain", "text");
    d.setData("text/html", "<script>alert(1)</script><b>text</b>");
    d.items.add(new File(["x"], "clip.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: d,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => source(page)).toBe("Atext");
  expect(
    await page.evaluate(
      () =>
        (window as any).hostMessages.filter(
          (m: any) => m.method === "importImage",
        ).length,
    ),
  ).toBe(0);
  await p.evaluate((el) => {
    const d = new DataTransfer();
    d.items.add(new File(["x"], "clip.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: d,
        bubbles: true,
        cancelable: true,
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
  const request = await page.evaluate(
    () =>
      (window as any).hostMessages.find((m: any) => m.method === "importImage")
        .requestId,
  );
  await page.evaluate((request) => {
    const w = window as any;
    w.retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "close-flush",
      method: "flush",
      payload: {},
    });
    w.retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: request,
      method: "assetResult",
      payload: { relativePath: "assets/late.png", requestId: request },
    });
  }, request);
  expect(await source(page)).toBe("Atext");
});

test("unsupported DOM structure enters an explicit local recovery proposal", async ({
  page,
}) => {
  await load(page, "# keep\n\nold\n\n<!-- untouched -->");
  await selectText(page, ".ProseMirror p", 0, 3);
  await page.evaluate(() =>
    document.execCommand(
      "insertHTML",
      false,
      "<blockquote><p>new</p></blockquote>",
    ),
  );
  const panel = page.getByRole("dialog", { name: "恢复未提交输入" });
  await expect(panel).toBeVisible();
  await expect(page.locator("#recovery-source")).toHaveValue(
    "# keep\n\nnew\n\n<!-- untouched -->",
  );
  await page.getByRole("button", { name: "应用恢复文本" }).click();
  await expect
    .poll(() => source(page))
    .toBe("# keep\n\nnew\n\n<!-- untouched -->");
  const envelopes = await page.evaluate(() =>
    (window as any).hostMessages.filter(
      (m: any) => m.method === "recoveryDraft" || m.method === "checkpoint",
    ),
  );
  expect(envelopes[0].payload.draft.format).toBe("prosemirror-json");
  expect(envelopes.at(-1).payload.resolvesRecoveryDraft).toBe(true);
});

test("rendered math reentry restores the mapped source bookmark after earlier edits", async ({
  page,
}) => {
  await load(page, "before\n\n$$\nabc\n$$\n\nafter");
  await page.locator(".math-preview").click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await selectText(page, ".ProseMirror > p", 0, 0);
  await page.keyboard.type("prefix");
  await page.locator(".math-preview").click();
  await page.keyboard.type("X");
  await expect
    .poll(() => source(page))
    .toBe("prefixbefore\n\n$$\nabXc\n$$\n\nafter");
});

test("rich grapheme deletion removes complete escaped and entity source ranges", async ({
  page,
}) => {
  await load(page, "A&amp;中\\*");
  await selectText(page, ".ProseMirror p", 1, 1);
  await page.keyboard.press("Delete");
  await expect.poll(() => source(page)).toBe("A中\\*");
  await command(page, "undo");
  await selectText(page, ".ProseMirror p", 4, 4);
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("A&amp;中");
});

test("standalone literal boundary arrows keep ownership when no adjacent block exists", async ({
  page,
}) => {
  await load(page, "~~~\nx\n~~~");
  const cm = page.locator(".literal .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowLeft");
  await expect(cm).toBeFocused();
  await page.keyboard.type("A");
  await expect.poll(() => source(page)).toBe("~~~\nAx\n~~~");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowRight");
  await expect(cm).toBeFocused();
  await page.keyboard.type("B");
  await expect.poll(() => source(page)).toBe("~~~\nAx\nB\n~~~");
});

test("mode switches preserve the logical content visible at the viewport anchor", async ({
  page,
}) => {
  await load(
    page,
    Array.from(
      { length: 120 },
      (_, i) => `Paragraph ${i} with enough text to scroll.`,
    ).join("\n\n"),
  );
  const p = page.locator(".ProseMirror > p").nth(65);
  await p.scrollIntoViewIfNeeded();
  await p.click();
  const before = await p.boundingBox();
  await command(page, "toggleSource");
  await command(page, "toggleSource");
  await expect
    .poll(async () =>
      Math.abs(
        (await page.locator(".ProseMirror > p").nth(65).boundingBox())!.y -
          before!.y,
      ),
    )
    .toBeLessThan(50);
  expect(await source(page)).toBeUndefined();
});

test("source switch reveals the same viewport content immediately", async ({
  page,
}) => {
  await load(
    page,
    Array.from(
      { length: 120 },
      (_, i) => `Paragraph ${i} with enough text to scroll.`,
    ).join("\n\n"),
  );
  const p = page.locator(".ProseMirror > p").nth(65);
  await p.scrollIntoViewIfNeeded();
  await p.click();
  const before = await p.boundingBox();
  await command(page, "toggleSource");
  const line = page
    .locator(".source-surface .cm-line")
    .filter({ hasText: "Paragraph 65 with enough text to scroll." });
  await expect(line).toBeVisible();
  await expect
    .poll(async () => Math.abs((await line.boundingBox())!.y - before!.y))
    .toBeLessThan(50);
  expect(await source(page)).toBeUndefined();
});

test("source reentry restores literal ownership and editable raw blocks retain root undo focus", async ({
  page,
}) => {
  await load(page, "~~~\nx\n~~~");
  await command(page, "toggleSource");
  const sourceEditor = page.locator(".source-surface .cm-content");
  await sourceEditor.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await command(page, "toggleSource");
  await expect(page.locator(".literal .cm-content")).toBeFocused();
  await command(page, "toggleSource");
  await page.locator(".source-surface .cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("<!-- raw -->");
  await command(page, "toggleSource");
  const raw = page.locator(".literal .cm-content");
  await raw.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("x");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("<!-- raw -->");
  await expect(raw).toBeFocused();
});

test("drag release outside the editing DOM settles deferred projections before further typing", async ({
  page,
}) => {
  await load(page, "A");
  const p = page.locator(".ProseMirror p");
  await p.click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.locator(".ProseMirror").dispatchEvent("mousedown", { button: 0 });
  await page.evaluate(() =>
    document.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, bubbles: true }),
    ),
  );
  await selectText(page, ".ProseMirror p", 1, 1);
  await page.keyboard.type("xy");
  await expect.poll(() => source(page)).toBe("Axy");
  await expect(p).toHaveText("Axy");
});

test("table exit creates a prose position when its adjacent block is literal", async ({
  page,
}) => {
  await load(page, "| H |\n|---|\n| a |\n\n~~~\nx\n~~~");
  await page.locator(".ProseMirror td").click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("after");
  await expect
    .poll(() => source(page))
    .toBe("| H |\n|---|\n| a |\n\nafter\n\n~~~\nx\n~~~");
  await expect(page.locator(".ProseMirror > p")).toHaveText("after");
});

test("separate browser windows keep root histories and identities isolated", async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await load(page, "one");
  await load(second, "two");
  await page.locator(".ProseMirror p").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.keyboard.type("A");
  await second.locator(".ProseMirror p").click();
  await second.keyboard.press("ControlOrMeta+ArrowRight");
  await second.keyboard.type("B");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("one");
  await expect.poll(() => source(second)).toBe("twoB");
  await second.close();
});

test("adjacent literal boundaries transfer to the next literal owner without changing fences", async ({
  page,
}) => {
  await load(page, "~~~\nx\n~~~\n\n$$\ny\n$$");
  const code = page.getByLabel("代码源码", { exact: true }),
    math = page.getByLabel("公式源码", { exact: true });
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowRight");
  await expect(math).toBeFocused();
  await page.keyboard.type("A");
  await expect.poll(() => source(page)).toBe("~~~\nx\n~~~\n\n$$\nAy\n$$");
});
