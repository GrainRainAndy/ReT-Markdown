import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";

for (const kind of ["code", "math"] as const)
  for (const backward of [false, true])
    test(`${kind} cross-boundary ${backward ? "reverse" : "forward"} selection is visibly whole and shared by copy cut delete`, async ({
      page,
    }) => {
      const fence = kind === "code" ? "~~~" : "$$",
        block = fence + "\nx\n" + fence,
        initial = "before\n\n" + block + "\n\nafter";
      await load(page, initial);
      const cm = page.getByLabel(kind === "code" ? "代码源码" : "公式源码", {
        exact: true,
      });
      await cm.click();
      await page.keyboard.press(
        backward ? "ControlOrMeta+Home" : "ControlOrMeta+End",
      );
      await page.keyboard.press(
        backward ? "Shift+ArrowLeft" : "Shift+ArrowRight",
      );
      expect(
        await page
          .locator(".literal")
          .evaluate((el) => window.getSelection()!.containsNode(el, false)),
      ).toBe(true);
      const clipboard = await page.locator(".ProseMirror").evaluate((el) => {
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
      expect(clipboard).toBe(backward ? "\n\n" + block : block + "\n\n");
      await page.keyboard.press("Backspace");
      await expect.poll(() => source(page)).toBe("before\n\nafter");
      await command(page, "undo");
      await expect.poll(() => source(page)).toBe(initial);
      expect(
        await page
          .locator(".literal")
          .evaluate((el) => window.getSelection()!.containsNode(el, false)),
      ).toBe(true);
      await command(page, "redo");
      await expect.poll(() => source(page)).toBe("before\n\nafter");
      await command(page, "undo");
      const cut = await page.locator(".ProseMirror").evaluate((el) => {
        const d = new DataTransfer();
        el.dispatchEvent(
          new ClipboardEvent("cut", {
            clipboardData: d,
            bubbles: true,
            cancelable: true,
          }),
        );
        return d.getData("text/plain");
      });
      expect(cut).toBe(clipboard);
      await expect.poll(() => source(page)).toBe("before\n\nafter");
    });

for (const reversed of [false, true])
  test(`visible code language label preserves ${reversed ? "reversed" : "collapsed"} selection and focus`, async ({
    page,
  }) => {
    await load(page, "~~~js\nabcdef\n~~~");
    const cm = page.getByLabel("代码源码", { exact: true });
    await cm.click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    if (reversed) {
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await page.locator(".literal-label").click();
    await page.getByLabel("代码语言", { exact: true }).fill("ts");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect(cm).toBeFocused();
    await expect(page.locator(".literal-label")).toHaveText("ts");
    await page.keyboard.type("X");
    await expect
      .poll(() => source(page))
      .toBe(reversed ? "~~~ts\nabXef\n~~~" : "~~~ts\nabXcdef\n~~~");
    await command(page, "undo");
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe("~~~js\nabcdef\n~~~");
  });

test("case-insensitive find keeps original Unicode offsets and replaces all in one history entry", async ({
  page,
}) => {
  await load(page, "İ One ONE one 尾");
  await command(page, "replace");
  await page.getByLabel("查找内容", { exact: true }).fill("one");
  await expect(page.getByLabel("匹配数量")).toHaveText("1 处匹配");
  await page
    .getByRole("checkbox", { name: "区分大小写", exact: true })
    .uncheck();
  await expect(page.getByLabel("匹配数量")).toHaveText("3 处匹配");
  await page.getByRole("button", { name: "下一个", exact: true }).click();
  await page.getByLabel("替换为", { exact: true }).fill("改");
  await page.getByRole("button", { name: "替换当前", exact: true }).click();
  await expect.poll(() => source(page)).toBe("İ 改 ONE one 尾");
  await command(page, "undo");
  await page.getByRole("button", { name: "上一个", exact: true }).click();
  await page.getByRole("button", { name: "替换当前", exact: true }).click();
  await expect.poll(() => source(page)).toBe("İ One ONE 改 尾");
  await command(page, "undo");
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  await expect.poll(() => source(page)).toBe("İ 改 改 改 尾");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("İ One ONE one 尾");
});

test("explicit Paste Image uses clipboard source in rich and source modes and requires matched response IDs", async ({
  page,
}) => {
  await load(page, "A");
  await page.locator(".ProseMirror p").click();
  for (const mode of ["rich", "source"]) {
    if (mode === "source") await command(page, "toggleSource");
    await command(page, "pasteImage");
    const request = await page.evaluate(() =>
      (window as any).hostMessages
        .filter((m: any) => m.method === "importImage")
        .at(-1),
    );
    expect(request.payload).toEqual({ source: "clipboard" });
    await page.evaluate(
      (id) =>
        (window as any).retNative.receive({
          v: 1,
          documentId: "doc-a",
          epoch: "epoch-a",
          requestId: "unrelated",
          method: "assetResult",
          payload: { requestId: id, relativePath: "assets/wrong.png" },
        }),
      request.requestId,
    );
    expect(await source(page)).toBeUndefined();
    await page.evaluate(
      (id) =>
        (window as any).retNative.receive({
          v: 1,
          documentId: "doc-a",
          epoch: "epoch-a",
          requestId: id,
          method: "assetResult",
          payload: { requestId: id, relativePath: "assets/right.png" },
        }),
      request.requestId,
    );
    await expect.poll(() => source(page)).toContain("assets/right.png");
    await command(page, "undo");
    await expect.poll(() => source(page)).toBe("A");
    await page.evaluate(() => ((window as any).hostMessages = []));
  }
  await command(page, "insertImage");
  const picker = await page.evaluate(() =>
    (window as any).hostMessages.find((m: any) => m.method === "importImage"),
  );
  expect(picker.payload).toEqual({});
});

test("terminable pending math and export workers allow continued input and fall back at the deadline", async ({
  page,
}) => {
  await page.route("**/render-worker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "self.onmessage=()=>{while(true){}}",
    }),
  );
  await load(page, "before\n\n$$\nx\n$$");
  await expect(page.locator(".math-preview")).toHaveAttribute(
    "data-render-state",
    "pending",
  );
  await page.locator(".ProseMirror > p").click();
  await page.keyboard.type("XYZ");
  await expect.poll(() => source(page)).toBe("beforeXYZ\n\n$$\nx\n$$");
  await expect(page.locator(".math-preview")).toHaveAttribute(
    "data-render-state",
    "timeout",
    { timeout: 4000 },
  );
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "slow-export",
      method: "prepareExport",
      payload: { source: "# frozen\n\n$x$", revision: 3 },
    }),
  );
  await page.locator(".ProseMirror > p").click();
  await page.keyboard.type("Q");
  await expect.poll(() => source(page)).toContain("Q");
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).hostMessages.find(
            (m: any) =>
              m.requestId === "slow-export" && m.method === "exportContent",
          ),
        ),
      { timeout: 4000 },
    )
    .toMatchObject({ payload: { revision: 3 } });
  const result = await page.evaluate(
    () =>
      (window as any).hostMessages.find(
        (m: any) => m.requestId === "slow-export",
      ).payload.html,
  );
  expect(result).toContain('data-render-state="timeout"');
  expect(result).toContain("# frozen\n\n$x$");
  expect(result).not.toContain("beforeXYZ");
});

test("math drops older node/revision results and superseded export responses", async ({
  page,
}) => {
  await page.route("**/render-worker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `self.onmessage=({data:m})=>setTimeout(()=>self.postMessage({id:m.id,html:'<i>'+ (m.job.kind==='math'?m.job.text:m.job.source)+'</i>'}),220)`,
    }),
  );
  await load(page, "before\n\n$$\nx\n$$");
  const cm = page.getByLabel("公式源码", { exact: true });
  await cm.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("y");
  await expect.poll(() => source(page)).toBe("before\n\n$$\ny\n$$");
  await page.locator(".ProseMirror > p").click();
  await page.keyboard.type("new");
  await expect(page.locator(".math-preview")).toHaveText("y");
  await page.evaluate(() => {
    for (const id of ["old-export", "latest-export"])
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: id,
        method: "prepareExport",
        payload: { source: id, revision: 3 },
      });
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).hostMessages.some(
          (m: any) =>
            m.method === "exportContent" && m.requestId === "latest-export",
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).hostMessages.some(
        (m: any) =>
          m.method === "exportContent" && m.requestId === "old-export",
      ),
    ),
  ).toBe(false);
});

test("conflicting asset envelope IDs cannot consume a genuine pending image request", async ({
  page,
}) => {
  await load(page, "A");
  await page.locator(".ProseMirror p").click();
  await command(page, "insertImage");
  const id = await page.evaluate(
    () =>
      (window as any).hostMessages.find((m: any) => m.method === "importImage")
        .requestId,
  );
  await page.evaluate(
    (id) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: "other",
        method: "assetResult",
        payload: { requestId: id, relativePath: "assets/wrong.png" },
      }),
    id,
  );
  expect(await source(page)).toBeUndefined();
  await page.evaluate(
    (id) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: id,
        method: "assetResult",
        payload: { requestId: id, relativePath: "assets/right.png" },
      }),
    id,
  );
  await expect.poll(() => source(page)).toContain("assets/right.png");
});

test("source and internal literal copy retain exact text while a rich DOM selection crossing the literal expands visibly", async ({
  page,
}) => {
  await load(page, "before\n\n~~~\nabcdef\n~~~\n\nafter");
  const cm = page.getByLabel("代码源码", { exact: true });
  await cm.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  const exact = await cm.evaluate((el) => {
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
  expect(exact).toBe("b");
  const cross = await page.evaluate(() => {
    const code = document.querySelector(".literal .cm-line")!.firstChild!,
      after = document.querySelectorAll(".ProseMirror > p")[1]!.firstChild!;
    window.getSelection()!.setBaseAndExtent(code, 3, after, 2);
    const el = document.querySelector(".ProseMirror")!;
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
  expect(cross).toBe("~~~\nabcdef\n~~~\n\naf");
  await expect(page.locator(".literal")).toHaveClass(/selected-literal/);
  await command(page, "toggleSource");
  const sourceCM = page.locator(".source-surface .cm-content");
  await sourceCM.click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  const raw = await sourceCM.evaluate((el) => {
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
  expect(raw).toBe("~");
});

test("unavailable workers preserve safe formula source and frozen export without main-thread KaTeX", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).Worker = class {
      constructor() {
        throw Error("file worker unavailable");
      }
    };
  });
  await load(page, "before\n\n$$\nx<y\n$$");
  await expect(page.locator(".math-preview")).toHaveAttribute(
    "data-render-state",
    "unavailable",
  );
  await expect(page.locator(".math-preview")).toHaveText("x<y");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "unavailable-export",
      method: "prepareExport",
      payload: { source: "<script>frozen</script>\n\n$x$", revision: 4 },
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostMessages.find(
            (m: any) => m.method === "exportContent",
          )?.payload.html,
      ),
    )
    .toContain('data-render-state="unavailable"');
  const html = await page.evaluate(
    () =>
      (window as any).hostMessages.find(
        (m: any) => m.method === "exportContent",
      ).payload.html,
  );
  expect(html).toContain("&lt;script&gt;frozen&lt;/script&gt;");
  expect(html).not.toContain("<script>");
});

test("new document epochs cancel pending previews and frozen exports", async ({
  page,
}) => {
  await page.route("**/render-worker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `self.onmessage=({data:m})=>setTimeout(()=>self.postMessage({id:m.id,html:m.job.kind==='math'?m.job.text:m.job.source}),250)`,
    }),
  );
  await load(page, "$$\nold\n$$");
  await page.evaluate(() => {
    const w = window as any;
    w.retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "old-epoch-export",
      method: "prepareExport",
      payload: { source: "old", revision: 1 },
    });
    w.retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "next",
      requestId: "reload",
      method: "load",
      payload: { source: "# fresh", revision: 20 },
    });
    w.retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "next",
      requestId: "new-epoch-export",
      method: "prepareExport",
      payload: { source: "fresh", revision: 20 },
    });
  });
  await expect(page.locator(".ProseMirror h1")).toHaveText("fresh");
  await expect(page.locator(".math-preview")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).hostMessages.some(
          (m: any) =>
            m.requestId === "new-epoch-export" && m.method === "exportContent",
        ),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() =>
      (window as any).hostMessages.some(
        (m: any) =>
          m.requestId === "old-epoch-export" && m.method === "exportContent",
      ),
    ),
  ).toBe(false);
});
