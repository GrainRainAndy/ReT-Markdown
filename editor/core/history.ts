import type { LogicalSelection } from './types';

export interface HistoryState { readonly source: string; readonly selection: LogicalSelection }
interface Entry { before: HistoryState; after: HistoryState; group: string | undefined }
/** Root history, shared by all editing surfaces. Group identities are caller-owned. */
export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private grouping = false;
  breakGroup(): void { this.grouping = false; }
  record(before: HistoryState, after: HistoryState, group?: string): void {
    const last = this.past.at(-1);
    if (this.grouping && group !== undefined && last?.group === group) last.after = after;
    else this.past.push({ before, after, group });
    this.future = [];
    this.grouping = true;
  }
  undo(): HistoryState | undefined {
    this.breakGroup();
    const entry = this.past.pop();
    if (!entry) return;
    this.future.push(entry);
    return entry.before;
  }
  redo(): HistoryState | undefined {
    this.breakGroup();
    const entry = this.future.pop();
    if (!entry) return;
    this.past.push(entry);
    return entry.after;
  }
}
