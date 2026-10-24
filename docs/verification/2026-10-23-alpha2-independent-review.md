# alpha.2 独立复验结论

> 后续进展：[2026-10-24 可见桌面原生复验](2026-10-24-alpha2-native-review.md)。公式失焦、若干关闭路径和菜单 PDF 已补证，但发现真实拼音关闭取消后的残留输入 B08，当前验收不通过。以下保留 10 月 23 日的历史结果。

日期：2026-10-23，19:33–19:36（Asia/Shanghai）。**自动修复层复验通过；整体产品验收仍待完成，本轮不签署整体通过。**

上一轮确认的围栏输入阻断、空特殊块插入、表格投影等问题，在本轮覆盖的模型、Chromium 和原生自动化范围内未再复现。关闭回调、退出前审阅、组合态屏障、恢复清理及无效测试覆盖已有实质修复。本轮没有新增已确认的产品阻断缺陷，但真实系统 IME、原生退出矩阵和可见窗口中的公式失焦仍缺独立通过证据。未验证不等于失败复现，也不能据此签署通过。

## 1. 候选与独立性

- 分支：`rewrite/from-zero`；开始时文档 HEAD `b27f62ef4b3eda5928ee8a4173cb6b99de00c531`。
- 产品源码：`8e9c0d4342ef5e623ed03599f7a4b64f7e9ac8ac`。
- 应用：`0.2.0-alpha.2 (2)`，`build/rewrite/0.2.0-alpha.2/ReT Markdown Preview.app`。
- 本轮重新计算 89 个输入、73 个包文件，共 9,793,221 字节，均匹配提交方清单；严格 codesign 校验退出 0。
- 输入清单 SHA-256：`13e76dd1752f49101db4ee57c023c280ab8cdad980f4d58987f346c8394e8894`。
- 包清单 SHA-256：`949ee3f437a1eb08f28887afb13df5d53480a727141f6dbbe0a3899a68675778`。
- 环境：macOS 27.0.1 / 26A434，arm64；Node v26.12.1，使用命令级 PATH 前缀，未改系统配置。

已通过 `read_thread` 读取 [coder-team-1023](thread://01a15d74-ee0a-7b63-b3f0-60ad7c4fdf95) 的报送任务，并读取[提交方迭代记录](2026-10-23-iteration-2.md)。以下区分本轮独立执行结果与提交方既有原生观察；本轮不把旧 alpha.1 成绩当作新候选证据，也不把提交方的代码审查结论替代产品验收。

本轮原始证据位于 [`build/rewrite/verification/2026-10-23/alpha2-independent/`](../../build/rewrite/verification/2026-10-23/alpha2-independent/)，简称 `I/`。包含身份核验、日志、独立探针、截图、生成的 PDF 及子进程证据。该目录被 Git 忽略，交接时需保留。

## 2. 本轮实际执行

| 项目 | 独立结果 | 证据与限制 |
| --- | --- | --- |
| `npm test` | 238/238，8 文件通过 | `I/logs/unit.log` |
| `npm run typecheck` | 退出 0 | `I/logs/typecheck.log` |
| 全量包内 Chromium | 119/119，27.4 秒通过 | `I/logs/browser.log`；使用实际 alpha.2 包内 Web，未重建 Web |
| 独立最小场景 | 6/6，5.0 秒通过 | `I/independent.spec.ts`、`I/logs/independent-browser.log`；不同于直接接受开发方结论 |
| Swift 全套 | 首次 80/81 通过，1 项证据复制失败 | `I/logs/native.log`，104.831 秒；详见下段 |
| 失败用例定向重跑 | 1/1 通过 | `I/logs/native-evidence-retry.log`；全部 81 个用例最终有本轮成功记录，**不是一次全套 81/81 绿灯** |
| 恢复清理后退出/重开 | `cleanup=true records=0 controllerRemoved=true`，重开 `records=0` | `I/lifecycle/child-exit-reopen-823CD82E-5681-4355-AA7A-AA9ABA4CA42F/`；隔离子进程在产品关闭完成边界立即退出 |
| 实际导出服务 | 生成普通样本 7 页、长图样本 3 页；对应输出测试通过 | `I/pdf/`；本轮未重新逐页视觉验收，不继承为本轮原生菜单操作成功 |
| CUA 原生候选 | `getApp` 精确 alpha.2 路径返回 `cgWindowNotFound`；应用清单显示运行中 | 未取得可操作窗口，未向未知窗口输入、未强制终止进程 |

首次原生失败是本验收执行准备不足：`RET_LIFECYCLE_EVIDENCE` 指向尚未创建的父目录，`testChildExitAndReopen` 已完成行为断言后在 `copyItem` 保存证据时抛出 Cocoa Code 4。确认目录不存在后，仅创建该目录并重跑此用例，成功导出退出/重开记录；未修改产品或测试断言。首次日志完整保留，不将该复制失败计为产品回归。

包内测试使用以下环境变量，避免误测开发输出：

```sh
RET_TEST_WEB_ROOT="$PWD/build/rewrite/0.2.0-alpha.2/ReT Markdown Preview.app/Contents/Resources/web"
RET_TEST_WEB_ENTRY="$RET_TEST_WEB_ROOT/index.html"
```

浏览器命令使用 `RET_TEST_WEB_ROOT=… npm run test:browser`；原生命令使用 `RET_TEST_WEB_ENTRY=… RET_PDF_VERIFICATION_DIR=… RET_LIFECYCLE_EVIDENCE=… swift test --package-path native`。独立探针用其自身 Playwright 配置，在 4288 端口服务同一包内资源。完整独立最小场景可由下式复跑：

```sh
PATH=/opt/homebrew/Cellar/node/26.12.1/bin:$PATH node node_modules/@playwright/test/cli.js test \
  -c build/rewrite/verification/2026-10-23/alpha2-independent/playwright.config.ts
```

## 3. 上轮问题的关闭层级

| 编号 | 本轮判断 | 仍不能据此声明的内容 |
| --- | --- | --- |
| B01 围栏后输入丢失 | **L2 通过。** 独立逐键输入三个反引号、Enter、`xhello`、Enter、`world`，源码精确为 `"```\nxhello\nworld"`，代码焦点正确；开发回归另覆盖语言名、波浪号、撤销及模式往返 | 提交方报告有原生保存重开观察，本轮因 CUA 失联未独立重复 |
| B02 空特殊块 | **L1/L2 通过。** 独立核对裸 ` ```js `、空引用围栏、CRLF 空列表围栏、裸 `$$` 的完整源码；模式往返及 Undo/Redo 后精确还原，无恢复框 | 真实中文组合输入和完整嵌套原生矩阵 |
| B03 关闭回调重入 | **原生自动化通过。** 源码现在保留所有 closeWaiters；全套中的重入、保存准备超时、迟到提交隔离及取消后续写用例通过 | 实际 Cmd+Q、红钮、Cmd+W/关闭全部交错与系统 sheet 的全矩阵 |
| B04 表格缺格/超额格 | **L1/L2 通过。** 全量重跑含虚拟格导航、编辑时物化、超额源文保留、转义边界、撤销；已核对断言验证实际预期 | 原生拖选、该类表格保存重开 |
| B05 内联对象 marks | **L1/L2 通过。** 投影/导出及链接图片 Cmd-click 桥接回归通过 | 原生外部打开应用交接 |
| B06 缩进误建空段 | **L1/L2 通过。** 修复与对应回归通过 | 不由此宣称所有空白、嵌套输入场景已完成原生验收 |
| B07 组合态 flush | **合成事件/WK 自动化通过。** pending 保留到提交，超时、取消和迟到响应测试通过；源码不再收到 composition pending 就立刻完成保存回调 | 系统拼音候选提交、取消、预编辑退格、组词中保存/关闭 |
| R01 clean native 退出缺口 | **原生自动化通过。** controller 将所有文稿纳入审阅，覆盖 Web-only pending、多文稿、新增文稿、取消释放 hold | 实际 Quit Apple Event / Cmd+Q 的系统终止结果 |
| R02 恢复记录迟删 | **隔离子进程通过。** 删除完成后才移出控制器；退出完成边界立即终止并重开，记录为 0 | 用户现存恢复记录的人工启动/恢复界面操作 |
| EV01 无效重载测试 | **覆盖缺口已关闭。** 测试安装真实 host，并等待 `hasReloadBarrier`、断言 reloadToken，再注入状态变化；本轮运行通过 | 真实文件监视和冲突 sheet 交互 |
| UX01 高亮 | **声明语言范围内 L2 通过。** JS 与 C/C++ 离线 token、语言重配、反向选区和源文不变回归通过 | Python/TypeScript 等目前为纯文本；不能称为全部语言高亮支持 |
| UX02 数学失焦 | **Chromium 通过，原生仍待确认。** 独立选中公式源码首字符、点击后段落，源码隐藏，键入 `!` 得到精确 `after!`；已查看截图 | 提交方的可见 WK/AX 失焦异常尚无可靠终态；隐藏宿主中执行 rAF 的诊断不能替代可见窗口验证 |

B02 独立精确期望包括：`"```js\nx"`、`"> ```\n> x\n> ```"`、`"- ```\r\n  x\r\n  ```"`、`"$$\nx"`，不只是检查字符串包含 `x`。这避免再次将“保留了字符但语法归属错误”当作通过。

## 4. 外观和样式扩展判断

X01/X02 已有更明确的状态契约和特殊块实现，本轮自动层证据支持其已覆盖部分；完整 E01–E45 原生矩阵仍未完成。

X03 的提交方测量记录详细列出了字体、行高、字号、间距、选区、视口和偏差，比“总体类似 Typora”可审查。但参考 CSS 声明、参考原生观察、产品 Chromium 数值是不同证据；实际 Typora 字体/逻辑视口与原生 WK 对齐仍未冻结。本轮没有重做 Typora 视觉采样或接受全部视觉偏差，所以 X03 保持**部分完成、待视觉验收**。

X04–X06 已形成[样式扩展后续里程碑](../specs/style-extension-milestone.md)，含版本化 Style API、独立用户目录、选择/导入/编辑/预览/重载/默认恢复和固定打印边界。**这是计划，不是 alpha.2 已实现的自定义主题功能。** 后续验收须包含示例主题、重启及升级保留、失败回退、正文/dirty/选区/撤销不变；不得用这份计划代替功能交付。

## 5. 整体验收保留项与下一次操作

本轮 CUA 再次返回 `cgWindowNotFound`，只读清单显示 Preview 正在运行。已请求恢复可见桌面/窗口；在取得窗口之前，原生操作受阻，不能推断崩溃、卡死或数学修复失败。本轮没有改动现存 GUI 文稿或恢复记录，没有重启用户应用。

后续应优先补以下证据，绑定同一 alpha.2 包；如再改产品则重新冻结构建：

1. 可见 WK 中：展开公式 → AX/鼠标选择源码 → 点击后续段落 → 确认渲染帧继续 → 续写。核对源码收起、光标、滚动和 Markdown；失败时记录焦点/帧时序，不凭隐藏窗口诊断猜测修补。
2. 新建/已保存且 dirty 的文稿，红钮/Cmd+W/连续关闭/关闭全部/Cmd+Q，分别保存、取消、放弃；覆盖保存中、多窗口以及取消后立即输入。核对最终窗口、进程、磁盘字节与恢复记录。
3. 真实系统中文 IME：组词中保存/关闭/退出，候选提交与取消、预编辑退格；观察 pending 是否正常续跑、取消后能否继续输入，无重复/丢字。
4. 原生菜单 PDF 的启动、进度、取消与最终写入；自动导出和已检查 PDF 的证据继续单独保留。
5. X03 原生外观差异、性能和 VoiceOver 等原方案未验项目仍未通过；自定义主题单独按下一里程碑交付。

本轮结论可用于接受当前修复的**已测层级**，不可用于整体通过、合并或发布授权。无产品修改、无合并/推送/发布；报告反馈给 coder-team-1023，alpha.1 失败记录继续保留。
