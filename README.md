# ReT Markdown

ReT Markdown 已于 2026-10-21 归档旧实现，进入从零重写阶段。当前分支 `rewrite/from-zero` 使用独立根提交，正在实现个人 macOS Markdown 编辑器的首个预览版。完整编辑、图片和原生 PDF 工作流已形成可运行构建；当前正在修复整分支审查发现的问题并完成交付验证。

重写以本地 macOS Markdown 写作为默认产品定位，以仓库内 **Typora 1.14.10（7786）** 为行为研究对象。旧版的编辑内核、模块边界、依赖清单和验收结论均不作为新实现的既定方案。

## 阅读入口

1. [需求分析](docs/specs/requirements.md)：场景、范围、数据规则和质量要求。
2. [编辑行为契约](docs/specs/editing-contracts.md)：按键、选区、输入法、特殊块与撤销的具体结果。
3. [技术方案](docs/architecture/technical-design.md)：候选路线、推荐设计、接口、风险和阶段准入条件。
4. [Typora 逆向结论](docs/research/typora-findings.md)：REA 证据、可定位观察、推断和未知项。
5. [验收方案](docs/verification/acceptance-plan.md)：需求追踪、测试层级与失败门槛。
6. [旧版归档](docs/legacy-archive.md)：归档身份、内容核验与恢复方法。

需求与技术方案已获批准并进入实现。当前实现与实际验收范围见 [初版验收记录](docs/verification/initial-preview.md)，执行步骤见 [实现计划](docs/superpowers/plans/2026-10-21-initial-rewrite.md)。初版尚未完成交付，未验证的原生输入法、性能和辅助功能不视为通过。

## 本地构建

在 macOS 上使用 Node.js 与 Swift 工具链：

```sh
npm ci
bash scripts/build-app.sh
```

输出为 `build/rewrite/0.2.0-alpha.1/ReT Markdown Preview.app`，使用独立标识 `com.retmarkdown.rewrite.preview`，不会替换旧版应用。`fixtures/preview.md` 提供体验文稿，验收时使用副本。

## 预览版操作

建议先复制 `fixtures/preview.md`，再用 Preview 应用打开副本。它包含中英文、列表、代码、数学、表格及图片路径样本。

| 操作 | 入口 |
| --- | --- |
| 正文 / 源码切换 | `⌘⇧M`，或“显示 → 切换源码” |
| 保存 / 另存为 | `⌘S` / `⌘⇧S` |
| 撤销 / 重做 | `⌘Z` / `⌘⇧Z`，跨编辑模式共用历史 |
| 查找 / 替换 | `⌘F` / `⌘⌥F` |
| 编辑文字缩放 | `⌘=` / `⌘-`，`⌘0` 恢复；不改变 PDF |
| 打开文中链接 | 按住 `⌘` 点击，或右键菜单 |
| 图片 | “格式 → 插入图片…”；混合剪贴板可用“编辑 → 粘贴图片” |
| PDF | `⌘⇧P`，或“文件 → 导出 PDF…” |

格式菜单还提供标题、列表、引用、删除线、行内代码、代码块和数学块；表格菜单随当前编辑位置启用。代码/数学字面域内 `⌘Enter` 可退出已闭合块。系统历史版本还原在此 alpha 明确不支持；“恢复到已存版本”仅读取当前文件已保存的内容。

## 自动验证

```sh
npm test
npm run typecheck
npm run test:browser
swift test --package-path native
```

浏览器测试需要先安装与锁定的 Playwright 版本匹配的 Chromium（`npx playwright install chromium`）。自动测试覆盖范围与原生交互观察分别记录。

## 本地参考物

`Typora.app/` 保留完整参考应用，`analysis/` 保存提取物与 REA 记录，均在 Git 忽略范围内。新实现不得加载这些文件作为产品依赖。Git 中保留来源清单、关键哈希和证据摘要，见 [provenance](docs/research/typora-provenance.json)。

```sh
python3 scripts/verify-reference.py
```

该命令只读取本地参考包并核对来源清单，不启动应用，也不验证交互行为。缺少本地 Typora 副本时会明确失败。

`build/rewrite/` 保存新预览版构建和验收输出。旧构建与证据保留；旧依赖和生成文件已移至 `.legacy-local/`，新工程使用本分支依赖清单重新安装。所有构建和测试成绩均需对应具体源码版本，不能以旧版证据替代。
