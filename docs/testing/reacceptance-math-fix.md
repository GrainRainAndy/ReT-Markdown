# F08 引用内块公式修复交接

日期：2026-10-16。范围：实时公式投影与完整文档渲染一致性。按 systematic-debugging、TDD 和 verification-before-completion 执行；在共享工作区直接编辑，没有创建 Git 仓库、分支或 worktree。

## 根因与实现

原始独立复验中，引用内 `$$` 公式的实时 annotation 是 `> \\frac{1}{2}\n>`，完整文档 annotation 是 `\\frac{1}{2}`。`RenderWidget` 重新渲染原始 source slice 时，片段保留后续行的引用标记，却没有开启引用容器的上下文，所以这些标记进入 TeX。

根控制器将 math 加入 `renderInlineContexts` 的 relevant spans 后，修复前该函数仍只复用 image token；公式落入 inline fragment parser，多行块公式变成两个未闭合公式。新测试在此接线状态获得 RED。

`renderInlineContexts` 现在从完整文档 parse 的 token 及 inline children 中收集 `image`、`math_inline`、`math_block`，按原始 `from:to` 建立 Map。每个 range 精确查找对应 token，交给既有 `md.renderer.renderInline`。块公式内容已经由既有 parser 去除容器前缀；原 token 的 UTF-16 `from/to`、`closed` 与环境中的 original source 均保留。错误输出继续使用既有 math renderer，保留原始源文、错误消息和坐标。

索引构建和 range 查找整体为 O(T + R)，T 为遍历的 token 数、R 为请求 range 数，不再逐 range 对候选 token 执行完整 `find`。整文 parse 仍每次调用一次；仅公式文稿接线后新增的解析成本尚需根控制器的既定 20-sample 性能验证。

## 本执行者修改的文件

- `web/src/render/markdown.ts`：仅扩展文档上下文 token 的复用和 range 索引。
- `web/test/render.test.ts`：新增 9 项对应回归测试及所需 import，未修改既有测试行为。
- `web/test/reacceptance-math.spec.ts`：新增 9 项真实 Chromium 回归。
- `docs/testing/reacceptance-math-fix.md`：本报告。

未编辑 decorations、syntax、table、session、原验收材料或 build app。decorations 的 math 接线与表格修复均由根控制器完成。实现没有改写源文，没有增加历史或事务机制。

## RED → GREEN 证据

| 验证 | RED | 最终 GREEN |
| --- | --- | --- |
| 渲染单测 | 8 failed / 38 passed；新块公式测试因错误的未闭合公式和范围失败 | 46 passed；其中新增 9 项 |
| 新 F08 浏览器测试 | 9 failed；缺失 annotation、错误坐标和重渲染失败 | 9 passed |
| F08 + 既有 final-live 浏览器回归 | — | 19 passed |
| 原始独立复验 F08 子集 | 根控制器原日志：quote failed / list passed | 2 passed；quote/list 的 liveTex 与 referenceTex 均为 `\\frac{1}{2}`，零 math-error |
| 最终索引版本全量单测 | — | 298 passed / 1 skipped，14 test files passed |
| 最终索引版本类型检查 | — | exit 0 |

新增单测覆盖 quote、nested quote、list、quoted list；包含 Unicode、原始 CRLF 坐标、无效公式源文保留、错误隔离、inline-child 公式与重复错误的独立范围。

新增浏览器测试对 quote、nested quote、list 分别验证：

- live annotation 与完整文档 annotation 一致，并断言明确的 `\\frac{1}{2}`。
- 无效公式的错误消息、DIV、原始源文、UTF-16 data-from/data-to 与文档 renderer 一致。
- BOM/CRLF/CR 原始字节往返；点击公式展开，真实编辑器焦点及 caret 几何可见；revealRange 精确选中源文；source/live 切换；零多余 commit/history；真实键盘编辑后重新投影，再一次 root undo 恢复原始字节。

既有 final-live 的 10 项还验证 image/reference/link 上下文及代码编辑历史，均通过。

## 复跑命令与日志

工作目录：`/Users/grainrain/Developer/GitHub/ReT-Markdown`。

```sh
npm test -- web/test/render.test.ts
npm test
npm run typecheck
npx playwright test web/test/reacceptance-math.spec.ts web/test/final-live.spec.ts --workers=1 --reporter=line --timeout=15000 --output=/private/tmp/ret-f08-browser-indexed
npx playwright test --config=build/verification/reacceptance.config.ts --grep F08 --output=/private/tmp/ret-f08-original-green
```

浏览器测试在内存构建 harness（`write:false`），输出写入临时目录；没有覆盖原验收报告或打包资源。全量单测中的既有 build 单测也仅使用自己的 `/private/tmp` 目录。

- `/private/tmp/ret-f08-unit-red.log`
- `/private/tmp/ret-f08-browser-red.log`：首次沙箱启动失败，属于环境失败，不计为产品 RED。
- `/private/tmp/ret-f08-browser-red-unrestricted.log`：获准沙箱外运行后的有效 9 项 RED。
- `/private/tmp/ret-f08-unit-green.log`：46 项渲染单测通过。
- `/private/tmp/ret-f08-suite-green.log`：最终索引版本 298 通过、1 跳过。
- `/private/tmp/ret-f08-typecheck-indexed.log`
- `/private/tmp/ret-f08-browser-indexed.log`：最终索引版本 19 项浏览器通过。
- `/private/tmp/ret-f08-original-green.log`：原始 F08 两项通过。

Playwright 启动存在 `NO_COLOR`/`FORCE_COLOR` 环境警告；测试监听的页面运行错误和 console error 均为空。

## 限制与冻结

本轮提供 Chromium 组件行为证据；按指示不运行原生 UI，不声称已验证 macOS 窗口、真实输入法或完整视觉验收。未构建 Release、未运行 PDF 或性能整套任务，也未修改性能夹具、预算和脚本。全量 web 单测在根控制器发来避免重复整套重任务的消息前已完成，之后未再重复。

根控制器负责最终统一 full web/browser、新目录 Release/PDF 和既定 20-sample 性能验证。此报告写入后，本执行者停止写入和测试。
