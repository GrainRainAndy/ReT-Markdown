import { it, expect } from "vitest";
import { Worker as NodeWorker } from "node:worker_threads";
import { RenderService, type WorkerPort } from "../../editor/render/client";
function actualWorker(script: string, onExit?: () => void): WorkerPort {
  const worker = new NodeWorker(script, { eval: true });
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage: (value) => worker.postMessage(value),
    terminate: () => {
      void worker.terminate();
    },
  };
  worker.on("message", (data) => port.onmessage?.({ data }));
  worker.on("error", () => port.onerror?.());
  worker.on("exit", () => onExit?.());
  return port;
}
it("terminates a genuinely stuck worker at its deadline while the main event loop remains usable", async () => {
  let exited = false;
  let signalExit!: () => void;
  const exit = new Promise<void>((resolve) => {
    signalExit = resolve;
  });
  const started = performance.now();
  const renderer = new RenderService(
    () =>
      actualWorker(
        "require('node:worker_threads').parentPort.on('message',()=>{while(true){}})",
        () => {
          exited = true;
          signalExit();
        },
      ),
    60,
  );
  const pending = renderer.run({ kind: "math", text: "x", displayMode: false });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(exited).toBe(false);
  expect((await pending).status).toBe("timeout");
  expect(performance.now() - started).toBeLessThan(1500);
  await Promise.race([
    exit,
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(Error("worker exit timeout")),
        3000,
      );
      timer.unref();
    }),
  ]);
  expect(exited).toBe(true);
  renderer.dispose();
});
it("cancels a running worker and ignores its late response independently of the next job", async () => {
  const renderer = new RenderService(
    () =>
      actualWorker(
        "const p=require('node:worker_threads').parentPort;p.on('message',m=>setTimeout(()=>p.postMessage({id:m.id,html:m.job.text}),50))",
      ),
    500,
  );
  const controller = new AbortController(),
    first = renderer.run(
      { kind: "math", text: "old", displayMode: false },
      controller.signal,
    );
  controller.abort();
  expect((await first).status).toBe("cancelled");
  expect(
    await renderer.run({ kind: "math", text: "latest", displayMode: false }),
  ).toEqual({ status: "ready", html: "latest" });
  renderer.dispose();
});
it("worker creation failure returns unavailable instead of running a synchronous renderer", async () => {
  const renderer = new RenderService(() => {
    throw Error("file worker unavailable");
  }, 20);
  expect((await renderer.run({ kind: "document", source: "$x$" })).status).toBe(
    "unavailable",
  );
  renderer.dispose();
});
it("queued renders retain the original request deadline rather than receiving a fresh budget after a busy slot", async () => {
  const renderer = new RenderService(
    () =>
      actualWorker(
        "const p=require('node:worker_threads').parentPort;p.on('message',m=>{if(m.job.text==='queued')p.postMessage({id:m.id,html:'late'});else while(true){}})",
      ),
    60,
  );
  const results = await Promise.all(
    ["busy1", "busy2", "queued"].map((text) =>
      renderer.run({ kind: "math", text, displayMode: false }),
    ),
  );
  expect(results.map((r) => r.status)).toEqual([
    "timeout",
    "timeout",
    "timeout",
  ]);
  renderer.dispose();
});
