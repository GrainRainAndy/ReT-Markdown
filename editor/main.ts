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
import {
  renderSourceDocument,
  assetURL,
  collectAssetReferences,
  setAssetCapability,
  getAssetCapability,
} from "./render/document";
import {
  headingIntent,
  markIntent,
  blockIntent,
  tableIntent,
  containing,
  mapOffset,
} from "./surfaces/commands";
import { renderer } from "./render/client";
import { FindPanel } from "./surfaces/find";
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
let mountGeneration = 0;
let exportRequest:
  | {
      abort: AbortController;
      documentId: string;
      epoch: string;
      requestId: string;
    }
  | undefined;
let queued: string[] = [];
let queuedAssets: Envelope[] = [];
let received = 0,
  durable = 0;
let fileName = "未命名.md";
const imageRequests = new Map<string, { anchor: number; head: number }>();
const host = new HostBridge(receive, () => {
  if (!composing && !draft) return true;
  notice("当前输入尚未提交，拒绝替换文稿");
  return false;
});
const find = new FindPanel(
  app,
  () => session,
  (selection) => {
    session.setSelection(selection);
    if (mode !== "source") {
      mode = "source";
      mount();
    } else refresh();
    literal?.view.dispatch({ effects: [], scrollIntoView: true });
  },
  (intent) => {
    if (mode !== "source") {
      mode = "source";
      mount();
    }
    apply(intent);
  },
);
function ask(
  label: string,
  value: string,
  accept: (value: string) => void,
): void {
  const dialog = document.createElement("dialog");
  dialog.className = "command-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("label");
  title.textContent = label;
  const input = document.createElement("input");
  input.value = value;
  input.setAttribute("aria-label", label);
  title.append(input);
  const ok = document.createElement("button");
  ok.textContent = "应用";
  ok.type = "submit";
  const cancel = document.createElement("button");
  cancel.textContent = "取消";
  cancel.type = "button";
  cancel.onclick = () => dialog.close();
  form.append(title, ok, cancel);
  form.onsubmit = (e) => {
    e.preventDefault();
    const value = input.value;
    dialog.close();
    dialog.remove();
    accept(value);
  };
  dialog.append(form);
  app.append(dialog);
  dialog.onclose = () => dialog.remove();
  dialog.showModal();
  input.focus();
  input.select();
}
function importImage(file?: File, source?: "clipboard"): void {
  if (!host.native) {
    notice("图片导入需要 macOS 文稿宿主");
    return;
  }
  const bookmark = {
    anchor: session.selection.anchor.offset,
    head: session.selection.head.offset,
  };
  const id = "asset-" + crypto.randomUUID();
  imageRequests.set(id, bookmark);
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      if (imageRequests.has(id))
        host.send(
          "importImage",
          { dataURL: String(reader.result), fileName: file.name },
          id,
        );
    };
    reader.onerror = () => {
      imageRequests.delete(id);
      notice("无法读取剪贴板图片");
    };
    reader.readAsDataURL(file);
  } else host.send("importImage", source ? { source } : {}, id);
}
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
    const assets = queuedAssets;
    queuedAssets = [];
    for (const asset of assets) receive(asset);
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
    for (const entry of imageRequests.values()) {
      entry.anchor = mapOffset(entry.anchor, intent.patches);
      entry.head = mapOffset(entry.head, intent.patches);
    }
    find.update();
    refresh(intent.patches);
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
function refresh(patch?: Patch | readonly Patch[]): void {
  if (mode === "rich") rich?.refresh(patch);
  else
    literal?.refresh(
      session.selection.anchor.offset,
      session.selection.head.offset,
    );
  updateStatus();
}
function mount(focus = false): void {
  mountGeneration++;
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
      image: importImage,
    });
    if (focus) rich.focus();
  } else {
    workspace.className = "source-surface";
    literal = new LiteralEditor(workspace, {
      label: "Markdown 源码",
      markdown: true,
      image: importImage,
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
  setAssetCapability(
    typeof payload.assetToken === "string" ? payload.assetToken : "document",
  );
  unsubscribe?.();
  exportRequest?.abort.abort();
  exportRequest = undefined;
  imageRequests.clear();
  session = new DocumentSession(String(payload.source ?? ""));
  session.setSelection(logical(session.source.startsWith("\uFEFF") ? 1 : 0));
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
      imageRequests.clear();
      queuedAssets = [];
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
    case "assetResult": {
      if (composing || draft) {
        queuedAssets.push(message);
        break;
      }
      if (p.requestId !== undefined && p.requestId !== message.requestId) break;
      const id = message.requestId,
        bookmark = imageRequests.get(id);
      if (!bookmark) break;
      imageRequests.delete(id);
      if (p.error) {
        notice(String(p.error));
        break;
      }
      const path = typeof p.relativePath === "string" ? p.relativePath : "";
      if (!assetURL(path.split("/").map(encodeURIComponent).join("/"))) {
        notice("图片路径无效");
        break;
      }
      apply(
        replaceIntent(
          Math.min(bookmark.anchor, bookmark.head),
          Math.max(bookmark.anchor, bookmark.head),
          "![图片](" + path.split("/").map(encodeURIComponent).join("/") + ")",
        ),
      );
      break;
    }
    case "appearance":
      appearance(String(p.mode));
      break;
    case "error":
      notice(String(p.message ?? "操作失败"));
      break;
    case "collectAssets": {
      if (typeof p.source === "string" && typeof p.revision === "number")
        host.send(
          "assetManifest",
          { paths: collectAssetReferences(p.source), revision: p.revision },
          message.requestId,
        );
      break;
    }
    case "prepareExport": {
      const source = typeof p.source === "string" ? p.source : session.source;
      const frozen = typeof p.revision === "number" ? p.revision : revision();
      exportRequest?.abort.abort();
      const request = {
        abort: new AbortController(),
        documentId: host.documentId,
        epoch: host.epoch,
        requestId: message.requestId,
      };
      exportRequest = request;
      void renderer
        .run(
          { kind: "document", source, assetToken: getAssetCapability() },
          request.abort.signal,
        )
        .then((result) => {
          if (
            exportRequest !== request ||
            request.abort.signal.aborted ||
            host.documentId !== request.documentId ||
            host.epoch !== request.epoch
          )
            return;
          exportRequest = undefined;
          host.send(
            "exportContent",
            {
              html:
                result.status === "ready"
                  ? result.html
                  : renderSourceDocument(source, result.status),
              revision: frozen,
            },
            message.requestId,
          );
        });
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
  if (id === "find" || id === "replace") {
    find.open(id === "replace");
    return;
  }
  if (mode === "rich") rich?.captureSelection();
  if (id === "toggleSource") {
    const viewport =
      mode === "rich" ? rich?.viewportBookmark() : literal?.viewportBookmark();
    mode = mode === "rich" ? "source" : "rich";
    mount(true);
    if (viewport) {
      const generation = mountGeneration,
        atRevision = session.revision;
      if (mode === "source") literal?.revealOffset(viewport.offset);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (generation !== mountGeneration || atRevision !== session.revision)
            return;
          const coords =
            mode === "rich"
              ? rich?.coordinatesAt(viewport.offset)
              : literal?.coordinatesAt(viewport.offset);
          if (coords) window.scrollBy(0, coords.top - viewport.top);
        }),
      );
    }
    return;
  }
  if (id === "undo" || id === "redo") {
    imageRequests.clear();
    session[id]();
    find.update();
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
  if (id === "pasteImage") {
    importImage(undefined, "clipboard");
    return;
  }
  if (id === "insertImage") {
    importImage();
    return;
  }
  if (id === "copyPlain" || id === "copyRich" || id === "copyMarkdown") {
    const copyMode =
      id === "copyPlain" ? "plain" : id === "copyRich" ? "rich" : "markdown";
    if (mode === "source") {
      if (!literal?.copy(copyMode)) notice("拷贝未完成，请使用系统拷贝快捷键");
    } else rich?.copy(copyMode);
    return;
  }
  if (id === "tableSelectCells") {
    rich?.selectCells();
    return;
  }
  if (id.startsWith("table")) {
    const operation = (
      {
        tableAddRow: "addRow",
        tableDeleteRow: "deleteRow",
        tableAddColumn: "addColumn",
        tableDeleteColumn: "deleteColumn",
        tableAlignLeft: "alignLeft",
        tableAlignCenter: "alignCenter",
        tableAlignRight: "alignRight",
      } as Record<string, string>
    )[id];
    if (operation) {
      const intent = tableIntent(session.source, session.selection, operation);
      if (intent) {
        apply(intent);
        rich?.focus();
      }
      return;
    }
  }
  if (id === "codeLanguage") {
    const node = containing(
      session.source,
      session.selection.head.offset,
      "code",
    );
    if (!node?.attributes.fence) {
      notice("只有围栏代码块具有语言标记");
      return;
    }
    const match = /^([`~]+)([^\r\n]*)/.exec(node.raw)!;
    const bookmark = session.selection,
      openedRevision = session.revision;
    ask("代码语言", String(node.attributes.lang ?? ""), (value) => {
      if (session.revision !== openedRevision) {
        notice("文稿已改变，请重新打开代码语言设置");
        return;
      }
      if (/[\r\n`~]/.test(value)) {
        notice("语言标记不能包含换行或围栏字符");
        return;
      }
      const info = match[2]!,
        oldLang = String(node.attributes.lang ?? ""),
        leading = /^\s*/.exec(info)![0],
        meta = oldLang ? info.slice(leading.length + oldLang.length) : "";
      const patch = {
        from: node.from + match[1]!.length,
        to: node.from + match[0].length,
        insert: leading + value + meta,
      };
      apply({
        patches: [patch],
        selection: {
          ...bookmark,
          anchor: {
            ...bookmark.anchor,
            offset: mapOffset(bookmark.anchor.offset, [patch]),
          },
          head: {
            ...bookmark.head,
            offset: mapOffset(bookmark.head.offset, [patch]),
          },
        },
      });
      rich?.focus();
    });
    return;
  }
  if (id === "inlineMathSource") {
    const node = containing(
      session.source,
      session.selection.head.offset,
      "inlineMath",
    );
    if (node)
      ask("行内公式源码", node.text ?? "", (value) => {
        if (/[\r\n]/.test(value)) {
          notice("行内公式不支持换行");
          return;
        }
        apply(replaceIntent(node.mapping.from, node.mapping.to, value));
        rich?.focus();
      });
    return;
  }
  if (
    session.selection.owner.kind === "code" ||
    session.selection.owner.kind === "math"
  ) {
    notice("字面编辑区域不应用 Markdown 结构命令");
    return;
  }
  if (
    id === "bold" ||
    id === "italic" ||
    id === "strike" ||
    id === "inlineCode"
  ) {
    apply(
      markIntent(
        session.source,
        session.selection,
        id === "bold"
          ? "strong"
          : id === "italic"
            ? "emphasis"
            : id === "strike"
              ? "delete"
              : "inlineCode",
      ),
    );
    rich?.focus();
    return;
  }
  if (/^heading[1-6]$/.test(id)) {
    const intent = headingIntent(
      session.source,
      session.selection,
      Number(id.slice(-1)),
    );
    if (intent) apply(intent);
    rich?.focus();
    return;
  }
  if (
    [
      "bulletList",
      "orderedList",
      "quote",
      "codeBlock",
      "mathBlock",
      "table",
    ].includes(id)
  ) {
    const intent = blockIntent(session.source, session.selection, id);
    if (intent) apply(intent);
    rich?.focus();
    return;
  }
  if (id === "link") {
    const selection = session.selection;
    ask("链接地址", "https://", (value) => {
      const a = Math.min(selection.anchor.offset, selection.head.offset),
        b = Math.max(selection.anchor.offset, selection.head.offset);
      apply(
        replaceIntent(
          a,
          b,
          "[" +
            (session.source.slice(a, b) || "链接") +
            "](" +
            value.replace(/[\r\n]/g, "").replace(/[()]/g, "\\$&") +
            ")",
        ),
      );
      rich?.focus();
    });
    return;
  }
  notice("当前位置不支持该命令");
}
workspace.addEventListener("contextmenu", (event) => {
  if (composing || draft) return;
  event.preventDefault();
  rich?.captureSelection();
  document.querySelector(".context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  menu.style.left = Math.min(event.clientX, window.innerWidth - 210) + "px";
  menu.style.top = Math.min(event.clientY, window.innerHeight - 350) + "px";
  const actions = [
    ["加粗", "bold"],
    ["斜体", "italic"],
    ["拷贝纯文本", "copyPlain"],
    ["拷贝富文本", "copyRich"],
    ["选取单元格区域", "tableSelectCells"],
    ["插入行", "tableAddRow"],
    ["删除行", "tableDeleteRow"],
    ["插入列", "tableAddColumn"],
    ["删除列", "tableDeleteColumn"],
    ["靠左对齐", "tableAlignLeft"],
    ["居中对齐", "tableAlignCenter"],
    ["靠右对齐", "tableAlignRight"],
  ];
  for (const [label, id] of actions) {
    const button = document.createElement("button");
    button.textContent = label!;
    button.setAttribute("role", "menuitem");
    button.onclick = () => {
      menu.remove();
      execute(id!);
    };
    menu.append(button);
  }
  app.append(menu);
  menu.querySelector("button")?.focus();
  menu.onkeydown = (e) => {
    if (e.key === "Escape") {
      menu.remove();
      rich?.focus();
    }
  };
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menu.contains(e.target as Node)) menu.remove();
    },
    { once: true },
  );
});
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
