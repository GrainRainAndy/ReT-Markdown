# 首版验收状态

2026-10-16。当前候选：[`0.1.0-rc.1`](../../build/releases/0.1.0-rc.1/ReT%20Markdown.app)，正式版目标为 `0.1.0`。9类交互排版反馈及二次复验的F07/F08缺陷已修复，独立Spec/Quality复核通过；**完整V1仍未验收通过**。版本化构建及新的原生抽查见[版本说明](../releases/0.1.0-rc.1.md)与[原生抽查报告](0.1.0-rc.1-native-smoke.md)。下表原有行为测试属于版本整理前的冻结证据，没有冒称在新包上重新执行。

## 当前证据

| 检查 | 实际结果 | 记录 |
| --- | --- | --- |
| Web完整单测 | 298通过、1可选运行时跳过 | build/verification/reacceptance-final3-web.log |
| TypeScript | 通过 | build/verification/reacceptance-final3-typecheck.log |
| 真实浏览器交互 | 95/95通过 | build/verification/reacceptance-final3-browser.log |
| 原始二次复验边界 | 3/3通过，修复前2失败/1通过 | build/verification/reacceptance-final-boundaries.log |
| 原生单元/集成 | 本轮独立验收检查点83通过、1可选PDF跳过；修复前后原生源码/测试哈希一致，未重复冒称新运行 | build/verification/reacceptance-native.log |
| Web导出运行时 | 显式开启22/22通过 | build/verification/reacceptance-final-export-runtime.log |
| 真正WKWebView PDF | 新候选包资源；独立开启1项通过，27页A4，中文及代码可搜索 | build/verification/reacceptance-final-pdf-runtime-detail.log、reacceptance-final-pagination.pdf |
| Release/资源/签名 | 构建成功、83份Web匹配，11,954,223逻辑字节，ad-hoc strict/deep验证通过 | build/verification/reacceptance-final3-build.log、reacceptance-final-bundle.json |
| 独立复核 | Spec/Quality PASS，三个产品文件hash与最终源码一致 | [复核报告](reviews/reacceptance-fix-review.md) |
| 浏览器性能 | 冻结版本18组各20次完成，零错误/源码变化；regular live输入P95 49.8ms，boundary live打开564.5ms；不代表原生Release性能 | [性能报告](performance-report.md) |

两个可选运行时检查另行开启，不重复计入常规测试数量。原`build/ReT Markdown.app`与上一轮`build/release/ReT Markdown.app`均保留，哈希未变。上表历史冻结源码/测试/配置清单为`build/verification/reacceptance-final-source-sha256.json`；当前版本清单见下文。

修复范围、有效RED/中间失败、最终日志及限制见[二次复验结果](2026-10-16-reacceptance-results.md)，此前9类反馈见[首次结果](2026-10-16-acceptance-results.md)。[2026-10-15历史检查点](2026-10-15-acceptance-checkpoint.md)保留，不作为当前候选的测试数量或版本证据。

## 剩余整体验收

- 真实中文IME候选、组词、取消、删除与撤销。合成composition不能替代；输入来源只读检查当前已为ABC。
- 两种系统关闭设置、退出重开、Versions及外部冲突的完整原生UI矩阵。
- 最终候选完整连续编辑/保存/图片/剪贴板/导出的原生工作流。
- 当前Typora同视口、缩放及浅深色的完整视觉对照。
- 原生Release规定的冷启动/打开/输入/RSS/IME/PDF性能序列。

Computer-Use 在用户重启后台后恢复；版本化 QA 已实际完成打开、公式显示、表格语法查找、另存为字节保真及原生 PDF 导出抽查。早期 native pipe 失败属于历史限制；新的工具恢复和抽查结果没有替代以上完整验收矩阵。当前源码/测试/配置清单为 `build/verification/0.1.0-rc.1/source-sha256.json`；当前包清单为 `build/verification/0.1.0-rc.1/bundle.json`，大小 11,954,469 字节，strict/deep 签名有效。

## T01—T25追踪

自动覆盖仅表示对应层级有实际证据，需求以[设计基线](../specs/2026-10-14-markdown-editor-design.md)为准。

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
| T13 | 隐藏标记/表格分隔符及跨cell源文展开、远距离查找滚动、一次撤销全部替换回归；本轮独立复核通过 | 最终候选原生查找面板抽查 |
| T14 | 实际应用两种模式相同样本PDF文字/像素一致 | 最终修复构建复杂样本复测 |
| T15 | 实际27页A4，文字边界位于20mm内；中文代码可提取；查看首末页白底公式/表格 | 更完整图片/公式视觉矩阵 |
| T16 | 长代码/跨页表格真实PDF，溢出错误及源文范围回归 | 页末标题、特殊宽公式等原生专用矩阵 |
| T17 | 冻结快照、失败/取消保护旧输出及原子替换回归 | GUI导出时继续编辑、取消及输出失败 |
| T18 | 核心资源本地打包；真实浏览器阻断网络并记录零外部请求 | 原生全工作流断网复测 |
| T19 | 网页20次序列见性能报告；当前候选约11.40MiB | 原生Release冷启动/打开/输入/RSS/IME/PDF规定序列 |
| T20 | 未支持语法、HTML、元数据字节保真回归 | 原生修改其他段落后磁盘抽查 |
| T21 | 真实CM单元格、Tab边界、右键行列、撤销/粘贴/cut回归 | 原生鼠标/输入法完整组合矩阵 |
| T22 | 默认纯文本粘贴、剪贴板图片专用入口回归 | 网页/Word实际OS剪贴板及图片粘贴/拖放 |
| T23 | 不联网占位、编码URL不改写、离线PDF回归；引用式图片FR-2及跨行定义FR-3已复核 | 最终原生应用断网及图片授权组合矩阵 |
| T24 | 源文/纯文本/HTML含回退复制、引用上下文回归 | 原生粘入支持HTML目标的实际效果 |
| T25 | 当前Typora主题资源与冻结基线、浏览器计算样式/断点回归；实时JS/Python/JSON高亮FR-4已复核 | 完整同视口/缩放的Typora视觉对照 |

## 运行

先保存文稿并退出旧版，再用Finder打开当前候选。CmdSlash切换源码模式，CmdS保存，CmdShiftS另存，CmdShiftE导出PDF；Cmd-click打开正文链接。每个窗口一份文稿，没有tabs或sidebar。本地ad-hoc构建尚非已公证分发版本。

用户指定的分工继续保留：Astra high负责复杂实现与架构/复核，6.1 Sol high负责一般实现与定向审查；本轮二次修复委派与独立审查均配置Astra high，未使用Luna。
