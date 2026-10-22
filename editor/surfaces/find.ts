import type { DocumentSession } from "../core/document";
import type { LogicalSelection } from "../core/types";
import { logical, type Intent } from "./editing";
export class FindPanel {
  readonly dom: HTMLElement;
  private query: HTMLInputElement;
  private replacement: HTMLInputElement;
  private count: HTMLElement;
  private replaceRow: HTMLElement;
  constructor(
    parent: HTMLElement,
    private session: () => DocumentSession,
    private reveal: (selection: LogicalSelection) => void,
    private apply: (intent: Intent) => void,
  ) {
    this.dom = document.createElement("section");
    this.dom.className = "find-panel";
    this.dom.hidden = true;
    this.dom.setAttribute("aria-label", "查找替换");
    this.dom.innerHTML =
      '<label>查找<input aria-label="查找内容" autocomplete="off"></label><span aria-label="匹配数量"></span><button data-action="previous" title="上一个（Shift+Enter）">上一个</button><button data-action="next" title="下一个（Enter）">下一个</button><button data-action="close" aria-label="关闭查找">×</button><div class="replace-row"><label>替换<input aria-label="替换为" autocomplete="off"></label><button data-action="one">替换当前</button><button data-action="all">全部替换</button></div>';
    parent.prepend(this.dom);
    this.query = this.dom.querySelector('[aria-label="查找内容"]')!;
    this.replacement = this.dom.querySelector('[aria-label="替换为"]')!;
    this.count = this.dom.querySelector('[aria-label="匹配数量"]')!;
    this.replaceRow = this.dom.querySelector(".replace-row")!;
    this.query.oninput = () => this.update();
    this.dom.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.dom.hidden = true;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        this.next(e.shiftKey ? -1 : 1);
      }
    });
    this.dom.addEventListener("click", (e) => {
      const action = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      )?.dataset.action;
      if (action === "close") this.dom.hidden = true;
      if (action === "next" || action === "previous")
        this.next(action === "next" ? 1 : -1);
      if (action === "all") this.replace(true);
      if (action === "one") this.replace(false);
    });
  }
  open(replace: boolean): void {
    this.dom.hidden = false;
    this.replaceRow.hidden = !replace;
    this.update();
    this.query.focus();
    this.query.select();
  }
  update(): void {
    this.count.textContent = `${this.matches().length} 处匹配`;
  }
  private matches(): number[] {
    const text = this.session().source,
      q = this.query.value;
    if (!q) return [];
    const results: number[] = [];
    let from = 0;
    while (from <= text.length) {
      const index = text.indexOf(q, from);
      if (index < 0) break;
      results.push(index);
      from = index + q.length;
    }
    return results;
  }
  private next(direction: number): void {
    const positions = this.matches();
    if (!positions.length) return;
    const selection = this.session().selection;
    const at =
      direction > 0
        ? Math.max(selection.anchor.offset, selection.head.offset)
        : Math.min(selection.anchor.offset, selection.head.offset);
    const index =
      direction > 0
        ? (positions.find((p) => p >= at) ?? positions[0]!)
        : ([...positions].reverse().find((p) => p < at) ?? positions.at(-1)!);
    this.reveal(
      logical(index, index + this.query.value.length, { kind: "source" }),
    );
    this.query.focus();
  }
  private replace(all: boolean): void {
    const matches = this.matches();
    if (!matches.length) return;
    const s = this.session().selection;
    const selected = all
      ? matches
      : matches.includes(Math.min(s.anchor.offset, s.head.offset)) &&
          Math.abs(s.head.offset - s.anchor.offset) === this.query.value.length
        ? [Math.min(s.anchor.offset, s.head.offset)]
        : [matches.find((p) => p >= s.head.offset) ?? matches[0]!];
    const patches = selected.map((from) => ({
      from,
      to: from + this.query.value.length,
      insert: this.replacement.value,
    }));
    const at = patches[0]!.from + this.replacement.value.length;
    this.apply({ patches, selection: logical(at, at, { kind: "source" }) });
    this.update();
  }
}
