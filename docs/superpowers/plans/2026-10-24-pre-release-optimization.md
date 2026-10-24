# 初版发布前优化实施计划

> **执行状态（2026-10-24）：** 六项实现与同包自动验证已完成，源码 `add2130`、候选 alpha.4 (4)；原生 IME 与实际关闭重开覆盖未完成。详细结果与计划偏差见[本轮报告](../../verification/2026-10-24-pre-release-optimization.md)。以下保留原始实施清单，不将未执行子项勾选为已完成。

> **For agentic workers:** 使用 `superpowers:executing-plans` 按任务执行；步骤使用复选框跟踪。当前交付为计划，不代表已经开始实施、完成验收或获得发布授权。

**Goal:** 完成手工检查清单的六项优化，在保持 Markdown 原文、中文输入和统一撤销可靠的前提下，形成新的初版预览候选。

**Architecture:** 沿用源文权威的 DocumentSession、ProseMirror 正文、CodeMirror 字面编辑器与 AppKit/WKWebView 宿主。列表换行通过源文事务修复；语法显隐、输入中的标题和空格可见性由实时投影处理；菜单与 Web 快捷键继续共享命令表。打印沿用独立语义渲染，不读取编辑展示层。

**Tech Stack:** TypeScript、ProseMirror、CodeMirror 6、现有 mdast/micromark 解析器、Swift/AppKit/WKWebView、Vitest、Playwright、Swift XCTest；不新增运行时依赖。

**Spec:** [手工检查清单](../../verification/2026-10-24-manual-check.md)、[需求](../../specs/requirements.md)、[编辑契约](../../specs/editing-contracts.md)、[技术方案](../../architecture/technical-design.md)。用户本轮已确认：**显示光标所在格式片段及其外层嵌套的完整标记，其他内容保持渲染**。

## 全局约束与证据状态

- 当前分支 `rewrite/from-zero`，规划时 HEAD 为 `d0ef255`；现有生产基线提交为 `490cef3cbf150a84507e30e31c14d25ff7a632a5`，历史候选 `0.2.0-alpha.3 (3)`。
- 手工清单没有绑定实际包、文稿和逐步证据。下文区分用户报告、静态代码发现与待执行复现，不把它们冒称为本轮原生测试结果。
- 本轮只新增本计划。工作区已有 README、B08 报告、验收方案修改，以及独立复验、发布评估和手工清单等未跟踪文件，均保留，不代为提交。
- 初版按**预览发布**规划，依据[发布评估](../../verification/2026-10-24-initial-release-assessment.md)。六项全部纳入本次发布前范围，优先级只决定顺序，不默认删减较低优先级项。
- Markdown 源文是持久化依据；未触及范围、BOM、LF/CRLF 原样保留。展示变化不得生成内容事务、改变 dirty 或历史；编辑走根事务，不启用局部历史。
- 组合输入不因界面更新被打断；拖选期间延后会改变命中区域的更新。保留 E01–E08、E15–E18 与现有对象选择、表格和保存屏障规则。
- [B08 已通过并关闭](../../verification/2026-10-24-alpha3-independent-review.md)。本轮涉及正文映射时检查相关焦点路径；没有新失败证据不重开旧缺陷，不重做全部历史验收。
- 冻结历史候选和证据。新候选建议 `0.2.0-alpha.4 (4)`，构建前检查目录未被占用；若已存在冻结候选则使用下一未占用版本，不能覆盖。
- 不扩展自定义主题、新 Markdown 方言、代码语言、跨平台、性能改造或尚不支持的 Typora 功能。

## 优先级与处理顺序

编号 PR-01～PR-06 对应手工清单序号，第 3 项拆成两个独立关闭的问题。

| 顺序 | 编号 | 优化 | 优先级／难度 | 依据与验收核心 |
| --- | --- | --- | --- | --- |
| 1 | PR-04 | 列表内 Shift+Enter 后保持结构及续项 | P0／中 | 用户报告核心编辑行为失效；尚未据此认定数据丢失。换行后仍在同一项，随后 Enter 正确续项或续号 |
| 2 | PR-03B | 输入 `#` 时不提前变标题 | P1／低至中 | 可定位到语义解析与输入展示策略的差异；逐键输入 `#x` 全程不闪成标题 |
| 3 | PR-06 | 实时编辑保留可见的尾随空格 | P1／中 | 影响光标定位和持续输入；源文有几个空格，编辑位置就能到达几个空格之后 |
| 4 | PR-03A | 当前格式片段及外层标记显露 | P1／高 | 涉及源文与 PM 双向映射、删除、剪贴板、IME；文字保留样式，标记可编辑 |
| 5 | PR-01 | 深色源码光标可辨识 | P1／低，归因后确定 | 影响定位；现有 CSS 已指定前景色，不能预设补一条颜色声明即可修复 |
| 6 | PR-05 | 已支持命令的 Typora 默认快捷键对齐 | P2／中 | 先冻结本地参考映射；`toggleSource` 明确改为 `⌘/`，保证一次按键只执行一次 |
| 7 | PR-02 | 状态栏只保留字符统计和保存状态 | P2／低 | 清除常驻内部状态文案，保留真实保存语义和必要错误提示 |
| 8 | RELEASE | 合并验证、新候选与发行准备交接 | 必要收口／中 | 同包验证受影响路径；发行归档、分发方式仍与产品修复分别判断 |

推荐按上述顺序串行推进，先完成正确性和映射，再做界面、命令和候选收口。PR-03A 风险最高，不宜拖到发布打包时才接入。若以后安排多人，PR-03A／03B／06 的投影文件应由同一方整合；原生 UI 只能由一个任务控制。

## 方案取舍与具体行为

采用现有结构编辑器的**局部、可编辑源文投影**。整段源码展开不符合用户已选范围；仅用 CSS 伪元素显示星号不能提供真实的选择和编辑位置；改写成全文源码编辑器则超出本次优化范围。

### PR-03A：语法显露

- 首轮覆盖已有行内格式：加粗、斜体、删除线、行内代码、链接／引用链接；正文、标题、列表和引用中的这些格式使用同一规则。表格中的行内格式复用同一规则，但不展开表格分隔线、不改变单元格编辑契约。
- 光标在 `**加粗 *斜体* 内容**` 的“斜体”中，显示内层 `*…*` 和外层 `**…**`，文字继续同时加粗、斜体；同段无关格式仍保持渲染。普通已渲染链接进入编辑时显露其原始标签／目标语法，仍保持标签的链接样式。
- 标记来自原始 source 范围，不能由语义文本重新拼出规范化 Markdown。保留 `__`、多反引号、引用链接原写法与转义；损坏或未闭合结构可继续作为原文编辑。
- 标记是可映射的实际文本位置，可左右移动、选择、删除或补回；低强调颜色只影响展示。删除已显露的一个 `*` 就只删除该字符，不暗中扩大到整个格式片段。
- 完整选择渲染内容但没有显式选择标记时，继续遵守 E15 的完整格式复制／剪切；只选内容子串遵守 E16。选区明确包含已显露标记时，复制／剪切／删除使用可见的精确源文范围，不能二次包裹。
- 非折叠选区按 head 所在格式及其祖先计算显露范围，保留 anchor/head 方向；拖选中冻结显露集合，释放后更新。边界按既有 affinity 决定内外：起点 `after` 属于格式内，终点 `before` 属于格式内，反方向属于外侧，避免相邻格式同时误展开。
- 离开格式后恢复渲染；切源码仍显示原始 Markdown。移动光标、展开／收起、失焦本身不产生文稿修改。
- 图片、行内公式和块字面域保留已有对象／源码入口；本项不另造对象编辑 UI，不把所有块级标记一并展开。

### PR-03B 与 PR-06：输入展示和语义解析分离

- 对逐键形成且仍在编辑的 ATX 候选，`#` 至 `######` 在没有后续空格／Tab 时保留普通文字；输入分隔空白后才采用标题样式。`#x` 一直是正文，七个 `#` 不作为标题。删除刚输入的分隔空白可回到候选状态。
- 本地现有解析器把单独 `#` 解析成空标题；这不是已经证明的解析器缺陷。通过实时编辑状态处理过渡，不全局改写解析方言；已有文件、粘贴和导出继续使用既定语义。候选失焦后的状态在契约中明确：结束输入过渡、按已有语义展示，源文不变。
- 空格目标是实时编辑中真实可定位的 U+0020，包括段尾、EOF、格式之后及列表／引用正文尾部；一个、多个、纯空白可编辑行都能移动光标和删除。无需新增可见空格点号。
- 不能写入 NBSP／零宽字符代替源文空格，也不能把列表／引用容器缩进、表格对齐空白和语法内部 padding 当成正文补显示。硬换行前两个空格保留其语义，不能额外插入换行。
- 本地解析实验确认 `A ` 与 `A  ` 的语义 text 都是 `A`；现有 `.ProseMirror` 已为 `white-space: pre-wrap`。应先补足源文空白的编辑投影与映射，再按实测处理浏览器布局。

## Review Focus

| 风险条件 | 必须保持的行为 | 归属任务 |
| --- | --- | --- |
| 硬换行后光标位于没有列表标记的续行 | Enter 仍依据所属 listItem 续项，嵌套与引用前缀正确 | T1 |
| CRLF、EOF、语法尾部空白 | 精确字节与可达光标一致，不能让展示补丁重复插空格 | T2、T3 |
| 嵌套格式、反向选区、显露标记局部删除 | 选区和 payload 一致，Undo 恢复源文与方向 | T4 |
| 中文预编辑、拖选、关闭取消后继续输入 | 保留活动 DOM 与焦点，显隐不打断输入，真实 IME 与合成证据分开 | T4、T8 |
| 保存旧快照、菜单与 Web 双重路由 | 状态不假报已保存；新快捷键不重复执行，辅助输入框保有焦点规则 | T6、T7 |

## 实施任务

### T1：列表内硬换行与后续 Enter（PR-04）

**文件：** 修改 `editor/surfaces/editing.ts`、`tests/surfaces/editing.test.ts`、`tests/browser/workflows.spec.ts`；更新 `docs/specs/editing-contracts.md` 的 E11、E19–E25 关联说明。仅在映射证据确实指向投影时修改 `editor/surfaces/projection.ts`。

**接口：** 保持 `enterIntent(source: string, selection: LogicalSelection, projection: DocumentProjection, shift?: boolean): Intent | null`。使用 projection 的祖先 listItem/list 定位上下文，不能仅从当前物理行的正则识别列表。

- [ ] 在独立夹具中绑定实际基线包，重现 `* item│` → Shift+Enter → 输入 `next` → Enter → 输入 `new`；同时记录源文、列表树、选区及预期，冻结 PR-04 最小复现。
- [ ] 添加模型断言：Shift+Enter 得到 `* item  \n  `，输入 next 并 Enter 后得到 `* item  \n  next\n* `；有序 `9. item` 的续行缩进为 3 空格，下项为 `10. `；任务项延续为未勾选项。用 CRLF 和 `> * item` 各补一个容器组合，核对未触及尾块原样保留。
- [ ] 用 `npm test -- tests/surfaces/editing.test.ts` 记录新增失败。注意无缩进续行有时仍能被 Markdown 解析为同一项，不能仅凭 AST 未破坏就认定“后续 Enter 续项”通过。
- [ ] 实现基于容器的硬换行前缀；普通 Enter 在续行上找到所属项的标记、编号和任务状态。空续行不等同于整个空项；真正空项仍执行 E20，不添加错误列表层级。
- [ ] 浏览器真实按键覆盖无序／有序的完整序列，以及一次嵌套项、Undo/Redo 和继续输入；断言完整 source、列表层级和实际焦点。运行 `npm run test:browser -- tests/browser/workflows.spec.ts`，模型与浏览器通过后单独关闭 PR-04。

### T2：标题输入转换时机（PR-03B）

**文件：** 修改 `editor/surfaces/projection.ts`、`editor/surfaces/rich.ts`；测试放在 `tests/surfaces/boundaries.test.ts` 和新建 `tests/browser/pre-release-editing.spec.ts`；更新 E17 及标题输入契约。

**接口：** 扩展现有 `RichProjection` 输入展示上下文，保留 `sourceAt()`、`positionAt()` 行为。过渡状态属于编辑表面，不进入 `parseDocument()` 或宿主协议；当前 `proseOffset` 和 pendingOpening 处理是可复用的状态约束参照。

- [ ] 添加逐键断言：空文档键入 `#` 后是可编辑普通文本，继续 `x` 从未出现标题；另一序列 `#` → 空格 → `标题` 后为 h1，内容和光标正确。补 `##`、Tab 分隔、删除分隔符和七个 `#`。
- [ ] 运行 `npm test -- tests/surfaces/boundaries.test.ts` 和 `npm run test:browser -- tests/browser/pre-release-editing.spec.ts`，确认基线失败阶段。
- [ ] 实现输入中的 pending heading 展示，支持源文起止坐标；已有 `#` 文件加载和源码往返仍按语义解析，不把瞬时状态保存到文稿。
- [ ] 验证中文标题、Undo/Redo、失焦结束过渡；保留 ATX／Setext 拆分测试。运行 `npm run test:browser -- tests/browser/pre-release-editing.spec.ts tests/browser/edges.spec.ts`，通过后关闭 PR-03B。

### T3：尾随空格的编辑投影（PR-06）

**文件：** 修改 `editor/surfaces/projection.ts`；必要布局修正在 `editor/styles.css`。测试在 `tests/surfaces/boundaries.test.ts`、`tests/browser/pre-release-editing.spec.ts`；更新 E12 附近的空白展示契约。共享 `editor/syntax/mapping.ts` 只在缺少所需映射原语时调整，不改共享语义文本来迁就编辑显示。

**接口：** 使用既有 `mapText(raw: string, sourceFrom: number)` 建立真实空格的 runs；`sourceAt(positionAt(offset))` 在补出的各空格边界必须往返。补出的是编辑树中的已有源字符，不是源文事务。

- [ ] 模型固定 `A `、`A   `、`**A** `、`* A `、`> A `、纯空白行和 CRLF 段尾样本；断言尾部位置可达、各空格字节不丢失，容器前缀和表格 padding 不冒充正文。
- [ ] 浏览器逐键输入 `A` 和三个空格；逐个测量选区光标位置前进、Backspace 后退，以及随后输入 `B` 的完整源文。比例断言相邻位置有正向间距，不锁定某台机器的固定像素宽度。
- [ ] 记录失败，再补足语义节点之间／末尾遗漏且属于可编辑正文的空格 runs；区分换行语义、容器前缀和真正空白段，不复制同一段空白两次。
- [ ] 运行 `npm test -- tests/surfaces/boundaries.test.ts` 与 `npm run test:browser -- tests/browser/pre-release-editing.spec.ts tests/browser/workflows.spec.ts`；检查失焦、模式往返、Undo/Redo 后完整 source 一致。通过后关闭 PR-06。

### T4：活动格式片段的可编辑标记（PR-03A）

**文件：** 新建 `editor/surfaces/inline-presentation.ts`、`tests/surfaces/inline-presentation.test.ts`、`tests/browser/inline-presentation.spec.ts`；修改 `editor/surfaces/projection.ts`、`editor/surfaces/rich.ts`、`editor/styles.css`。核对并按显露标记选择需要修改 `editor/surfaces/commands.ts` 的 `clipboardRange` 调用规则、`editor/surfaces/recovery.ts` 的回退映射；更新需求 R-EDIT-01/02/09 和 E15–E18。

**接口（新提议，实施时采用）：** `collectRevealRanges(projection: DocumentProjection, selection: LogicalSelection): SourceRange[]` 返回需要显露的格式节点完整源范围，按外层到内层排序；不返回拼接字符串、不写入源文。`RichProjection` 增加可选的显露范围参数（保留现有调用兼容），负责把标记与内容分别变为具有源坐标的 PM 文本 runs，内容继续带已有 marks。`RichSurface` 管理当前／冻结显露集合和无内容事务的视图刷新。

- [ ] 为 `collectRevealRanges` 固定嵌套、相邻、外部光标及 affinity 边界样本；在 `**a *b* c**` 的 b 中应返回 strong 与 emphasis 两个源范围，无关片段不返回。覆盖正反向选区 head、正文／单元格 owner，非文本对象和字面 owner 不显露。
- [ ] 为投影补精确断言：`**bold**`、`__bold__`、`*em*`、删除线、含反引号的行内代码、链接／引用链接的标记原样可见；内容保留 marks；每个显露标记边界可往返到原始 source。未闭合、转义标点、实体及中文／emoji 不错位。
- [ ] 运行 `npm test -- tests/surfaces/inline-presentation.test.ts tests/surfaces/boundaries.test.ts`，固定失败后实现局部投影。标记单独低强调，不让它们改变内容原有加粗／斜体／代码／链接样式；避免样式 padding 叠加造成点击位置不符。
- [ ] 接入 selection-only 的显隐更新；composition 和 pointerDown 期间冻结，提交／释放后再按逻辑选区刷新。补按键跨越格式边界、跨段反向拖选、失焦再进入和模式往返测试，断言源文、dirty、历史不因显隐变化。
- [ ] 实现显露标记的精确编辑与剪贴板范围选择；断言删除单个星号、补回闭合符、完整内容 Cut/Paste、子串 Cut、选中标记 Copy/Delete、Undo/Redo。回退恢复不得把既有标记重复序列化；不通过改变 E15/E16 旧预期掩盖错误。
- [ ] 运行 `npm run test:browser -- tests/browser/inline-presentation.spec.ts tests/browser/edges.spec.ts tests/browser/review.spec.ts tests/browser/acceptance-iteration.spec.ts tests/browser/close-focus.spec.ts`；合成 composition 只记录为自动覆盖。真实 WKWebView 中文组合与关闭取消在 T8 同包收口后，才能关闭 PR-03A 的原生覆盖。

### T5：深色源码光标（PR-01）

**文件：** 优先 `editor/styles.css`；只有证据表明 CodeMirror 扩展／主题配置参与故障时修改 `editor/surfaces/literal.ts`。浏览器验证归入新建 `tests/browser/pre-release-ui.spec.ts`。

**接口：** 沿用 `appearance` 的 system/light/dark 与已有 `--fg`、`--bg` 令牌，不增加宿主协议。

- [ ] 在基线实际包记录深色源码界面的焦点、系统外观、光标实际绘制层和 computed style；区分 native caret、CM cursor layer、失焦和闪烁时段。已有 `.cm-content` 与 `.cm-cursor` 前景色声明，先确定为什么未达到用户可见效果。
- [ ] 按证据修复实际光标路径的颜色／绘制冲突，确保宽度与背景可辨。验证显式深色、跟随系统深色及浅色；切换不改变内容／选区／历史。
- [ ] 浏览器检查实际 caret／cursor 使用的前景色和布局，WKWebView 检查空行、中文／英文行尾及选择折叠后可见性。必要时检查共享 literal 样式的代码／公式各一例，不扩展整套外观验收；通过后关闭 PR-01。

### T6：快捷键对齐（PR-05）

**文件：** 修改 `editor/protocol/commands.json`、`editor/main.ts`、`native/Tests/ReTPreviewTests/ProtocolTests.swift`；本地参考核对后按需修改 `native/Sources/ReTPreview/Menus.swift` 中硬编码的文件命令。浏览器测试在 `tests/browser/pre-release-ui.spec.ts`；映射证据写入本轮验证报告。

**接口：** 保持 `CommandDefinition { id, title, group, key, modifiers }`；command 修饰键隐含，`toggleSource` 明确为 `key: "/", modifiers: []`。Web 提示从同一命令定义派生，去掉 `main.ts` 中硬编码的 `⌘⇧M`。

- [ ] 使用本地 `Typora.app` 只读核对已支持命令的默认快捷键，记录版本、默认值来源和是否有用户覆盖；形成“命令／当前／目标／冲突／变更”表。不能将当前自定义快捷键误称为默认；本轮没有核实其他键值，不凭记忆填写。
- [ ] 对齐有明确对应关系的现有命令，包括格式、列表、视图、查找和文件命令；ReT 独有命令保留现状。Typora 有而 ReT 没有的功能不加入实现范围。冲突先按原生命令与同一命令表统一解决，不能同时绑定两个动作。
- [ ] 更新 toggleSource 原生断言为 `/` 和空 modifiers；浏览器按 `Meta+/` 验证实时→源码→实时，完整源文与历史不变，一次按键只切换一次。旧 `⌘⇧M` 不再作为切换别名。
- [ ] 检查菜单显示、Web 捕获与实际执行使用同一映射；在查找、链接／公式输入框和 composition 中继续遵守既有焦点与屏障规则，不把 `/` 注释命令误接入字面编辑器。
- [ ] 运行 `npm run test:browser -- tests/browser/pre-release-ui.spec.ts tests/browser/residual-fixes.spec.ts`；先 `npm run build` 更新开发测试 Web，再运行 `swift test --package-path native --filter ProtocolTests`。候选包内命令表及 WK 实际菜单在 T8 再核验，关闭 PR-05。

### T7：精简状态栏（PR-02）

**文件：** 修改 `editor/main.ts` 的 `updateStatus()` 与必要 footer 样式；验证归入 `tests/browser/pre-release-ui.spec.ts`。

**接口：** 保留现有 checkpoint／saved／RecoveryDraft 协议。展示不再读取 durable／received 拼接内部状态，但不删除其持久化逻辑。字符数暂沿用 `session.source.length`，本项不改变计数口径。

- [ ] 正常状态栏只显示保存状态与字符数：沿用清晰区分的“已保存基线／未保存”；移除常驻“实时／源码”“已持久恢复”“已接收”“浏览器内存文稿”。保留独立模式切换按钮。
- [ ] “正在输入”“输入待恢复”不再占用正常状态栏；输入待恢复的阻断说明保留在现有 recovery 对话框，保存／恢复失败继续通过 notice 或既有错误入口呈现，不能被精简文案吞掉。
- [ ] 用现有 host mock 核对加载基线、编辑后、当前版本保存后、旧快照 ACK 迟到四种状态；恢复 ACK 不得使未保存文稿显示已保存。运行 `npm run test:browser -- tests/browser/pre-release-ui.spec.ts tests/browser/editor.spec.ts`；仅改文案不另造持久化测试，符合预期后关闭 PR-02。

### T8：候选与有限验收收口

**文件：** 修改 `package.json`、`package-lock.json` 的版本、`scripts/build-app.sh` 的输出版本与 plist build；更新 `scripts/write-artifact-manifest.py` 的 build 校验和证据目录参数。新建 `docs/verification/2026-10-24-pre-release-optimization.md`；仅在实际结果确定后更新 README 与发布评估，编辑前重新读取共享差异。

**接口：** manifest 建议增加 `--evidence-root <path>`，避免沿用硬编码的 `b08-fix` 历史证据目录；保留源码提交与实际 bundle／dist 比较。最终报告逐项记录 PR 编号、修复提交、候选身份、命令／操作、实际结果和结论。

- [ ] 每项修复先完成上述专项。T1–T4 共同影响正文事务与映射，集成后执行一次 `npm run typecheck` 和 `npm test`；检查完整任务差异及暂存范围，再明确暂存本任务拥有的文件。每个独立通过的修复可独立提交，不暂存其他人的报告。
- [ ] 选定未占用的新版本，更新构建和 manifest 的旧值，保留 alpha.3。最终源码提交后运行 `bash scripts/build-app.sh`，记录版本、build、源码提交、架构、签名与包路径。
- [ ] 以 `RET_TEST_WEB_ROOT` 指向新包的 `Contents/Resources/web`，运行一次 `npm run test:browser`。本轮改变全局正文投影，完整浏览器套件是集成检查；通过后不无理由反复重跑。
- [ ] 以 `RET_TEST_WEB_ENTRY` 指向同包 `index.html`，运行 `swift test --package-path native --filter 'ProtocolTests|WebKitRenderTests|FlushBarrierTests|RecoveryCloseTests'`；若确实改了其他原生逻辑，按其影响追加对应专项，不预设全量原生重测。
- [ ] 使用独立文稿进行一次同包手工路径：有序／无序列表硬换行及续项；`#`、`#x`、`# 标题`；嵌套加粗／斜体显隐与标记编辑；尾随空格继续输入；深色源码 caret；`⌘/` 和已改快捷键；状态栏保存变化。
- [ ] 在活动格式正文中用真实 macOS 拼音完成一次“组合输入→提交→保存”和一次“组合中关闭→提交→取消→不点击继续输入”。核对新正文 DOM／选区逻辑没有破坏 B08 所保护的焦点路径；没有相关失败不扩展到全部四表面重复验收。
- [ ] 保存包含上述输入的完整 Markdown，与预期全文逐字节比较，关闭重开并核对源文；Undo/Redo 至少覆盖列表结构和格式标记两类修改。原生测试证据与 Chromium／合成 composition 分列。
- [ ] 证据放 `build/rewrite/verification/<实际日期>/pre-release-optimization/`。用更新后的 manifest 脚本绑定新源码、实际包及本轮证据；报告对各项明确标记“通过／失败／覆盖未完成”，原生未跑不能写成已通过。
- [ ] 更新发布建议：六项完成后可以重新评估预览交付；既有整体未测项、观察项和后续里程碑仍分别列示。实际发行再执行归档＋校验和＋notices、解压启动及最小新建／保存／重开验证；Developer ID／公证或明确的预览分发方式届时单独确定，本计划不自行打标签、上传或发布。

## 收口规则与本次规划结论

每个 PR 问题满足自己的固定验收条件即可关闭，不由其他未完成项挂起。失败记录具体步骤和对应候选；同一缺陷三轮修复复验仍失败，第四轮前先复核条件、工具和候选对应关系。新增缺陷另编号，扩测须指出现有证据的具体缺口。

本次已经覆盖手工清单全部六项；PR-03 的两部分分开交付，语法显露范围采用用户已确认的局部片段方案。**规划完成；产品修复与本轮候选验收尚未执行，覆盖未完成。** 本文依据共享文档及本地代码形成，不代表其他任务会签，也未发送外部协作消息。
