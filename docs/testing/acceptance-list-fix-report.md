# AC2 列表类型转换修复

2026-10-16。范围仅为验收交接第 2 项；依据 F02 的局部源文保真和 F06 的列表命令要求。未使用 Git 或子代理。

## 修改文件

- `web/src/editor/commands.ts`：列表命令使用现有 Markdown grammar 定位 `ListItem` / `ListMark` / `TaskMarker`，生成局部补丁；保留原有 Enter、indent/outdent 路径。
- `web/test/acceptance-list.test.ts`：新增 45 项回归，直接通过真实 `EditorSession.command('format', ...)`、CM transaction、commit、EOL metadata 和 CM history 执行。
- 本报告。

未修改 session、history、live、renderer、原生代码、根配置或共享 `build/web` / `.app`。没有构建或发布应用包。

## 修复行为

原问题是列表分支只在缩进后插入新前缀。现在选中 `- alpha\n- beta` 执行 orderedList，结果为 `1. alpha\n2. beta`，提交中仅有两个 marker replacement，不重写正文或换行。

- 识别实际无序标记 `*` / `+` / `-` 及有序标记 `.` / `)`；保留命令别名和显式 marker 参数。
- 转为普通有序/无序列表时移除 grammar 确认的任务框及框后的 separator；转为任务列表时保留已有 `[x]` / `[X]` / `[ ]`，无任务框则插入 `[ ]`。`[x]alpha` 等普通正文不会被当成任务前缀删除。
- 已符合目标类型的列表不统一编号、符号或空白；没有变化则不提交、不产生撤销事件。
- continuation 选区作用于所属项一次；编号按选中的同层项递增，子层独立计数，不按源码行号计数。非折叠选区中的空行保留，选区结束位置所在的下一行不参与修改。
- 根项原有前导缩进保持；子项未选中时保留其 marker 和正文。marker 变宽时，仅补足所属子树必要的 container indentation，避免子项脱离父项或 indented code 变成列表；marker 变窄且有缩进后续内容时，在当前 marker 前缀补空格以保持原 content column，不改写后代缩进。已有 tab、quote mark、空行和 lazy continuation 保留。
- fenced / indented code 不参与 marker 或 checkbox 转换。列表首行本身开始代码块时，有序/无序转换只转换真实的外层列表 marker，并保持代码归属。
- 所有补丁一次调用真实 `target.edit`，由现有 session 实现单事件 undo/redo 和 commit；混合 LF/CRLF/CR、BOM、Unicode、末尾无换行及范围外字节有回归断言。没有 AST 序列化或全篇规范化。

## RED / GREEN 证据

修改产品代码前执行 `npx vitest run web/test/acceptance-list.test.ts`：初始 32 项全部因行为断言失败。第一项实际输出明确为 `1. - alpha\n2. - beta`，期望为 `1. alpha\n2. beta`，不是导入或测试设施错误。

首轮局部替换通过后继续做 grammar 检查，发现单纯保留子树绝对缩进会改变层级和代码含义。新增结构性 RED 后才实现必要 indentation padding；同样先复现再修复 literal code quote 被误当容器前缀、首行代码项的真实列表 marker 被跳过，以及 task prefix 将代码变成正文的问题。初始夹具中的子树空白期望随结构性要求修正，新增断言同时检查解析结构和字面输出。

最终实际执行结果：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run web/test/acceptance-list.test.ts web/test/session.test.ts` | 2 files passed；69 tests passed（新增 45，既有 session 24） |
| `npm test` | 12 files passed；236 passed、1 skipped、0 failed；共享工作区当次快照总数 |
| `npm run typecheck` | 退出码 0 |

既有 S1 parent/descendant indent/outdent、最外层 outdent 不变、S5 fenced/indented-code Enter 和真实 ordered/task continuation 回归保留并通过。唯一默认跳过项为 export 的 `checks real browser fonts, image decode, print wrapping and formula overflow`，由 `RET_EXPORT_BROWSER=1` 开启；本轮没有开启该独立导出浏览器测试。

## 剩余边界

- task conversion 对“首行正文已经是 fenced / indented code”的列表项保持不变；直接加 checkbox 会破坏代码 grammar。该保守规则有两项回归。普通正文项以及后续包含代码的任务项转换仍覆盖。
- 验证层级是实际编辑命令、CM state/session transaction 和 grammar；本轮未执行浏览器 DOM、原生菜单或磁盘保存 UI 验收，也未重建共享应用包。控制器整合后仍需在最终应用抽查原始 AC2 选区/菜单/保存流程。
- 本报告只交付 AC2，不代表其余验收项或整版 V1 已通过。
