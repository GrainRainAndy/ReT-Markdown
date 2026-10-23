import { renderer } from "./client";
import { mathFallback } from "./document";
export interface MathSnapshot {
  key: string;
  text: string;
  revision: number;
}
/** Owns only the inert preview element; the active editor DOM is never replaced. */
export class LiveMath {
  private abort: AbortController | undefined;
  private snapshot: MathSnapshot | undefined;
  private generation = 0;
  private disposed = false;
  constructor(
    private element: HTMLElement,
    private current: () => MathSnapshot | null,
    private displayMode = false,
    private rendered?: () => void,
  ) {
    this.update();
  }
  update(force = false): void {
    if (this.disposed) return;
    const snapshot = this.current();
    if (!snapshot) return;
    if (
      !force &&
      this.snapshot?.key === snapshot.key &&
      this.snapshot.text === snapshot.text
    )
      return;
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.snapshot = snapshot;
    const generation = ++this.generation;
    this.element.innerHTML = mathFallback(snapshot.text);
    this.element.dataset.renderState = "pending";
    this.element.setAttribute("aria-busy", "true");
    void renderer
      .run(
        { kind: "math", text: snapshot.text, displayMode: this.displayMode },
        abort.signal,
      )
      .then((result) => {
        if (
          this.disposed ||
          abort.signal.aborted ||
          generation !== this.generation
        )
          return;
        const current = this.current();
        if (
          !current ||
          current.key !== snapshot.key ||
          current.text !== snapshot.text
        )
          return;
        if (
          result.status === "ready" &&
          current.revision !== snapshot.revision
        ) {
          this.update(true);
          return;
        }
        this.element.innerHTML =
          result.status === "ready" ? result.html : mathFallback(current.text);
        this.element.dataset.renderState = result.status;
        this.element.setAttribute("aria-busy", "false");
        this.rendered?.();
      });
  }
  destroy(): void {
    this.disposed = true;
    this.generation++;
    this.abort?.abort();
  }
}
