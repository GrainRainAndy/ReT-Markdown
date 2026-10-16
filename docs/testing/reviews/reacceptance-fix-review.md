# F07 / F08 修复独立复核

2026-10-16。**最终 Spec：PASS；Quality：PASS，限下列冻结版本及本次修复范围。无未闭合的实际 P2。** 原先发现的 caret 输入错位、生产布局远距离 Find 不滚动、optional edge-pipe 表格 Tab 焦点回流均有独立 RED 与对应关闭证据。此结论不代替主控的新候选构建、独占性能、原生 IME 或完整视觉验收。

本执行者为 Codex，独立读取需求、修复前副本、产品实现和测试证据；未修改产品、既有测试、构建或 app，未使用 Git。仅写本报告及 `build/verification/review-fix-probe*`、`review-viewport-*` 自有 probe/config/log/output。没有重跑整套单测、浏览器基准或性能测试。

## 最终版本与漂移

以下 SHA-256 在最后三个定向 probe **开始前和结束后完全一致**；PASS 只适用于此版本。

| 产品文件 | 最终 SHA-256 |
| --- | --- |
| `web/src/live/decorations.ts` | `0485abf321bcb6aadaa824540ac970e1d1917f98d097193994799af6e3a61fd0` |
| `web/src/live/cell-widget.ts` | `927b6ad2d64a2f4d3279f81ac3e1b9d2430a38d6e0fe265c4cb4a63095382423` |
| `web/src/render/markdown.ts` | `267de82880ae727e0fe9c6758fbbf017754148089450d1e3e62e3015981ecb62` |

首轮读取的 decorations 为 `d74213c7918f88a2971b2ec5d87fa2e5f86371adfb52dc2fa49c5d2b6367a2d7`，markdown 与最终相同。caret RED 阶段读取的 cell-widget 为 `9a4224bed3da8a776c379034fa461635066a855f653bd59264800c0f4ee69ae1`。主控收到发现后有意解冻：cell-widget 先经过 `58ee34e8...`、`fec50f1b...`，再成为最终 `927b6ad2...`；decorations 增加测量续帧后成为最终 `0485abf3...`。已在会话中逐次通知版本变化，旧 RED 不作为最终文件的失败结论。

viewport 自有 probe 在内存捕获三个文件，esbuild `onLoad` 使用捕获内容，并在日志输出完整 `VIEWPORT_BUNDLED_HASHES`；产品 bundle 使用 `write:false`。最终 viewport 三项使用最终 decorations/markdown 与中间 cell-widget `58ee34e8...`；随后 cell-widget 的焦点保护和 explicit-exit 状态已单独复核，均不改变 scroll effect、布局或测量调度。最后三个 caret/Tab probe 使用本表全部最终文件。

## 发现与关闭证据

### R1：展开后的跨 cell 选区收缩为 caret，键入落到表格外 — 已关闭

复现文本：

```markdown
before😀

| A | B |
| --- | ---: |
| left | right |

after
```

查找 `left | right`，返回编辑器后 ArrowLeft、键入 `X`。旧行为：根 caret 为 UTF-16 offset 37，widget 已重建、mini 数量为 0；键入后变成 `Xafter`，表格内容未变。命令路径与真实面板 Enter → Escape 路径均复现。加载产品 typography/palette 后仍失败，属于实际产品缺陷。

最终 `TableController.projectSelection()` 保留非空根选区逻辑，仅允许 **root 拥有焦点**时把空 caret 投射到 mini；先映射 mini selection，再转移键盘焦点。因此面板 focus 和已拥有焦点的 mini selection 不被空根 caret 覆盖。主控中间版本曾遇到 L3 undo 与 L4 composition/cut 回退，现焦点条件已针对该原因收紧；复核读取了相应 GREEN 日志，没有把中间版本当作最终通过。

独立最终复跑两个路径均得到 `| Xleft | right |`，mini=1、rootFocus=false，输入 offset 从 37 正确前进到 38。证据：[`review-fix-probe-final3.log`](../../../build/verification/review-fix-probe-final3.log)。原 RED：[`review-fix-probe-confirm.log`](../../../build/verification/review-fix-probe-confirm.log)、[`review-fix-probe-styled.log`](../../../build/verification/review-fix-probe-styled.log)。

### R2：远距离 Find 展开源文后未滚入视口 — 已关闭

必须区分两组证据：

- **最初不完整 harness**：100 段前文，无产品 CSS、body 默认 8px margin。Find 选区和 DOM 已正确，但命中仍在 y≈3858。补齐产品样式后，同一 100 段例通过；仅将 body margin 置 0 也能通过。因此这一个旧 bare 失败，单独不足以证明生产页面失败。
- **有效生产条件 RED**：加入 `<!doctype html>`、实际 `typography.css`/`palette.css`，使用 1280×720 viewport。80、160、200 段前文仍稳定失败，100/120/300 段对照通过。80 段命中 y≈2897.70；selection 为 `[737,741]`，window.scrollY=0，pending scroll head=741。该证据排除了“只是未加载样式”的解释。完整记录：[`review-viewport-product-lengths.log`](../../../build/verification/review-viewport-product-lengths.log)，3 FAIL / 3 PASS。

数据流诊断：

1. CM 收到 `select.search` 的正确 selection 与 scroll effect；查找、源文展开和匹配 DOM 本身没有丢失。
2. live 段落/隐藏 gap 布局的高度估计逐轮更新，viewport.from 连续向前扩展。80 段依次为 521→422→376→350→340→332→323，scroll target 一直保留。
3. 当前 `@codemirror/view/dist/index.js` 的 `EditorView.measure()` 在 `i>5` 分支警告 `Viewport failed to stabilize` 并退出；尚未执行 `DocView.scrollIntoView()`。失败 trace **没有** `window.scrollBy` 调用，且之后没有自动续测消费 pending target。
4. `.cm-scroller` 为 relative/overflow auto，但其 scrollHeight 与 clientHeight 相等；editor/main/body 的祖先链没有 fixed/sticky 阻断，body/html overflow visible。查找面板不是命中节点的滚动祖先。不是祖先 overflow 截断，也不是已执行的 window 滚动被重置。
5. 相同 80 段文档的 source 模式正常。仅在诊断 probe 中，于失败后调用一次公开 `view.requestMeasure()`，80/160 两例即消费原 scroll target 并调用 `window.scrollBy`，命中进入视口；未修改源文或产品。见 [`review-viewport-dataflow.log`](../../../build/verification/review-viewport-dataflow.log) 与 [`review-viewport-recovery.log`](../../../build/verification/review-viewport-recovery.log)。

最终修复使用 `EditorView.updateListener`，只在 live 的 `select.search` 更新后排 RAF，再调用公开 `requestMeasure()`。读取当前 CM 调用顺序确认：updateListener 在 CM 自己安排测量之后执行；不会遇到直接在 ViewPlugin.update 中排 RAF、反而早于 CM 初次测量而被合并的问题。callback 检查 DOM connected、selection.eq、live mode、非 composition；没有新 transaction、直接 scroll、私有字段访问或 layout 修改。

独立最终 80/160/200 三例 **3/3 PASS**（1.7s），且 probe 没有调用手工 recovery。pending target 均清空，window.scrollBy 分别约为 2200.70、7089.11、8292.02；命中顶部约 696.7–697.1px，在 720px viewport 内。证据：[`review-viewport-final.log`](../../../build/verification/review-viewport-final.log)。首轮测量仍可能打印 bounded-loop warning，但追加帧已完成实际滚动；不将该 warning 隐藏或等同于未修复。

### R3：无外侧 pipe 的表格，Tab 退出被空 caret 投射拉回 mini — 已关闭

有效 GFM 输入：

```markdown
before

A | B
--- | ---
left | right

after
```

中间实现只限制 parent.hasFocus，仍不足：首格 Shift+Tab 后 root caret=8，末格 Tab 后 caret=36，正好等于 cell.from/to。`exit()` 先聚焦 root，下一次 selection projection 又选中边界 cell 并抢回 mini。两个方向 rootFocus=false，分别停留在 Row 1 column 1 / Row 2 column 2。即使使用完整产品样式与 doctype 仍失败。RED：[`review-fix-probe-final2.log`](../../../build/verification/review-fix-probe-final2.log)，2 PASS / 1 FAIL。

最终 UI 局部状态 `exitPosition` 在 exit 前记录锚点；同一显式退出位置不参与空 caret 交接。非空 selection、caret 位置改变或显式 cell focus 清除它。该状态不进入 source/history；raw selection 展开后重新创建的 widget 初始为 -1，仍允许首次在 pipe-less header 边界接管 caret。因此它区分的是显式退出意图，而非一律禁止表格端点交接。

独立最终测试两个方向均 rootFocus=true，位置仍为 8/36，源文不变、commits=0；同时 R1 两条路径继续通过。最终三个 probe **3/3 PASS**（1.5s），见 `review-fix-probe-final3.log`。已读取主控 durable 的 no edge/no leading/no trailing pipe 三类及 pipe-less header collapse 测试与 `reacceptance-focus-exit-green.log`（L3/L4 + 18 个 F07，共20 PASS）；未重复运行该组合。

## F08 / Quality 核对

| 检查项 | 结论与证据 |
| --- | --- |
| math 完整上下文 | PASS。math 加入 document identity 缓存；Map 同时索引 block token 与 inline children 中的 image/math，准确复用已去除 quote/list 前缀的 token；非命中仍走原 fallback。 |
| 容器与坐标 | 自有矩阵109例通过：quote、quoted list、list quote、ordered quote/list、nested quote/list；LF/CRLF/CR、astral Unicode、无效与未闭合 math、重复请求范围、image/reference/link 对照。range issues 与完整 renderer 一致，重复请求互不污染。 |
| 安全渲染 | 自有 probe 检查未生成注入的 a/img/script/svg/onload/htmlClass；仍使用原 math renderer 的 trust=false、throwOnError/maxExpand/maxSize 与错误源文 HTML escape。远程图片保持 placeholder。5个负数/非整数/无穷/倒置/越界 range 均拒绝。 |
| 索引复杂度 | 新索引构建 O(T)、范围查找 O(R)，未新增逐 range 扫全 token 的平方循环。此处不把解析和 KaTeX 成本算作 O(1)：仅 math 文档新增一次完整 md.parse，真实端到端预算由主控性能测试判定。 |
| table selection / history | 跨行、跨 cell、反向及表格边界选区展开；回到单 cell 恢复 mini selection；源文 projection 无 commit。自有 composition+separator find 保持 marked mini DOM 到合成结束，随后展开，一次 root undo 恢复字节。该 composition 证据是 synthetic Chromium，不是真实输入法。 |
| Tab / mini lifecycle | 有外侧 pipe 的退出、输入与 root undo 在自有 probe 通过；无外侧 pipe 的最终退出另有上述最新3项证明。empty caret 交接只在 root focus 时进行，不覆盖 mini 当前 selection；保留 observer 的微任务、dead/composition 防护和 syncing。 |
| 续帧成本 | 只对 select.search 排有限的一次回调，普通文本输入不触发；requestMeasure 可合并已有请求，没有新增解析循环或历史事务。选择已变化/非live/composition/DOM已移除时跳过。 |

math 矩阵最后一次实际运行记录在 [`review-fix-probe-final.log`](../../../build/verification/review-fix-probe-final.log)，`MATH_MATRIX {cases:109,rejected:5,failures:[]}`。该运行还确认原 caret、反向选区、合成期间 Find、带 pipe 的 Tab/undo、生产样式长文 Find；当时8项为7 PASS / 1 FAIL，唯一 FAIL 是后来关闭的 R3，不应把旧总计写成全绿。markdown 自复核开始未发生变化。

## 复跑入口与证据归属

自有 probe 的最终配置为产品 styles + doctype。可定向重放，不需要重跑整套：

```sh
node node_modules/playwright/cli.js test --config=build/verification/review-fix-probe.config.ts --grep 'caret after|real search panel|optional edge pipes'
RET_REVIEW_VIEWPORT_LENGTHS=80,160,200 node node_modules/playwright/cli.js test --config=build/verification/review-viewport-probe.config.ts
```

原始失败日志均保留。`review-fix-probe.log` 的首次 Chromium SIGABRT 属沙箱启动失败，不计产品 RED；获准沙箱外执行后的日志才有产品断言证据。没有使用原生 UI 工具，未将 native pipe 故障作为通过或产品缺陷。

主控报告的最终95/95 browser、298 unit / 1 skip、typecheck PASS及新候选构建属于主控执行证据；本执行者没有重复跑这些任务。独立结论基于本报告明确列出的源码审查、定向运行和读取的 durable 证据，不将正在构建的 candidate 宣称已验收。

**交付状态：全部自有 probe 进程已退出，无剩余 probe/测试任务；本报告写入后停止测试与写入。根控制器可独占构建/性能。**
