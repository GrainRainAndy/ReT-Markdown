# 初版发布前优化验收

本轮依据[手工检查](2026-10-24-manual-check.md)与[实施计划](../superpowers/plans/2026-10-24-pre-release-optimization.md)，实现六项调整。语法显露采用用户确认的“当前格式片段及外层嵌套，其他片段保持渲染”。初版级别为预览版，本报告不授权上传、打标签或发布。

**结论：六项实现、独立审阅修复及同包自动验证通过；本轮原生验收覆盖未完成。**候选 `0.2.0-alpha.4 (4)`，源码 `add213065bc65eaed68ba72bd86ef67f1fca77a5`。

## 问题与固定通过条件

| 编号 | 最小操作与原问题 | 实现与必要回归 | 当前结论 |
| --- | --- | --- | --- |
| PR-01 | 深色源码定位光标，原 caret 被 CodeMirror 浅色规则覆盖成黑色 | 提高应用 caret 规则优先级；dark/light/system 实际 WK computed color 跟随正文前景色 | 通过：含实际深色截图 |
| PR-02 | 正常页脚出现内部状态文案 | 只保留保存状态与字符数；保留独立模式按钮与恢复错误入口；旧 saved ACK 和 checkpoint ACK 不误报已保存 | 自动通过 |
| PR-03A | 点击加粗／嵌套斜体，缺少可编辑的语法边界 | 原文标记进入双向映射；内容保留格式；局部标记删除、完整内容 Cut、反向拖选、组合输入冻结和撤销 | 自动及原生标记编辑通过；真实 IME 覆盖未完成 |
| PR-03B | 空文稿逐键输入 `#` 后提前出现标题 | 输入中 1–6 个井号延后转换到分隔空白；`#x` 不闪标题；删除分隔符可退回；不修改文件解析器 | 自动通过 |
| PR-04 | `* item` / `9. item` → Shift+Enter → next → Enter | 同项续行保留容器缩进；下一项保持符号／递增编号；任务项、引用、嵌套、CRLF、撤销和继续输入 | 自动通过 |
| PR-06 | 段尾连续三个空格无可达位置 | 将已有源空格补到编辑投影，非源文事务；段尾／格式之后／列表／引用／纯空白行可定位；不引入 NBSP | 自动通过 |
| PR-07 | 输入 B → 来回切模式 → 空格 → Undo，误连带撤销 B | 模式切换结束连续输入分组，切换本身不产生历史或 dirty | 自动通过，独立新增问题 |
| PR-05 | `⌘/` 不切换源码、既有命令与 Typora 默认不一致 | Web 和原生菜单共用命令表，修饰键精确匹配；Option 产生特殊字符时按物理键识别；一次按键只执行一次 | 通过：含原生切换、删除线、行内代码、替换按键 |

## 快捷键依据与冲突处理

本地 `Typora.app` 的菜单 AX 不暴露快捷键字段，编译 nib 不能由 ibtool 直接读取。因此本轮采用 [Typora 官方默认快捷键表](https://support.typora.io/Shortcut-Keys/)（页面更新日期 2026-09-06），不把用户自定义菜单或未执行的逆向分析当作证据。只对齐已有对应命令，不新增 Typora 功能。

| 命令 | macOS 目标 |
| --- | --- |
| 切换源码 | ⌘/ |
| 拷贝 Markdown | ⇧⌘C |
| 替换 | ⌘H |
| 行内代码 | ⇧⌘` |
| 删除线 | ⌃⇧` |
| 插入图片 | ⌃⌘I |
| 表格／代码块／数学块 | ⌥⌘T / ⌥⌘C / ⌥⌘B |
| 引用／有序列表／无序列表 | ⌥⌘Q / ⌥⌘O / ⌥⌘U |
| 删除表格行 | ⇧⌘⌫ |

文件命令、加粗、斜体、标题 1–6、链接、撤销重做保持已对齐映射；ReT 文字缩放等无对应项保留。`⌘H` 给替换，隐藏应用保留菜单入口但移除冲突键。命令定义新增可选 `command:false` 表达 Control-only 删除线，缺省仍为 Command；原生与 Web 均支持 Control。

## 证据与验证边界

证据根目录：`build/rewrite/verification/2026-10-24/pre-release-optimization/`（Git 忽略）。初始源码 HEAD `d0ef255`，历史实际候选 `0.2.0-alpha.3 (3)`，旧包未覆盖。新候选为 `0.2.0-alpha.4 (4)`，包路径 `build/rewrite/0.2.0-alpha.4/ReT Markdown Preview.app`。

- RED→GREEN：列表模型 6 个失败修复；尾空格模型 7 个失败修复；标题过渡模型失败修复；深色 caret 浏览器 3 个外观断言失败修复。新增语法显露 API 先有缺失失败，再完成模型与浏览器覆盖。
- `t5-alpha3-native-red-retry.log`：实际 alpha.3 WKWebView 的 dark/light/system caret 均为黑色，与正文前景不一致；修复后开发 Web 的 `t5-native-green.log` 同一测试通过。第一轮编译错误属于测试代码拼写，记录在 `t5-alpha3-native-red.log`，不计产品失败。
- `unit-final.log`：最终集成单元测试 269/269；另 `t4-raw-markers.log` 验证链接目标转义、实体与带 padding 反引号原样映射，10/10。
- `t4-browser.log`：语法显露与相关正文边界 74/74；`t4-composition.log`：合成 composition、反向拖选及既有关闭／快捷键路径 24/24；这不是原生系统输入法证据。
- `t5-t7-browser.log` 24/24，`ui-keyboard-boundaries.log` 11/11；`t6-native-retry.log` ProtocolTests 6/6。
- 最初端口监听与 Swift 缓存权限失败属于环境，授权后同命令重试通过；分别保留原日志，不记作产品回归。

同包集成结果：

- `npm run typecheck` 通过。
- `RET_TEST_WEB_ROOT=<alpha.4>/Contents/Resources/web npm run test:browser`：**148/148 通过**，`candidate-browser.log`。
- `RET_TEST_WEB_ENTRY=<alpha.4>/Contents/Resources/web/index.html swift test --package-path native --filter 'ProtocolTests|WebKitRenderTests|FlushBarrierTests|RecoveryCloseTests'`：**15/15 通过**，`candidate-native.log`。含实际 WK 外观切换、保存关闭屏障。
- `bash scripts/build-app.sh` 构建完成；增加现有包拒绝覆盖保护。`artifact-manifest.json` 绑定源码、版本与实际包，检查 bundled Web 等于 dist、原生 UUID 一致、ad-hoc 签名有效。签名不等于对外安装验收。

真实 IME、保存字节和重开另列，不以 Chromium／合成 composition 替代。

## 独立审阅及修复

按执行技能安排 fresh-context 审阅代理 `final_review`，模型 gpt-6-astra。审阅未操作 UI，独立运行了模型检查，未冒称重跑全部套件。其结论是“修复后可继续”；本任务接受两条重要问题及一条轻微契约不一致：

1. 空列表续行没有投影位置，`Shift+Enter → Backspace` 会删除上一行的硬换行空格。补源文支持的 hard_break 位置，Backspace 删除可见换行及容器续行前缀；Undo 恢复，随后可直接继续输入。
2. `* > item`、`* A\n  > item` 的硬换行漏掉内部引用前缀。现在从解析确认的正文入口推导完整容器前缀，保留引用并把列表标记替换为缩进。
3. 粘贴裸 `#` 曾进入逐键输入过渡。粘贴期间禁用输入过渡，保持既有文件语义。

上述修复先记录 5 个模型失败和 1 个浏览器失败，再通过模型 36/36、相关浏览器 31/31，日志 `review-red.log`、`review-green.log`、`review-browser-red.log`、`review-browser-green.log`。最终全量 269/148 与原生 15 项为本任务执行结果，独立审阅与提交方验证分开表述。

## 范围裁决与交接

1. Typora 本地默认映射不可读取时使用官方表，清楚记录来源。Tab/Shift+Tab 原有列表层级操作保留，不扩展为新命令。
2. 标题的 Tab 分隔指已输入源文中的 Tab；正文 Tab 仍按既有列表缩进快捷键处理，不为了此优化改变整套 Tab 契约。
3. 列表及空格主要通过可重复模型／浏览器故障建立修复证据；未另在旧包重做所有手工故障。旧包实际 WK 对照专门用于光标 CSS 归因。
4. B08 历史关闭状态保留，本轮只复查受正文显隐影响的焦点路径；未完成整体验收项、异常观察及后续主题里程碑仍按历史报告分类，不自动重开。
5. 本轮不会修改或提交他人未完成的 README、B08 报告、验收方案及发布评估；此报告给出新的版本事实与交接。


## 同包原生手工结果与剩余项

使用 CUA 原生 UI 操作，实际 HTML URL 为 alpha.4 包内入口。专用文稿 `native-qa/alpha4-manual.md`，保留应用恢复出的其他 Untitled 文稿，未编辑、放弃或强制关闭它。

| 路径 | 实际结果 | 结论 |
| --- | --- | --- |
| 嵌套 strong/em 进入与离开 | 原生截图中只显露活动外层与内层标记，正文仍加粗／斜体，其他段保持渲染 | 通过 |
| 显露标记编辑 | 键盘选中开头一个星号并删除，源码仅由 `**a *中文* c**` 变为 `*a *中文* c**`；Undo/Redo/Undo 恢复原文与保存基线 | 通过 |
| 无序／有序 Shift+Enter → next → Enter → new | 原生源码分别为 `* item  \n  next\n* new`、`9. item  \n   next\n10. new`；空续行截图中光标位于新行；列表操作根撤销可恢复 | 通过 |
| 尾随空格与标题 | `A` 后三个空格再 `B` 保留；逐键 `#`、`#x` 均为正文，删除 x 再输入空格、Title 后为 h1 | 通过 |
| 深色源码 caret | 实际截图中行尾浅色竖线清晰；同包 WK 的 dark/light/system computed caret 均匹配前景 | 通过 |
| 命令路由与状态栏 | `⌘/` 每次只切换一次；`⌃⇧反引号` 删除线、`⇧⌘反引号` 行内代码、`⌘H` 替换均执行；正常页脚只有字符与保存状态 | 通过 |
| 保存全文 | 原生 `⌘S` 后已保存基线 80 字符；磁盘 84 UTF-8 bytes 与预期全文逐字节一致 | 通过 |
| 真实系统拼音＋提交／保存；组合中关闭＋取消＋不点击续写 | 两次探测均直接提交英文 ni，未形成候选，不是有效 IME 样本。探测文字已删除，等待用户在专用窗口启用拼音；未重复求实体键盘验证 | **覆盖未完成** |
| 实际关闭后重开 | 工具触发 Cmd+W、关闭按钮／菜单后窗口仍在；未出现错误或关闭 sheet。自动 native 关闭专项通过。没有确认工具事件到达宿主，不据此宣称产品缺陷，也不宣称重开通过 | **覆盖未完成；观察 PR-OBS-01，归因未定** |

保存证据 `saved/manual-before-ime.md`、`saved/manual-before-ime.json`：SHA-256 `da9d395f6299f5bff2f1bd8483da1d5720cb788d90f347cd7639d721208fe15d`。最终仍停留在已保存的 80 字符专用文稿。UI 过程见 `native-qa/session.md`。

工具边界：部分 AX 文本选择没有使编辑器逻辑选区随之移动，改用原生方向键后定位成功；未按错误定位计入列表失败。一次坐标点击返回 `noWindowsAvailable`，自动审批随即拒绝继续发送按键，理由是可能落到其他应用。重新通过明确包路径绑定并核实专用窗口后安全继续；未绕过审批或更改全局工具／输入法设置。

**交接：** 实现可在本地 alpha.4 预览包试用；本轮不宣称整体验收通过。剩余必需覆盖为有效真实 IME 两条路径、确认实际关闭与重开；PR-OBS-01 待事件或窗口证据定位，不无限重复探测。既有整体验收未测范围和后续主题里程碑仍独立追踪。尚未制作对外发行归档、解压安装验收、Developer ID 公证，也未上传、推送或发布。待真实 IME 就绪后只续验上述缺口，已通过项目不重跑。
