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
  constructor(private handler: (message: Envelope) => void) {
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
