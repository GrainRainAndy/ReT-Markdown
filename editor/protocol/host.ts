export interface Envelope {
  v: 1;
  documentId: string;
  epoch: string;
  requestId: string;
  method: string;
  payload: Record<string, unknown>;
}
export interface RecoveryDraft {
  baseRevision: number;
  owner: string;
  format: "text" | "prosemirror-json";
  content: string;
  recoverySource?: string;
  reason: string;
}
declare global {
  interface Window {
    retNative: { receive: (message: unknown) => void };
    webkit?: {
      messageHandlers?: { ret?: { postMessage: (message: Envelope) => void } };
    };
  }
}
export class HostBridge {
  documentId = "";
  epoch = "";
  private sequence = 0;
  private loaded = false;
  private reload:
    { id: string; epoch: string; payload: Record<string, unknown> } | undefined;
  private cancelled = new Set<string>();
  private completed?: string;
  get replacing(): boolean {
    return !!this.reload;
  }
  constructor(
    private handler: (message: Envelope) => void,
    private canLoad: () => boolean = () => true,
  ) {
    window.retNative = { receive: (message) => this.receive(message) };
  }
  get native(): boolean {
    return !!window.webkit?.messageHandlers?.ret;
  }
  start(): void {
    this.send("ready", {});
  }
  send(
    method: string,
    payload: Record<string, unknown>,
    requestId?: string,
  ): string {
    const id = requestId ?? `web-${++this.sequence}`;
    window.webkit?.messageHandlers?.ret?.postMessage({
      v: 1,
      documentId: this.documentId,
      epoch: this.epoch,
      requestId: id,
      method,
      payload,
    });
    return id;
  }
  private receive(input: unknown): void {
    if (!input || typeof input !== "object") return;
    const m = input as Envelope;
    if (
      m.v !== 1 ||
      typeof m.documentId !== "string" ||
      typeof m.epoch !== "string" ||
      typeof m.requestId !== "string" ||
      typeof m.method !== "string" ||
      !m.payload ||
      typeof m.payload !== "object" ||
      Array.isArray(m.payload)
    )
      return;
    const matching =
      this.loaded && m.documentId === this.documentId && m.epoch === this.epoch;
    if (m.method === "reloadPrepare" && matching) {
      if (this.cancelled.has(m.requestId)) return;
      const p = m.payload.load as Record<string, unknown> | undefined;
      if (
        this.reload ||
        !p ||
        typeof p.source !== "string" ||
        !Number.isSafeInteger(p.revision) ||
        Number(p.revision) < 0 ||
        typeof m.payload.epoch !== "string" ||
        m.payload.epoch === this.epoch ||
        !this.canLoad()
      ) {
        this.send(
          "reloadReady",
          { status: "pending", reason: "input or replacement pending" },
          m.requestId,
        );
        return;
      }
      this.reload = {
        id: m.requestId,
        epoch: m.payload.epoch,
        payload: structuredClone(p),
      };
      this.handler(m); // locks input synchronously before acknowledging the snapshot
      return;
    }
    if (m.method === "reloadCancel" && matching) {
      this.cancelled.add(m.requestId);
      if (this.reload?.id === m.requestId) {
        this.reload = undefined;
        this.handler(m);
      }
      return;
    }
    if (m.method === "reloadCommit" && m.documentId === this.documentId) {
      if (this.completed === m.requestId && matching) {
        this.send("reloadComplete", {}, m.requestId);
        return;
      }
      const transaction = this.reload;
      if (
        !transaction ||
        transaction.id !== m.requestId ||
        transaction.epoch !== m.epoch
      )
        return;
      this.epoch = transaction.epoch;
      this.reload = undefined;
      this.completed = m.requestId;
      this.handler({ ...m, method: "load", payload: transaction.payload });
      this.send("reloadComplete", {}, m.requestId);
      return;
    }
    if (this.reload && m.method === "load") return;
    if (m.method === "load") {
      if (
        this.loaded &&
        (m.documentId !== this.documentId || m.epoch === this.epoch)
      )
        return;
      if (
        typeof m.payload.source !== "string" ||
        !Number.isSafeInteger(m.payload.revision) ||
        Number(m.payload.revision) < 0
      )
        return;
      // Identity and application state cross the load barrier together.
      if (!this.canLoad()) return;
      this.documentId = m.documentId;
      this.epoch = m.epoch;
      this.loaded = true;
    } else if (
      !this.loaded ||
      m.documentId !== this.documentId ||
      m.epoch !== this.epoch
    )
      return;
    this.handler(m);
  }
}
