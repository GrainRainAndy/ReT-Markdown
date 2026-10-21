import "./styles.css";
import { DocumentSession } from "./core/document";
import type { Patch } from "./core/types";
import { HostBridge, type Envelope, type RecoveryDraft } from "./protocol/host";
import { RichSurface } from "./surfaces/rich";
import { LiteralEditor } from "./surfaces/literal";
import {
  logical,
  replaceIntent,
  minimalPatch,
  type Intent,
} from "./surfaces/editing";
import { mapText } from "./syntax/mapping";
import { renderDocument } from "./render/document";
const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML =
  '<div id="notice" role="alert" hidden></div><section id="workspace" aria-label="文稿"></section><footer><span id="status" role="status"></span><button id="mode" title="切换源码（⌘⇧M）">源码</button></footer><section id="recovery" role="dialog" aria-label="恢复未提交输入" hidden><h2>恢复未提交输入</h2><p id="recovery-reason"></p><details><summary>原始输入草稿</summary><pre id="draft-content"></pre></details><label>待应用的完整 Markdown<textarea id="recovery-source" spellcheck="false"></textarea></label><button id="recover-apply">应用恢复文本</button><button id="recover-discard">放弃未提交草稿</button></section>';
const workspace = document.querySelector<HTMLElement>("#workspace")!,
  status = document.querySelector<HTMLElement>("#status")!,
  modeButton = document.querySelector<HTMLButtonElement>("#mode")!,
  recoveryPanel = document.querySelector<HTMLElement>("#recovery")!,
  recoveryText =
    document.querySelector<HTMLTextAreaElement>("#recovery-source")!;
let session = new DocumentSession(""),
  baseline = 0,
  mode: "rich" | "source" = "rich",
  rich: RichSurface | undefined,
  literal: LiteralEditor | undefined,
  composing = false,
  draft: RecoveryDraft | null = null,
  resolving = false,
  lastRevision = 0,
  unsubscribe: (() => void) | undefined;
let queued: string[] = [];
let received = 0,
  durable = 0;
let fileName = "未命名.md";
const host = new HostBridge(receive);
function notice(text: string): void {
  const node = document.querySelector<HTMLElement>("#notice")!;
  node.textContent = text;
  node.hidden = !text;
}
function revision(): number {
  return baseline + session.revision;
}
function updateStatus(): void {
  status.textContent = `${draft ? "输入待恢复" : composing ? "正在输入" : session.dirty ? "未保存" : "已保存基线"} · ${mode === "rich" ? "实时" : "源码"} · ${session.source.length} 字符${host.native ? (durable >= revision() ? " · 已持久恢复" : received >= revision() ? " · 已接收" : "") : " · 浏览器内存文稿"}`;
  modeButton.textContent = mode === "rich" ? "源码" : "实时";
}
function composition(active: boolean): void {
  composing = active;
  updateStatus();
  if (!active) {
    const pending = queued;
    queued = [];
    for (const command of pending) execute(command);
  }
}
function recover(
  content: string,
  format: "text" | "prosemirror-json",
  reason: string,
  recoverySource?: string,
): void {
  draft = {
    baseRevision: revision(),
    owner: session.selection.owner.kind,
    format,
    content,
    reason,
    ...(recoverySource !== undefined ? { recoverySource } : {}),
  };
  host.send("recoveryDraft", { draft });
  showRecovery();
}
function showRecovery(): void {
  recoveryPanel.hidden = !draft;
  workspace.inert = !!draft;
  if (!draft) return;
  document.querySelector("#recovery-reason")!.textContent = draft.reason;
  document.querySelector("#draft-content")!.textContent = draft.content;
  recoveryText.value = draft.recoverySource ?? session.source;
  updateStatus();
}
function apply(intent: Intent, group?: string): void {
  if (draft && !resolving) {
    notice("请先恢复或放弃未提交输入");
    return;
  }
  try {
    session.apply(intent.patches, intent.selection, group);
    refresh(intent.patches.length === 1 ? intent.patches[0] : undefined);
  } catch (error) {
    const patch = intent.patches.length === 1 ? intent.patches[0] : undefined;
    recover(
      JSON.stringify(intent),
      "text",
      String(error),
      patch
        ? session.source.slice(0, patch.from) +
            patch.insert +
            session.source.slice(patch.to)
        : undefined,
    );
  }
}
function refresh(patch?: Patch): void {
  if (mode === "rich") rich?.refresh(patch);
  else
    literal?.refresh(
      session.selection.anchor.offset,
      session.selection.head.offset,
    );
  updateStatus();
}
function mount(focus = false): void {
  rich?.destroy();
  rich = undefined;
  literal?.destroy();
  literal = undefined;
  workspace.replaceChildren();
  if (mode === "rich") {
    workspace.className = "rich-surface";
    rich = new RichSurface(workspace, {
      session,
      apply,
      command: execute,
      composition,
      recover,
      notice,
    });
    if (focus) rich.focus();
  } else {
    workspace.className = "source-surface";
    literal = new LiteralEditor(workspace, {
      label: "Markdown 源码",
      source: () => session.source,
      range: () => mapText(session.source, 0),
      change: (patch, anchor, head) =>
        apply(
          {
            patches: [patch],
            selection: logical(anchor, head, { kind: "source" }),
          },
          "source-typing",
        ),
      select: (anchor, head) =>
        session.setSelection(logical(anchor, head, { kind: "source" })),
      command: execute,
      composition,
      failure: (content, error) =>
        recover(content, "text", String(error), content),
    });
    literal.refresh(
      session.selection.anchor.offset,
      session.selection.head.offset,
    );
    if (focus) literal.focus();
  }
  updateStatus();
}
function load(payload: Record<string, unknown>): void {
  if (composing || draft) {
    notice("当前输入尚未提交，拒绝替换文稿");
    return;
  }
  unsubscribe?.();
  session = new DocumentSession(String(payload.source ?? ""));
  baseline = Number(payload.revision) || 0;
  lastRevision = 0;
  received = baseline;
  durable = -1;
  session.markSaved(
    typeof payload.savedSource === "string"
      ? payload.savedSource
      : session.source,
  );
  fileName = String(payload.displayName ?? "未命名.md");
  document.title = fileName;
  appearance(String(payload.appearance ?? "system"));
  mode = "rich";
  draft =
    payload.recoveryDraft && typeof payload.recoveryDraft === "object"
      ? (payload.recoveryDraft as RecoveryDraft)
      : null;
  unsubscribe = session.subscribe((snapshot) => {
    if (snapshot.revision !== lastRevision) {
      lastRevision = snapshot.revision;
      host.send("checkpoint", {
        source: snapshot.source,
        revision: revision(),
        dirty: snapshot.dirty,
        ...(resolving ? { resolvesRecoveryDraft: true } : {}),
      });
    }
    updateStatus();
  });
  mount();
  showRecovery();
}
function appearance(mode: string): void {
  document.documentElement.dataset.appearance = ["light", "dark"].includes(mode)
    ? mode
    : "system";
}
function receive(message: Envelope): void {
  const p = message.payload;
  switch (message.method) {
    case "load":
      load(p);
      break;
    case "command":
      if (typeof p.id === "string") execute(p.id);
      break;
    case "flush":
      host.send(
        "flushResult",
        composing || draft
          ? {
              status: "pending",
              reason: draft ? "recovery-draft" : "composition",
            }
          : { status: "ready", source: session.source, revision: revision() },
        message.requestId,
      );
      break;
    case "saved":
      if (
        typeof p.source === "string" &&
        typeof p.revision === "number" &&
        p.revision <= revision()
      )
        session.markSaved(p.source);
      break;
    case "checkpointAck":
      if (typeof p.revision === "number" && p.revision <= revision()) {
        if (p.stage === "received") received = Math.max(received, p.revision);
        if (p.stage === "durable") durable = Math.max(durable, p.revision);
        updateStatus();
      }
      break;
    case "appearance":
      appearance(String(p.mode));
      break;
    case "error":
      notice(String(p.message ?? "操作失败"));
      break;
    case "prepareExport": {
      const source = typeof p.source === "string" ? p.source : session.source;
      const frozen = typeof p.revision === "number" ? p.revision : revision();
      host.send(
        "exportContent",
        { html: renderDocument(source), revision: frozen },
        message.requestId,
      );
      break;
    }
  }
}
function execute(id: string): void {
  if (composing) {
    if (!queued.includes(id)) queued.push(id);
    notice("等待输入法提交后执行");
    return;
  }
  if (draft) {
    notice("请先恢复或放弃未提交输入");
    return;
  }
  if (id === "toggleSource") {
    mode = mode === "rich" ? "source" : "rich";
    mount(true);
    return;
  }
  if (id === "undo" || id === "redo") {
    session[id]();
    const owner = session.selection.owner.kind;
    if (owner === "source" && mode !== "source") {
      mode = "source";
      mount(true);
    } else {
      if (owner !== "source" && mode === "source") {
        mode = "rich";
        mount(true);
      } else {
        refresh();
        rich?.focus();
        literal?.focus();
      }
    }
    return;
  }
  if (["save", "saveAs", "open", "new", "exportPDF"].includes(id)) {
    if (host.native) {
      host.send(id, {});
      return;
    }
    if (id === "save" || id === "saveAs") {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([session.source], { type: "text/markdown;charset=utf-8" }),
      );
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(link.href);
      notice("已请求下载；浏览器无法确认文件已保存");
    } else if (id === "new") {
      load({ source: "", revision: 0 });
    } else if (id === "open") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".md,.markdown,.txt";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (file)
          load({
            source: await file.text(),
            revision: 0,
            displayName: file.name,
          });
      };
      input.click();
    } else notice("PDF 导出需要 macOS 宿主");
    return;
  }
  if (id === "bold" || id === "italic") {
    if (
      session.selection.owner.kind === "code" ||
      session.selection.owner.kind === "math"
    ) {
      notice("字面编辑区域不应用格式命令");
      return;
    }
    const s = session.selection,
      a = Math.min(s.anchor.offset, s.head.offset),
      b = Math.max(s.anchor.offset, s.head.offset),
      delimiter = id === "bold" ? "**" : "*";
    apply({
      patches: [
        {
          from: a,
          to: b,
          insert: delimiter + session.source.slice(a, b) + delimiter,
        },
      ],
      selection: logical(a + delimiter.length, b + delimiter.length),
    });
    rich?.focus();
    return;
  }
  notice("此命令将在后续结构工作流中接通");
}
modeButton.onclick = () => execute("toggleSource");
document.querySelector<HTMLButtonElement>("#recover-apply")!.onclick = () => {
  if (!draft) return;
  const patch = minimalPatch(session.source, recoveryText.value);
  resolving = true;
  try {
    session.apply([patch], logical(recoveryText.value.length));
    if (patch.from === patch.to && !patch.insert)
      host.send("recoveryDraft", { draft: null });
    draft = null;
    showRecovery();
    mount(true);
  } catch (error) {
    notice(String(error));
  } finally {
    resolving = false;
    updateStatus();
  }
};
document.querySelector<HTMLButtonElement>("#recover-discard")!.onclick = () => {
  draft = null;
  host.send("recoveryDraft", { draft: null });
  showRecovery();
  mount(true);
};
document.addEventListener("keydown", (event) => {
  if (event.isComposing || composing) return;
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  let id: string | undefined;
  if (key === "s") id = event.shiftKey ? "saveAs" : "save";
  if (key === "m" && event.shiftKey) id = "toggleSource";
  if (key === "o") id = "open";
  if (key === "f") id = event.altKey ? "replace" : "find";
  if (id) {
    event.preventDefault();
    execute(id);
  }
});
if (host.native) host.start();
else load({ source: "", revision: 0, appearance: "system" });
