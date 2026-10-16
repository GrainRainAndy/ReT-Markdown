# 2026-10-16 二次复验修复结果

独立复验的两个P2已稳定复现并完成代码修复；当前候选为 `build/candidate-20261016/ReT Markdown.app`。独立复核Spec/Quality已PASS，冻结源码性能采样已完成，完整V1原生验收仍未通过。

## 修改与边界

- F08：实时公式使用完整文档解析出的math token，保留容器上下文及原始UTF16位置；不通过删除大于号的正则修饰TeX。完整文档renderer与实时annotation一致，无效公式保留相同错误源文/坐标。实现见[公式报告](reacceptance-math-fix.md)。
- F07：表格根选区超出单一内容cell时显示源文，包括对齐分隔行、外层pipe、跨cell/跨行/表格边界。位于内部隐藏语法中的caret仍显示源文以继续编辑；首尾Tab退出行为保留，单元格编辑继续使用mini-view。实现见[表格报告](reacceptance-table-source-fix.md)。
- 产品修改涉及 `web/src/live/decorations.ts`、`web/src/live/cell-widget.ts` 和 `web/src/render/markdown.ts`；没有新增history、改写源文或修改原生Swift实现。

## 冻结后的验证

| 检查 | 实际结果 | 证据（build/verification/） |
| --- | --- | --- |
| 原始独立边界脚本 | 3/3通过；修复前2失败/1通过 | reacceptance-final-boundaries.log、reacceptance-controller-red.log |
| Web完整单测 | 298通过/1可选跳过，14文件 | reacceptance-final3-web.log |
| TypeScript | exit0 | reacceptance-final3-typecheck.log |
| 真实浏览器完整交互 | 95/95，含原68与新增27项 | reacceptance-final3-browser.log |
| 显式开启Web导出运行时 | 22/22通过，不重复计入常规单测数 | reacceptance-final-export-runtime.log |
| 实际WKWebView分页PDF | 1/1通过，27页A4，中文代码搜索检查通过 | reacceptance-final-pdf-runtime.log、reacceptance-final-pdf-runtime-detail.log、reacceptance-final-pagination.pdf |
| Release组装与ad-hoc签名 | 构建成功，strict/deep验证通过 | reacceptance-final3-build.log |
| 浏览器性能 | 18组各20次、零错误/源码变化，regular live输入P95 49.8ms，boundary live打开564.5ms | build/performance-reacceptance-final/performance.json |

原生Swift未修改，83通过/1可选跳过的原生单测是本轮独立验收者08:47检查点 `reacceptance-native.log`，没有将其冒称为修复后重新执行。PDF另行使用既有测试可执行文件与新候选包Web资源执行，外部60秒截止，最终候选在60秒外部截止内正常完成，详细耗时见日志。

候选逻辑大小11,954,223字节，83份Web资源逐字节一致。清单 `reacceptance-final-bundle.json`；当前产品/测试/配置哈希 `reacceptance-final-source-sha256.json`。两个旧副本 `build/ReT Markdown.app` 与 `build/release/ReT Markdown.app` 均与各自历史清单逐文件一致，未覆盖或关闭它们。

## 原生证据限制

本轮CUA重试仍报 `Sky Computer Use native pipe startup failed`，没有新的原生窗口截图或手动交互。真实IME、系统关闭设置/Versions、完整Typora视觉矩阵及原生Release规定性能仍待验收；Chromium与PDF运行时不能代替这些项目。

只读输入来源查询在08:56:57返回`com.apple.keylayout.ABC / ABC`。此前恢复待确认事项解除，本轮未执行输入来源切换；这不是输入法候选组词验证。

## 独立审查追加边界及关闭

Astra复核追加R1：跨cell选区收起后无mini caret，继续输入错落after；R2：真实生产样式的80/160/200段落远距离查找，CM有界测量退出后留下pending scroll；R3：省略外侧pipe使cell与table端点相同，空caret交接会把显式Tab退出拉回mini。均已完成有效RED→GREEN并独立关闭，最终[复核报告](reviews/reacceptance-fix-review.md)的三个产品SHA256与当前冻结源码一致，无未闭合实际P2。

R1最终仅在root本身拥有焦点时交接空caret，保留mini已有选区/合成结束后的剪切。R2通过公开updateListener在select.search下一帧请求公开requestMeasure，原scroll effect完成滚动；未读取私有字段、未提高内部预算或直接操作scroll。首轮仍可能出现CM的bounded-loop warning，第二帧已完成滚动，不隐藏该警告。R3用局部UI exitPosition区分显式退出意图，不进入文稿/history。

中间空caret实现曾引起旧L3/L4两项失败，已修复且未修改旧断言；旧失败日志`reacceptance-final-browser.log`保留。后续91项曾通过，追加合法optional-pipe控制后最终95项全部通过。第一次86项日志与早期候选仍保存为历史，不能替代当前清单。所有自有subagent/probe已退出，性能采样期间不执行其他自有构建、测试或原生UI。

独立审查配置为Astra high；报告中执行者自述为Codex，不把其自述当作底层模型路由证明。本轮未使用Luna。

## 最终性能与交付

固定原脚本/夹具/预算完成18组各20次（2026-10-16 01:10:39–01:12:04 UTC），exit0、errors[]、sourcesChangedDuringRun[]。常规256KiB source/live输入P95分别32.1/49.8ms，live打开130.8ms；1MiB source/live打开103.0/564.5ms，live输入208.9ms为诊断项，不适用50ms常规比较线。49.8ms接近50ms上限，不承诺原生指标或后续负载余量；用户其他工作负载未受控，不能将与上一轮差异直接归因于代码变化。所有本任务子代理/探针、其他重测试及原生UI操作在本次采样前结束。

最终候选 `build/candidate-20261016/ReT Markdown.app`。切换到新候选前，先保存旧版文稿并退出旧版，再从新路径打开，避免同bundleID运行实例路由到旧版。没有替用户退出或覆盖原应用。完整V1仍按原生未完成门槛推进。

## 后续版本化交付

用户要求使用明确版本号，现交付为 [0.1.0-rc.1](../releases/0.1.0-rc.1.md)，正式版目标 `0.1.0`。本报告上述路径、失败和性能记录仍归属原冻结检查点，不改名覆盖。用户重启后台后 CUA 已恢复；新版独立 QA 的打开、公式、表格语法查找、字节保真另存为及原生 PDF 抽查见[版本化原生报告](0.1.0-rc.1-native-smoke.md)。
