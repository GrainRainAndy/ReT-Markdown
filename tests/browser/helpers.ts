import { type Page } from "@playwright/test";
export async function load(
  page: Page,
  source: string,
  extra: Record<string, unknown> = {},
) {
  await page.addInitScript(
    ({ source, extra }) => {
      const w = window as any;
      w.hostMessages = [];
      w.webkit = {
        messageHandlers: {
          ret: {
            postMessage: (e: any) => {
              w.hostMessages.push(e);
              if (e.method === "ready")
                queueMicrotask(() =>
                  w.retNative.receive({
                    v: 1,
                    documentId: "doc-a",
                    epoch: "epoch-a",
                    requestId: "load",
                    method: "load",
                    payload: {
                      source,
                      revision: 7,
                      displayName: "测试.md",
                      fileURL: null,
                      appearance: "light",
                      ...extra,
                    },
                  }),
                );
            },
          },
        },
      };
    },
    { source, extra },
  );
  await page.goto("/");
}
export async function command(page: Page, id: string) {
  await page.evaluate(
    (id) =>
      (window as any).retNative.receive({
        v: 1,
        documentId: "doc-a",
        epoch: "epoch-a",
        requestId: id,
        method: "command",
        payload: { id },
      }),
    id,
  );
}
export async function source(page: Page) {
  return page.evaluate(() => {
    const m = (window as any).hostMessages.filter(
      (m: any) => m.method === "checkpoint",
    );
    return m.at(-1)?.payload.source;
  });
}
