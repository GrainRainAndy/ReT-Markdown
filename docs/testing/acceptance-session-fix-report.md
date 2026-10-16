# AC1 / AC6 / AC8 / AC9 根编辑器修复

2026-10-16。依据真实验收反馈与[修复计划](2026-10-16-acceptance-fix-plan.md)。本报告只覆盖主控分配范围，语法投影和表格交互由独立Astra任务处理。

## 根因与修复

- AC1：transport的load设置选区、模式、配色、缩放后返回loaded，但没有调用CM的focus。现在在完成这些配置后聚焦现有根view，未新建state/history。实际transport的空白live/source载入后，不点击编辑区直接键入abc均产生正常commit。
- AC6：原生MenuController搜索sheet缓存query/replacement；session还另有searchOptions缓存，CM panel又有自己的SearchQuery。现移除原生sheet和session缓存，菜单直接转发同一find/replace/replaceAll命令，mounted编辑器统一调用CM公开查找/替换命令并读取唯一SearchQuery。保留已有命令payload与无view的测试接口。根快捷键也进入同一command路径，组词期间沿用已存在的defer行为。
- AC8：原session将编辑器设为#0d1117，而外围palette为#1e1e1e。现前景/背景/caret使用已有body变量。空文稿与长文稿的body、正文容器和根CM背景均为rgb(30,30,30)，浅色切换源文不变。
- AC9分配部分：根.cm-scroller明确line-height:1.6，覆盖CM默认1.4；实际CM计算值回归验证。段落/表格/公式几何属于投影任务，不在此宣称通过。

## 文件

- `web/src/main.ts`
- `web/src/editor/session.ts`
- `Sources/ReTMarkdown/App/MenuController.swift`
- `web/test/acceptance-session.spec.ts`
- `web/test/final-live-browser-harness.ts`：仅增加可选初始mode参数，默认live不变，用于直接验证源码模式load而不是载入后切换。
- 本报告

## 证据

初始7个真实Chromium行为回归全部RED，日志`build/verification/acceptance-session-red.log`：两个加载焦点、查询/替换状态两个、深色空白/长文稿两个、根行高一个。修复后7/7GREEN。随后增加真实CmdF/CmdG与菜单等价bridge命令共用同一面板/查询，并验证replace入口聚焦替换框；最终8/8GREEN，日志`acceptance-session-green.log`。

替换回归通过真实CM面板改变replacement，再从bridge发replaceAll；一次undo恢复完整BOM与混合EOL输入字节。单纯查找不提交源文事务。没有新增搜索对话框或第二撤销栈。

同一原生基线在正常系统权限下84项/1skip/零失败，日志`build/verification/acceptance-native-unsandboxed.log`；对照原沙箱拒绝日志不能将其直接判为产品错误。这是修改菜单前的基线复核，最终源码原生全套、打包入口和真实CmdN/菜单查找仍需整合后执行。

当前真实IME、最终原生交互及完整视觉/性能验收未通过本报告替代。代码仍待独立定向复核。

## AS-1 定向复核后的撤销边界修复

独立Astra审查确认：CM自带replaceAll事务没有isolateHistory，紧接着覆盖首个替换结果的input.type会被合并到同一撤销事件。原先headless分支使用target.edit已隔离，不能作为mounted路径证明。

新增实际浏览器精确序列：从查找框提交替换字段 → bridge或真实面板按钮Replace All → Escape → 立即键入覆盖所选首项 → Undo。修复前两种入口均失败，日志`build/verification/acceptance-replace-boundary-red.log`。初始探针把光标移到尾部，未覆盖相邻变更，已按独立审查的精确选区调整，未以该探针误判修复。

根state新增transactionExtender，仅对实际`input.replace`文稿修改补`isolateHistory.of('full')`；保留CM的查询、替换实现和唯一history。因而原生等价命令和面板按钮都得到同样隔离。新增前序键入控制验证三个独立undo，第二次撤销替换、第三次撤销此前键入，字节恢复BOM/混合EOL。最终11/11实际浏览器回归通过，`acceptance-session-green.log`。

headless查找/替换保留旧纯函数接口，与CM的正则capture和行锚点语义有已记录差异；本轮产品mounted路径均调用CM，未以headless测试认证这些UI特性。最终代码需AS-1定向复核后才能关闭该项。
