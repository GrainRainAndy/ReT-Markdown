import { test, expect } from "@playwright/test";
import { load, command, source } from "./helpers";
test("paragraph split and merge preserve untouched source and root history", async ({
  page,
}) => {
  await load(page, "AlphaBeta\n\n**keep**");
  const prose = page.locator(".ProseMirror");
  await expect(prose).toBeVisible();
  await prose.locator("p").first().click();
  await page.keyboard.press("ControlOrMeta+ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect.poll(() => source(page)).toBe("Alpha\n\nBeta\n\n**keep**");
  await page.keyboard.press("Backspace");
  await expect.poll(() => source(page)).toBe("AlphaBeta\n\n**keep**");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("Alpha\n\nBeta\n\n**keep**");
  await command(page, "redo");
  await expect.poll(() => source(page)).toBe("AlphaBeta\n\n**keep**");
});
test("source switches retain BOM CRLF hidden syntax and a loaded dirty baseline", async ({
  page,
}) => {
  const initial = "\uFEFF# 标题\r\n\r\n**原文**\r\n";
  await load(page, initial, { savedSource: "旧版本" });
  await expect(page.locator(".ProseMirror")).toBeVisible();
  for (let i = 0; i < 20; i++) await command(page, "toggleSource");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "flush-check",
      method: "flush",
      payload: {},
    }),
  );
  const result = await page.evaluate(() =>
    (window as any).hostMessages.find(
      (m: any) => m.requestId === "flush-check",
    ),
  );
  expect(result.payload).toEqual({
    status: "ready",
    source: initial,
    revision: 7,
  });
  await expect(page.locator("[role=status]")).toContainText("未保存");
  expect(await source(page)).toBeUndefined();
});
test("typed markdown becomes rich content without rewriting neighbor bytes", async ({
  page,
}) => {
  await load(page, "\n\nkeep  \n");
  const p = page.locator(".ProseMirror p").first();
  await p.click();
  await page.keyboard.type("**bold**");
  await expect(page.locator(".ProseMirror strong")).toHaveText("bold");
  await expect.poll(() => source(page)).toBe("**bold**\n\nkeep  \n");
});
test("code literal enter stays code and root undo works across source mode", async ({
  page,
}) => {
  await load(page, "~~~js\r\n- x\r\n~~~");
  const code = page.locator(".literal .cm-content");
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- y");
  await expect.poll(() => source(page)).toBe("~~~js\r\n- x\r\n\r\n- y\r\n~~~");
  await command(page, "undo");
  await command(page, "toggleSource");
  await expect(page.locator(".source-surface .cm-content")).toBeVisible();
  await command(page, "undo");
  await command(page, "undo");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("~~~js\r\n- x\r\n~~~");
});
test("loaded recovery blocks flush and commits recovery atomically", async ({
  page,
}) => {
  await load(page, "before", {
    recoveryDraft: {
      baseRevision: 7,
      owner: "prose",
      format: "text",
      content: "recovered",
      recoverySource: "recovered",
      reason: "conversion failed",
    },
  });
  await expect(
    page.getByRole("dialog", { name: "恢复未提交输入" }),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "f",
      method: "flush",
      payload: {},
    }),
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).hostMessages.find((m: any) => m.requestId === "f")
          .payload.status,
    ),
  ).toBe("pending");
  await page.getByRole("button", { name: "应用恢复文本" }).click();
  await expect.poll(() => source(page)).toBe("recovered");
  expect(
    await page.evaluate(
      () =>
        (window as any).hostMessages.find((m: any) => m.method === "checkpoint")
          .payload.resolvesRecoveryDraft,
    ),
  ).toBe(true);
});
test("source edit preserves existing CRLF and root undo exact bytes", async ({
  page,
}) => {
  await load(page, "A\r\n\r\nB");
  await command(page, "toggleSource");
  const cm = page.locator(".source-surface .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("中文\nX");
  await expect.poll(() => source(page)).toBe("中文\r\nX");
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("A\r\n\r\nB");
});
test("unclosed literal Cmd Enter does not repair source or create history", async ({
  page,
}) => {
  await load(page, "~~~\nx");
  const cm = page.locator(".literal .cm-content");
  await cm.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ControlOrMeta+Enter");
  expect(await source(page)).toBeUndefined();
  await expect(page.getByRole("alert")).toContainText("闭合");
});
test("composition barriers and frozen export use public protocol and loaded revision", async ({
  page,
}) => {
  await load(page, "current");
  const prose = page.locator(".ProseMirror");
  await prose.dispatchEvent("compositionstart", { data: "中" });
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "composition-flush",
      method: "flush",
      payload: {},
    }),
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).hostMessages.find(
          (m: any) => m.requestId === "composition-flush",
        ).payload,
    ),
  ).toEqual({ status: "pending", reason: "composition" });
  await prose.dispatchEvent("compositionend", { data: "" });
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "export",
      method: "prepareExport",
      payload: { source: "# frozen", revision: 4 },
    }),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).hostMessages.some(
          (m: any) => m.requestId === "export" && m.method === "exportContent",
        ),
      ),
    )
    .toBe(true);
  const result = await page.evaluate(() =>
    (window as any).hostMessages.find((m: any) => m.requestId === "export"),
  );
  expect(result.payload.revision).toBe(4);
  expect(result.payload.html).toContain("<h1>frozen</h1>");
  expect(result.payload.html).not.toContain("current");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "other",
      epoch: "epoch-a",
      requestId: "bad",
      method: "command",
      payload: { id: "toggleSource" },
    }),
  );
  await expect(prose).toBeVisible();
});
test("rejected load during composition does not adopt the replacement epoch", async ({
  page,
}) => {
  await load(page, "kept");
  const prose = page.locator(".ProseMirror");
  await prose.dispatchEvent("compositionstart", { data: "中" });
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "replacement",
      requestId: "new-load",
      method: "load",
      payload: { source: "lost", revision: 20 },
    }),
  );
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "old-flush",
      method: "flush",
      payload: {},
    }),
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).hostMessages.find(
          (m: any) => m.requestId === "old-flush",
        )?.payload.status,
    ),
  ).toBe("pending");
  await prose.dispatchEvent("compositionend", { data: "" });
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "kept-flush",
      method: "flush",
      payload: {},
    }),
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).hostMessages.find(
          (m: any) => m.requestId === "kept-flush",
        )?.payload.source,
    ),
  ).toBe("kept");
});

for (const mode of ["rich", "source"]) {
  test(`${mode} original overlapping flush requests resume once after composition commits`, async ({
    page,
  }) => {
    await load(page, "start");
    if (mode === "source") await command(page, "toggleSource");
    const input = page
      .locator(mode === "rich" ? ".ProseMirror" : ".cm-content")
      .first();
    await input.click();
    await page.keyboard.press("ControlOrMeta+End");
    await input.dispatchEvent("compositionstart");
    await page.keyboard.insertText("中文");
    await page.evaluate(() => {
      for (const requestId of ["pending-one", "pending-two"])
        (window as any).retNative.receive({
          v: 1,
          documentId: "doc-a",
          epoch: "epoch-a",
          requestId,
          method: "flush",
          payload: {},
        });
    });
    const replies = () =>
      page.evaluate(() =>
        (window as any).hostMessages.filter(
          (m: any) =>
            m.method === "flushResult" &&
            m.payload.status === "ready" &&
            m.requestId.startsWith("pending-"),
        ),
      );
    expect(await replies()).toEqual([]);
    await input.dispatchEvent("compositionend");
    await expect.poll(replies).toHaveLength(2);
    const results = await replies();
    expect(results.map((m: any) => m.requestId).sort()).toEqual([
      "pending-one",
      "pending-two",
    ]);
    for (const result of results)
      expect(result.payload.source).toBe("start中文");
    await input.dispatchEvent("compositionend");
    expect(await replies()).toHaveLength(2);
  });
}
test("close flush holds editing until cancellation releases it", async ({
  page,
}) => {
  await load(page, "saved");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" edit");
  await expect.poll(() => source(page)).toBe("saved edit");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "close",
      method: "flush",
      payload: { holdInput: true },
    }),
  );
  await expect(page.locator("#workspace")).toHaveJSProperty("inert", true);
  await command(page, "undo");
  expect(await source(page)).toBe("saved edit");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "cancel-close",
      method: "flushRelease",
      payload: {},
    }),
  );
  await expect(page.locator("#workspace")).toHaveJSProperty("inert", false);
  await page.locator(".ProseMirror").click();
  await command(page, "undo");
  await expect.poll(() => source(page)).toBe("saved");
});
test("composition timeout removes original requests before a late commit", async ({
  page,
}) => {
  await load(page, "saved");
  await page.clock.install();
  await page.locator(".ProseMirror").dispatchEvent("compositionstart");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "expire",
      method: "flush",
      payload: {},
    }),
  );
  await page.clock.fastForward(10001);
  await page.locator(".ProseMirror").dispatchEvent("compositionend");
  const replies = await page.evaluate(() =>
    (window as any).hostMessages
      .filter(
        (m: any) => m.method === "flushResult" && m.requestId === "expire",
      )
      .map((m: any) => m.payload),
  );
  expect(replies).toEqual([
    { status: "pending", reason: "composition" },
    { status: "pending", reason: "composition-timeout" },
  ]);
});
test("close hold rejects an already-open replace panel and reload preparation", async ({
  page,
}) => {
  await load(page, "saved");
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(" edit");
  await command(page, "replace");
  await page.getByLabel("查找内容", { exact: true }).fill("saved");
  await page.getByLabel("替换为", { exact: true }).fill("overwritten");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "hold",
      method: "flush",
      payload: { holdInput: true },
    }),
  );
  await page.getByRole("button", { name: "全部替换", exact: true }).click();
  expect.soft(await source(page)).toBe("saved edit");
  await page.evaluate(() =>
    (window as any).retNative.receive({
      v: 1,
      documentId: "doc-a",
      epoch: "epoch-a",
      requestId: "reload-held",
      method: "reloadPrepare",
      payload: { epoch: "epoch-b", load: { source: "external", revision: 0 } },
    }),
  );
  const reply = await page.evaluate(() =>
    (window as any).hostMessages.find(
      (m: any) => m.method === "reloadReady" && m.requestId === "reload-held",
    ),
  );
  expect(reply.payload.status).toBe("pending");
});
