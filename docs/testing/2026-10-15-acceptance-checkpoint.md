# 2026-10-15 验收历史检查点

本文为历史记录；当前候选与证据以[验收状态](acceptance-status.md)为准。

2026-10-15。需求基线见[设计文档](../specs/2026-10-14-markdown-editor-design.md)。实现和自动回归已有可运行构建，**目前不宣称完整 V1 验收通过**。四项整体审查 P2 已修复并独立复核通过。实际快捷键另存为错误已定位为AppKit的Duplicate菜单路由冲突，修复后原生快捷键进入正确面板；原生输入法、系统生命周期、完整视觉对照和原生 Release 性能仍有未验证项。

## 当前验证证据

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 网页核心 | 189通过、1运行时可选项跳过；该运行时另行开启，所在export套件22/22通过 | `build/final-web-tests.log`、`build/final-export-runtime.log` |
| 原生单元及集成 | 共84项，83通过、1图形PDF可选项跳过，零失败；PDF另行开启通过 | `build/final-native-tests.log` |
| TypeScript | 通过 | `build/final-typecheck.log` |
| Release组装及签名 | 通过；本地ad-hoc签名，不是已公证的分发版本 | `build/final-build.log`；`codesign --verify --deep --strict` |
| 真实Chromium交互 | 32通过 | `build/final-browser-tests.log` |
| 打包网页桥接/历史/剪贴板 | 通过 | `build/final-session-browser.log` |
| 离线资源、宽度断点及打印样式 | 通过 | `build/final-render-browser.log` |
| 实际WKWebView原生打印 | 独立开启的1项通过，27页A4，中文及代码可搜索 | `build/final-pdf-runtime.log`、`build/verification/native-pdf-runtime.log`、`build/verification/native-pagination.pdf` |
| 实际应用首次保存和PDF入口 | 测试文稿88字节与输入一致；实时/源码导出文字及72dpiPNG一致 | [原生操作记录](native-ui-smoke.md) |
| 浏览器性能 | 最终网页18组各20次，常规实时输入P95 48.3ms，边界打开P95 844.2ms | [性能报告](performance-report.md)；不能代替原生Release验收 |

上述日志对应修复后的最终干净源码；Release包逻辑大小11,950,713字节（约11.40MiB），83份网页资源与构建输出逐字节一致，签名验证通过，临时诊断开关及代码已移除，清单为`build/verification/final-bundle.json`，源码/测试/配置指纹为`build/verification/final-source-sha256.json`。两项默认跳过的运行时检查均已另行开启并通过，不将它们重复计入常规测试数量。自动测试中的合成composition不证明真实输入法候选、取消、删除或撤销已通过。

## T01—T25追踪

“自动覆盖”只表示对应层级有实际证据。存在原生界面场景时仍保留该项，而不是将整个编号标成通过。

| 编号 | 已有证据 | 剩余验收或缺陷 |
| --- | --- | --- |
| T01 | TS/Swift相同9夹具字节往返；实际固定样本无编辑保存哈希不变 | 混合换行/BOM在最终原生应用完整保存矩阵 |
| T02 | UTF-16局部补丁、未修改字节/EOL保真回归 | 原生编辑后逐区间磁盘比较 |
| T03 | 真实浏览器模式/配色/焦点映射；原生CmdSlash不标脏 | 原生配色变更及复杂选区矩阵 |
| T04 | 实际CM DOM合成composition及屏障回归 | 真实中文输入法候选、取消、删除、撤销；当前CtrlSpace未进入组词 |
| T05 | 单一根历史、BOM/EOL、双模式及表格浏览器回归 | 原生连续编辑/切换/撤销及Save As后历史 |
| T06 | 三种列表符号、续项及嵌套命令回归 | 原生键盘交互抽查 |
| T07 | 原生路径身份去重/合并打开实现及测试 | Finder/打开面板重复路径、别名、多窗口 |
| T08 | NSDocument自动保存与恢复储存回归 | 两种系统关闭设置、退出重开、实际Versions界面 |
| T09 | 真实公共Save/menu和autosave/menu有外部截止及heartbeat；失败重试/版本竞态；原生CmdShiftS路由修复及实际面板验证 | 最终构建复杂文稿保存期间输入、失败重试和面板完整落盘矩阵 |
| T10 | 指纹、外部修改冲突及保存后确认失败重试回归 | 两进程实际clean/dirty修改、冲突面板选择 |
| T11 | 草稿图片暂存、首次保存迁移、冻结字节与恢复回归 | 原生图片粘贴、首次保存取消/失败及重开 |
| T12 | 重名、路径、SaveAs独立恢复命名空间、撤销别名/版本资源储存回归；跨行定义FR-3已复核 | 实际图片另存/撤销/版本UI |
| T13 | 隐藏标记搜索、一次撤销全部替换回归 | 原生查找面板抽查 |
| T14 | 实际应用两种模式相同样本PDF文字/像素一致 | 最终修复构建复杂样本复测 |
| T15 | 实际27页A4，文字边界位于20mm内；中文代码可提取；查看首末页白底公式/表格 | 更完整图片/公式视觉矩阵 |
| T16 | 长代码/跨页表格真实PDF，溢出错误及源文范围回归 | 页末标题、特殊宽公式等原生专用矩阵 |
| T17 | 冻结快照、失败/取消保护旧输出及原子替换回归 | GUI导出时继续编辑、取消及输出失败 |
| T18 | 核心资源本地打包；真实浏览器阻断网络并记录零外部请求 | 原生全工作流断网复测 |
| T19 | 最终网页稳定浏览器20次序列；当前Release包约11.40MiB | 原生Release冷启动/打开/输入/RSS/IME/PDF规定序列 |
| T20 | 未支持语法、HTML、元数据字节保真回归 | 原生修改其他段落后磁盘抽查 |
| T21 | 真实CM单元格、Tab边界、右键行列、撤销/粘贴/cut回归 | 原生鼠标/输入法完整组合矩阵 |
| T22 | 默认纯文本粘贴、剪贴板图片专用入口回归 | 网页/Word实际OS剪贴板及图片粘贴/拖放 |
| T23 | 不联网占位、编码URL不改写、离线PDF回归；引用式图片FR-2及跨行定义FR-3已复核 | 最终原生应用断网及图片授权组合矩阵 |
| T24 | 源文/纯文本/HTML含回退复制、引用上下文回归 | 原生粘入支持HTML目标的实际效果 |
| T25 | 当前Typora主题资源与冻结基线、浏览器计算样式/断点回归；实时JS/Python/JSON高亮FR-4已复核 | 完整同视口/缩放的Typora视觉对照 |

正文链接FR-1及FR-2/4见[实时编辑定向复核](reviews/final-live-fix-review.md)，FR-3见[资源定向复核](reviews/final-assets-fix-review.md)，快捷键根因及真实验证见[另存为修复报告](native-save-as-fix-report.md)。各原始R2/R5、L1—L4、S1—S5及渲染/导出范围问题也已有独立定向复核通过；整体代码结论见[最终审查](reviews/final-review.md)。

## 运行

使用Finder打开仓库的`build/ReT Markdown.app`。CmdSlash切换源码模式，CmdS保存，CmdShiftS另存，CmdShiftE导出PDF；Cmd-click打开正文链接。当前作为本地开发预览，完整原生验收仍按上表推进。

本轮遵循用户指定分工：Astra high负责架构、复杂保存/资源/实时编辑及整体审查；6.1 Sol high负责常规实现和定向审查；未使用Luna。
