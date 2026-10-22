export type RenderJob =
  | { kind: "math"; text: string; displayMode: boolean }
  | { kind: "document"; source: string };
export type RenderResult =
  | { status: "ready"; html: string }
  | { status: "timeout" | "unavailable" | "error" | "cancelled" };
export interface WorkerPort {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  postMessage: (value: { id: number; job: RenderJob }) => void;
  terminate: () => void;
}
interface Request {
  start: () => void;
  cancel: () => void;
  done: boolean;
}
/** Every job owns an independently terminable worker. Only two jobs run at once. */
export class RenderService {
  private sequence = 0;
  private active = 0;
  private queue: Request[] = [];
  private requests = new Set<Request>();
  private disposed = false;
  constructor(
    private factory: () => WorkerPort,
    readonly deadline = 1500,
  ) {}
  run(job: RenderJob, signal?: AbortSignal): Promise<RenderResult> {
    if (this.disposed || signal?.aborted)
      return Promise.resolve({ status: "cancelled" });
    return new Promise((resolve) => {
      let worker: WorkerPort | undefined,
        timer: ReturnType<typeof setTimeout> | undefined,
        started = false;
      const id = ++this.sequence;
      const finish = (result: RenderResult): void => {
        if (request.done) return;
        request.done = true;
        if (timer !== undefined) clearTimeout(timer);
        worker?.terminate();
        worker = undefined;
        signal?.removeEventListener("abort", request.cancel);
        this.requests.delete(request);
        if (started) this.active--;
        resolve(result);
        queueMicrotask(() => this.pump());
      };
      const request: Request = {
        done: false,
        cancel: () => finish({ status: "cancelled" }),
        start: () => {
          started = true;
          this.active++;
          try {
            worker = this.factory();
            worker.onerror = () => finish({ status: "error" });
            worker.onmessage = ({ data }) => {
              if (!data || typeof data !== "object") return;
              const message = data as {
                id?: unknown;
                html?: unknown;
                error?: unknown;
              };
              if (message.id !== id) return;
              if (typeof message.html === "string")
                finish({ status: "ready", html: message.html });
              else if (message.error) finish({ status: "error" });
            };
            worker.postMessage({ id, job });
          } catch {
            finish({ status: "unavailable" });
          }
        },
      };
      this.requests.add(request);
      this.queue.push(request);
      timer = setTimeout(() => finish({ status: "timeout" }), this.deadline);
      signal?.addEventListener("abort", request.cancel, { once: true });
      this.pump();
    });
  }
  private pump(): void {
    if (this.disposed) return;
    while (this.active < 2 && this.queue.length) {
      const next = this.queue.shift()!;
      if (!next.done) next.start();
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const r of [...this.requests]) r.cancel();
    this.queue = [];
  }
}
function browserWorker(): WorkerPort {
  const worker = new Worker(new URL("render-worker.js", document.baseURI));
  const port: WorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
  worker.onmessage = (event) => port.onmessage?.({ data: event.data });
  worker.onerror = (event) => {
    event.preventDefault();
    port.onerror?.();
  };
  return port;
}
export const renderer = new RenderService(browserWorker);
