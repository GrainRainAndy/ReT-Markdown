# 首版验收状态

2026-10-21 更新。当前候选为 `0.1.0-rc.1 / ba965c55`，正式版目标为 `0.1.0`。交互与关闭确认补修已经独立复核、完整自动检查及包校验；固定 QA 已更新并完成本轮交互原生重放；真实 IME 预编辑退格仍待人工/轨迹确认，完整 V1 验收尚未完成。

## 本轮身份与验证

主实现见[交互补修报告](0.1.0-rc.1-interaction-implementation.md)，审查见[独立审查](reviews/0.1.0-rc.1-interaction-review.md)，持续处理要求见[流程](editor-interaction-workflow.md)。`3a194e16…`、`2dc6618e…`、`49cf5a81…` 均为历史检查点，原结果不迁移成新候选通过。

| 项目 | 当前结果 |
| --- | --- |
| 源码 identity | `ba965c55c4aeb03fd691ea47ccc54ddd2a9b3d97a015809aac90e01d7add871f`，135 项输入；冻结时间与算法见 run.json |
| 自动检查 | TypeScript 单元 5,425 通过/1 可选 skip；类型检查通过；浏览器 243 通过；Swift 97 通过/1 可选 skip；实际 WKWebView PDF 另 1 通过（包内资源） |
| 独立审查 | TS 合并审查及桥接补修复审无剩余 Critical/Important；六种无法保证代码保真的结构移动明确为整事务 no-op，不算成功缩进 |
| canonical 包 | `build/releases/0.1.0-rc.1/465505e-ba965c55/ReT Markdown.app`；83 Web 资源一致、12,022,585 逻辑字节、严格 deep ad-hoc 签名通过；135 项输入无变化 |
| 固定 QA | 15:24 确认完全退出后成功发布 `ba965c55…`；资源、可执行代码和签名校验通过，启动及复用连接无新审批等待。历史 PID 8197 拒绝记录保留 |
| 原生交互 | 当前 N1–N6、N8、N9 有界重放通过；N7 中文确认/组词/取消/跨段 Undo 已验，预编辑退格仍待确认。详见[原生补验](0.1.0-rc.1-native-interaction.md) |

同一轮原始证据目录为 `build/verification/0.1.0-rc.1/interaction-implementation-20261021/`：run.json、source-inputs.json、bundle.json、verification.json、final-*.log。可选导出运行时单独记录，不重复累计常规计数。固定 QA 按[身份流程](qa-application-identity.md)更新，原生关键项未完成不宣称完整正式版通过。

## 2026-10-16 历史证据

历史候选：[`0.1.0-rc.1` 版本化包](../../build/releases/0.1.0-rc.1/ReT%20Markdown.app)。当时 9 类交互排版反馈及二次复验的 F07/F08 缺陷已修复，独立 Spec/Quality 复核通过；该结论仅属历史范围。版本化构建及当时原生抽查见[版本说明](../releases/0.1.0-rc.1.md)与[历史原生抽查报告](0.1.0-rc.1-native-smoke.md)。下表行为测试属于版本整理前的冻结证据，不表示在本轮源码或最终包上重新执行。

| 检查 | 历史结果（2026-10-16） | 记录 |
| --- | --- | --- |
| Web完整单测 | 298通过、1可选运行时跳过 | build/verification/reacceptance-final3-web.log |
| TypeScript | 通过 | build/verification/reacceptance-final3-typecheck.log |
| 真实浏览器交互 | 95/95通过 | build/verification/reacceptance-final3-browser.log |
| 原始二次复验边界 | 3/3通过，修复前2失败/1通过 | build/verification/reacceptance-final-boundaries.log |
| 原生单元/集成 | 当时独立验收检查点83通过、1可选PDF跳过；修复前后原生源码/测试哈希一致，未重复冒称新运行 | build/verification/reacceptance-native.log |
| Web导出运行时 | 显式开启22/22通过 | build/verification/reacceptance-final-export-runtime.log |
| 真正WKWebView PDF | 当时新候选包资源；独立开启1项通过，27页A4，中文及代码可搜索 | build/verification/reacceptance-final-pdf-runtime-detail.log、reacceptance-final-pagination.pdf |
| Release/资源/签名 | 构建成功、83份Web匹配，11,954,223逻辑字节，ad-hoc strict/deep验证通过 | build/verification/reacceptance-final3-build.log、reacceptance-final-bundle.json |
| 独立复核 | Spec/Quality PASS，三个产品文件hash与当时最终源码一致 | [复核报告](reviews/reacceptance-fix-review.md) |
| 浏览器性能 | 冻结版本18组各20次完成，零错误/源码变化；regular live输入P95 49.8ms，boundary live打开564.5ms；不代表原生Release性能 | [性能报告](performance-report.md) |

两个可选运行时检查当时另行开启，不重复计入常规测试数量。历史记录保留了原 `build/ReT Markdown.app` 与上一轮 `build/release/ReT Markdown.app`，并记录当时哈希未变。上表历史冻结源码/测试/配置清单为 `build/verification/reacceptance-final-source-sha256.json`；2026-10-16 版本化包的历史清单见下文。

修复范围、有效RED/中间失败、最终日志及限制见[二次复验结果](2026-10-16-reacceptance-results.md)，此前9类反馈见[首次结果](2026-10-16-acceptance-results.md)。[2026-10-15历史检查点](2026-10-15-acceptance-checkpoint.md)保留，不作为当前候选的测试数量或版本证据。

## 尚待完成的整体验收

- 关闭 ACK 修复后本轮输入/保存/撤销/关闭重开及取消关闭继续编辑已通过；完整系统设置/退出矩阵仍未覆盖。
- 真实中文 IME 的候选、组词、两模式取消及跨段一次 Undo 已实测；预编辑退格后继续选词在 ReT/Typora 的自动操作下同样异常，待手工或轨迹确认，不归因为已确认产品缺陷。连续 composition 与排队原生命令等剩余组合仍待覆盖。
- 两种系统关闭设置、退出重开、Versions及外部冲突的完整原生UI矩阵。
- 最终候选完整连续编辑/保存/图片/剪贴板/导出的原生工作流。
- 当前Typora同视口、缩放及浅深色的完整视觉对照。
- 原生Release规定的冷启动/打开/输入/RSS/IME/PDF性能序列。

2026-10-16 历史记录：Computer-Use 在用户重启后台后恢复，版本化 QA 当时完成打开、公式显示、表格语法查找、另存为字节保真及原生 PDF 导出抽查；早期 native pipe 失败是当时限制。该工具恢复及抽查没有替代完整验收矩阵。该历史源码/测试/配置清单为 `build/verification/0.1.0-rc.1/source-sha256.json`；历史包清单为 `build/verification/0.1.0-rc.1/bundle.json`，当时大小 11,954,469 字节、strict/deep 签名有效，均不代表本轮最终身份。

## T01—T25追踪

下表保留 2026-10-16 的历史追踪，表内“本轮”“当前”“最终”等措辞均指当时检查点，不是 2026-10-21 补修后验收结论；数量、大小及通过项不得跨身份沿用。自动覆盖仅表示对应层级有实际证据，需求以[设计基线](../specs/2026-10-14-markdown-editor-design.md)为准。**待主控更新：** 冻结后逐项补充本轮证据与剩余门槛。

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

原生验证前按 QA 身份流程核对主控指定的包；运行中的 QA 不替换、不自动退出，不触碰用户未保存文稿。当前最终候选入口待主控冻结后填写。CmdSlash切换源码模式，CmdS保存，CmdShiftS另存，CmdShiftE导出PDF；Cmd-click打开正文链接。每个窗口一份文稿，没有tabs或sidebar。本地ad-hoc构建尚非已公证分发版本。

历史分工记录保留：Astra high负责复杂实现与架构/复核，6.1 Sol high负责一般实现与定向审查；2026-10-16 二次修复委派与独立审查均配置Astra high，未使用Luna。
