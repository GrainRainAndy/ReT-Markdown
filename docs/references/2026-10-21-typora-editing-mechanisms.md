# Typora 编辑机制：2026-10-21 定向逆向

## 目标与证据边界

目标 `/Applications/Typora.app`，版本 1.14.10（7786）。当前安装包 `TypeMark/appsrc/main.js` SHA-256 仍为 `8e716a084097a976ab9ed8ea06d8f0b505f14a8dc0c022b3dc1a09a741225e16`，与 2026-10-14 保留的提取结果一致。

本轮复用已有 SystemJS 模块定位，重新逐字节验证六个切片与当前安装包对应范围一致，未执行包内 JavaScript，未修改 Typora。REA 仅把六个切片作为文本作静态分析；模块命名和具体方法边界来自本地 Babel AST 定位，不能冒称由 REA 恢复了完整业务语义。

- 切片来源、原文件范围与哈希：`analysis/typora-1.14.10/interaction-audit-20261021/provenance.json`。
- 方法原文与切片内 UTF-16 半开范围：同目录 `selected-methods.json`；完整方法目录 `methods.json`。
- REA parent：`ev_2664bd76530ea8de4fa6903b6d668638dc8abd8835942f84c51f7342b9adfbff`。
- REA summary：`ev_a7eacf536d740874c3d1cd8d94f5219f93d97b0a98077fbc45d7f62824ab9d21`。
- REA Fences module view：`ev_9fc3f68d19ba78e61a972a803f5b7436ad93e128587f3004977494143dc1323a`。
- 完整会话证据导出：同目录 `rea-evidence.json`。导出记录的 unknowns 计数不能替代各分析记录的语义覆盖说明。

REA 解析 6 文件 / 146,295 字节，无解析失败；文件扫描覆盖 complete，但 semantic coverage 为 unknown，保留 10,582 个语义 unknowns，SystemJS 打包模块统计为 0。以下结论来自可定位的静态分支及其保留原文，不代表完整动态调用链或原生时序已经证明。

## 可定位的机制

| 范围 | 静态观察与位置 | 对 ReT 的工程启示 |
| --- | --- | --- |
| 代码块内容与投影 | `Fences.js` `addCodeBlock` [21510,25635)：按节点 ID 缓存块内 CM，初始化值取节点 text；changes 回调更新节点 text 并发送 cmChanges。`syncToNode` [26776,26925) 及构造函数失焦处理再次同步内容。 | 明确块内容、围栏元信息与视觉包装之间的边界；焦点变化不应重新解释代码正文、空行或历史。采用什么编辑器实例数是另一项设计决定。 |
| 块内键盘与跨块交接 | `Fences.js` `onKeyDown` [19342,21510)：首/末行方向键交给外层 selection；空块 Backspace/Delete 调用结构回退；Enter 交给回调检查。`addCodeBlock` 内回调只在 macOS Cmd+Enter、无选区、块尾位置请求插入段落，否则返回块内编辑。 | 为块内换行、块尾退出、空块删除、跨块选区制定不同规则。只验证“输入了 LF”不足以验收代码块。未运行对照前，不把所有平台/选项的实际按键结果当作已知。 |
| 结构操作与撤销 | `addCodeBlock` 删除回退路径先记录 fences-pos，再合并回到段落的操作；`beforeDeleteFences` [28976,29457) 同步最新 text 后清理局部 CM。`UndoManager.js` `undo` [3496,4704) 暂停 brush、执行命令、恢复焦点、同步变更后恢复 brush。 | 撤销必须同时恢复源文、结构、选区和编辑归属，不能仅断言最终字符串；结构动作要有明确事务边界。 |
| 逻辑选区与块内位置 | `Selection.js` `getPosBookmark` [11279,11524) 区分普通节点与 CM，保存 cid 和块内索引；`jumpIntoElemBegin/End` [2481,4449) 对块内 CM 使用 goDocStart/End。 | 渲染坐标、源文范围和块内位置必须显式映射；重绘前保存逻辑位置，交接后验证实际 caret。不能在 DOM 消失后重新用旧盒子猜位置。 |
| 重绘时机 | `Brush.js` `brushQueue` [1236,2310) 在 isIME 或 isMousePressed 时不进入重绘分支；处理前保存选区撤销信息。`pause/resume` 明确控制任务运行。 | IME、拖选、失焦和异步重绘属于状态与生命周期问题，应有统一的调度条件、失效策略和完成门槛，而不是各处追加一个延时。 |
| 源码视图与普通视图 | `SourceView.js` show [5779,7284) 从 getMarkdown 生成源码 CM 内容，并 clearHistory；hide [7890,8948) 含整文 reloadContent 路径。旧版精确切片 Editor 的 getMarkdown [60959 附近] 区分源码 CM 和 nodeMap.toMark。 | Typora 的模型和历史机制不能直接照搬。ReT 要保留原始 Markdown 字节、混合 EOL、BOM 与统一根历史，仍须以源文为权威，用局部补丁完成结构编辑。 |

`Node2Mark.js` [5209,6060) 的 fences 分支还显式处理围栏 pattern、patternEnd、noCloseTag、userIndent、内容行和空行占位。这支持“代码块需要专门的结构与序列化规则”的静态结论；不证明 ReT 应重新序列化整份 Markdown。

## 必须保留的差异

参考 Typora 的行为划分与生命周期约束，不能把它的 NodeMap、DOM、源码视图和局部历史复制成 ReT 的第二套权威状态。ReT 已有的唯一 Source、UTF-16 局部补丁、EOL 元数据和根撤销历史是需求约束；多个语法解析器可以继续存在，但应通过共享语义上下文与一致性样本对齐，不能各自决定互相矛盾的编辑行为。

本轮计划的 Typora 原生夹具对照在用户授权后仍连接超时，暂未取得运行证据；不把以上静态分支等同于已经观察到的用户操作。具体 Enter、连续空行、边界导航、Cmd+Enter 与 IME 时序应逐项补录原生对照，不能由“Typora 大概如此”填充预期。

同日后续[连接排查](../testing/2026-10-21-typora-connection.md)已通过 `/Applications/Typora.app` 精确路径恢复 AX 与截图读取，并保留工作区完整 `Typora.app` 副本。此前超时具体原因未确定；复制后 bundle ID 出现路径歧义，后续连接使用完整路径。此恢复只证明通道可用，不改变以上行为证据仍为静态分析的等级。

同日继续工作已取得[10 条原生操作序列与另 8 模块逆向](2026-10-21-typora-runtime-contracts.md)。前段“尚未运行”是初次静态阶段的历史状态；新表逐条注明哪些参考行为已观察、哪些仍未知，不将全部静态分支统一升级为原生通过。
