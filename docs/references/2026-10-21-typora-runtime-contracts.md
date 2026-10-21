# Typora 运行对照与交互契约

2026-10-21，Typora 1.14.10（7786）。通过 Computer Use 精确连接 `/Applications/Typora.app`，工作区 `Typora.app` 仅作静态参考。所有操作在 `build/verification/0.1.0-rc.1/interaction-audit-20261021/continuation/typora-fixtures/` 自有文稿中完成；原始字节与最终 SHA-256 均保留。

## 原生观测

实际步骤、原文、字节快照与哈希见 `continuation/typora-native-cases.json`。下表只概括已观察到的样本；截图位于本次 Computer Use 对话记录，没有导出图片或注入 Typora JavaScript。

| Case | 操作与实际结果 | 给 ReT 的约束 |
| --- | --- | --- |
| TY-01 | 闭合代码块 alpha 后 Enter，只增加一个 LF；点击 tail 后两行空白仍在代码面板。块外 Undo 一次恢复原始内容并回到块内焦点。 | 同时检查正文换行、失焦布局及撤销后编辑归属。 |
| TY-02 | 代码 CM 块尾 Cmd+Enter，插入块后的空段落，光标在代码面板外；不向代码内部追加普通正文。一次 Undo 恢复。 | 明确普通 Enter 与结构退出操作的区别，不凭连续空行猜测用户要退出。 |
| TY-03 | 空代码 CM 首位 Backspace，空围栏转换为空段落；Undo 恢复围栏、语言和编辑位置。 | 空块删除是结构操作，不能只删除一个隐藏字符。 |
| TY-04 | 未闭合代码围栏 EOF Enter，新增空行仍在代码面板；点击 lead 后保留。保存只增加一个 LF，没有补关闭围栏。Undo 恢复。 | EOF 空行仍有代码归属；投影与按键处理必须使用一致边界。原生仅视觉确认面板，不提供精确 CSS 像素结论。 |
| TY-05 | `AlphaBeta` 在 Alpha 后 Enter，保存为两段；立即 Backspace 一次，直接合并为 `AlphaBeta`，原始字节恢复。 | 可将“实时段首退格合并段落”作为这一边界的目标契约，不将 Backspace 一概等同 Undo。 |
| TY-06 | 数学 `- x` 后 Enter，再输入 y，保存数学正文为 `- x\ny`，没有自动 `- `。单独 Enter 的尾部空行在 CM 可见，但保存后被数学序列化消去；两次 Undo 恢复视图。 | 数学内容先归为字面输入；ReT 按自身源文保留规则持久化用户换行，不照搬 Typora 的尾部规范化。 |
| TY-07 | 数学 CM 中定位 x 前，Backspace 只删除空格，保存为 `-x`；负号未删除，Undo 恢复。 | 默认 Markdown 删除逻辑不得接管数学内容。 |
| TY-08 | 有序列表 parent 按 Tab，成为 previous 下级；本样本还重编号，并把原 child 改为 parent 的同级有序项。Undo 恢复原文与原树。 | 参考其结构操作划分；不能直接把全部输出当作 ReT 的父子关系及源文保留预期。应先写前/后结构树契约。 |
| TY-09 | Setext 一级标题从菜单改二级，`=====` 改为 `-----`；没有遗留可见的旧下划线。Undo 恢复。 | 标题转换操作整个标题结构；首版建议保留 Setext 写法完成 H1/H2 转换。 |
| TY-10 | AX 确认可见 bold 已选中，Cmd+X 保存为 `****`；Cmd+V 后活动 AX 为 `****bold****`，但磁盘已恢复原始 `**bold**`；点击 tail 后呈现与 AX 也恢复。未独立读取系统剪贴板 payload。 | 复制/删除范围、实际持久化源文、活动呈现和失焦呈现须各自验证。Typora 的模型/序列化可消解重复嵌套，ReT 不应以此掩盖 Source 中真实的重复语法。 |

TY-10 首次按活动 AX 预期磁盘也是四组星号的探针断言失败，读取实际字节后纠正了分析：该断言只是排查假设，不能记成产品回归 RED 或忽略真实字节。此例说明来源层级和检查阶段本身也是审计对象。

本次没有操作应用设置或用户原文稿，没有退出应用或重启服务。全部 9 份夹具最终回到原始字节；其中 list-quote 为未操作控制。真实输入法、表格内组合选择和窗口焦点链没有在此表冒称通过。

## 继续逆向的对应实现

本轮从工作区副本提取并与当前安装包原范围校验了另外 8 个模块：NodeOperation、MathInline、UserOp、TableEdit、MathBlock，以及 UserOp 导出的 Indentation（56）、Deletion（58）、ClipboardParagraph（5a）。后面三个名称是分析别名，模块编号仅对该安装包有效。

| REA 证据 | 范围与限制 |
| --- | --- |
| parent `ev_9cb43690b20b432d20852f2ad6a07db145744db4fa9168f436ca500694498421`；summary `ev_cb9ba991d1cf09d13b72fa7afe9b7587975ffa602b20d084b039fd9f23087eb2` | 五模块 82,831 字节，解析无失败，semantic coverage unknown，6,612 个语义 unknowns。 |
| parent `ev_0fdd2d277ce4ab51c1efd708068b460ba587e9cc43e401b31135c7a998a33714`；summary `ev_780dd18bebe011816c4bcef0a5dda51b0dc4bfecfe66bd71df4539f6ee593349` | 三模块 57,900 字节，解析无失败，semantic coverage unknown，5,298 个语义 unknowns。 |

静态结果及精确来源分别保存于 `analysis/typora-1.14.10/interaction-audit-20261021/continuation/rea-*-summary.json`、`provenance.json`、`actions-provenance.json`。函数范围由本地 Babel AST 定位，见 `methods.json` 与 `selected-methods.json`，不是声称 REA 已恢复完整调用关系。

- `MathBlock.js` [15984 附近] 将块内键盘交给 Fences.onKeyDown，并提供数学专用回调；不是让普通 Markdown 列表命令处理数学正文。此静态分支与 TY-06/07 的实际输入结果相互支持。
- `ClipboardParagraph.js` insertParagraph [27019,27578) 创建段落节点，记录选区/插入的 undo，并重定焦点；与 TY-02 的块外新段落结果一致。
- `Indentation.js` moreIndent [7938,8714)、lessIndent [8715,10491) 依选择定位结构节点，暂停 brush、记录操作与选区后刷新并恢复；并非对每个物理行固定加两个空格。
- `TableEdit.js` keydownHandler [21346,21823) 为 Enter/Shift+Enter/修饰 Enter 分配不同操作，表明事件必须按编辑 owner 路由。ReT 首版不支持多行单元格的既有规则继续优先；本轮未运行 Typora 表格对照。
- `ClipboardParagraph.js` copyHandler [23222,26892) 按源码视图、输入组件、数学、HTML、选区与复制标志分支；活动 DOM、剪贴板载荷和节点 Markdown 序列化是不同阶段。没有仅凭这个分支宣称已追通 TY-10 的完整动态调用链。

这次结果将部分旧静态假设提升为原生样本证据，但未恢复全部动态语义。后续以需求约束定义 ReT 契约，用参考行为辅助确定边界；不能把某次参考输出的全部重排或规范化都视为必须复制。
