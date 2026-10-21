# 编辑交互缺陷处理流程

适用于 Enter、Backspace、缩进、格式转换、剪切粘贴、公式/表格定位及输入法。设计依据见[交互质量方案](../plans/2026-10-21-editor-interaction-quality.md)，本次执行记录见[0.1.0-rc.1 交互补修](0.1.0-rc.1-interaction-implementation.md)。

## 每次修复的最小交付

1. **固定复现。** 记录原始文件字节、模式、正反向选区、焦点、结构与事件顺序。Typora 的观察与产品选择分开记录，不能把当前错误结果作为预期。
2. **写出契约。** 明确允许修改的范围、最终结构、选区、commit 数量、EOL/BOM、撤销和保存结果。未确定的行为不由实现悄悄决定。
3. **保留有效 RED。** 新回归必须因目标缺陷失败；浏览器无法启动等基础设施失败另记。禁止删除失败用例或将期待改成当前输出。
4. **修改唯一负责层。** 编辑命令先解析 owner 和范围，再提交根事务；投影只消费结构范围。输入法先冻结已提交快照，最终 DOM 完成后再发布净变化。剪切的复制、删除与粘回共用同一范围。
5. **检查完整操作链。** 输入后 → 真正移出 → 返回 → 模式往返 → Undo/Redo → 适用的保存重开。检查 Source、活动视图与稳定视图，不能只看截图或 textContent。
6. **独立审查与相邻场景。** 结构变更同时检查 Lezer 和实际 renderer 的块树/内容；输入法至少检查最终 DOM 在 compositionend 前后到达、确认/取消、连续 composition 和排队的模式切换。发现 Important 项就回到 RED，不能以原测试已通过拒绝处理。
7. **冻结并验收同一身份。** 无并发源码写入后保存输入文件 SHA256 清单，运行下列检查，再构建独立 canonical 包。包内资源、QA current.json、检查日志和当前源码身份必须相符。旧候选的通过记录不能记到新候选名下。

结构移动增加运行时后置条件：先解析局部补丁计划的最终结果，再核对代码块类型、正文、info 与数量；围栏边界同时参与验证，不能只保持提取后的字符串宽度。可修复的围栏仅增长其真实标记；无法保真时整次操作保持原文及历史，列为暂不支持，不能用“基线已有问题”绕过保真契约。

## 固定自动检查入口

```sh
npm run typecheck
npm test
npm run test:interaction
bash scripts/build-app.sh
swift test --disable-sandbox --scratch-path build/swift --cache-path /private/tmp/ret-swiftpm
```

先按 README 安装依赖、Playwright Chromium，设置 `RET_CHROMIUM` 并生成夹具；`npm ci` 不自动下载浏览器。`test:interaction` 自动收集全部 `web/test/*.spec.ts`；失败附件在 `build/test-results/playwright/`。定向排错可以附加 spec 文件名，但交付时需对冻结源码运行完整入口。

Vitest 固定最多两个 worker，个案超时保持原值；由主控协调完整检查，避免多个代理同时运行整套 CPU 密集矩阵。测试环境失败和真实断言失败分别记录，不通过提高超时掩盖问题。

常规单测中显式跳过的导出运行时需单独运行并单独计数：Web 使用 `RET_EXPORT_BROWSER=1`；WKWebView 使用 `RET_PDF_RUNTIME=1`，并把 `RET_EXPORT_WEB_ROOT` 指向该候选包内的 Web 资源。这些运行时结果仍不能替代编辑器的系统输入法与保存 UI。

## 原生门槛与问题状态

原生测试只使用自有夹具。固定 QA 路径/ID 不变，先按[QA 身份流程](qa-application-identity.md)核对当前包；运行中不替换、不自动退出，不触碰用户未保存文稿。测试结束恢复自有夹具原字节，并保留操作后落盘证据。

问题状态使用 `reported → reproduced → contract_defined → red_recorded → fixed → reviewed → required_native_verified → closed`。单元测试证明局部补丁与历史，浏览器证明实际键鼠与 DOM，原生证明 WKWebView/系统输入法/系统剪贴板/磁盘保存；每一层只报告自己执行过的结果。

工具故障或真实 IME 尚未执行时写 `pending`，保留已通过层级，不能把合成 composition 改称原生通过。未关闭 Important 项、关键原生门槛缺失或身份不匹配时，不宣称完整正式版验收通过。
