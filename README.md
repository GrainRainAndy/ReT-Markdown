# ReT Markdown

ReT Markdown 已于 2026-10-21 归档旧实现，进入从零重写阶段。当前分支 `rewrite/from-zero` 使用独立根提交；本分支目前只有重新编写的需求、技术方案和参考物核验工具，没有可运行的新编辑器。

重写以本地 macOS Markdown 写作为默认产品定位，以仓库内 **Typora 1.14.10（7786）** 为行为研究对象。旧版的编辑内核、模块边界、依赖清单和验收结论均不作为新实现的既定方案。

## 阅读入口

1. [需求分析](docs/specs/requirements.md)：场景、范围、数据规则和质量要求。
2. [编辑行为契约](docs/specs/editing-contracts.md)：按键、选区、输入法、特殊块与撤销的具体结果。
3. [技术方案](docs/architecture/technical-design.md)：候选路线、推荐设计、接口、风险和阶段准入条件。
4. [Typora 逆向结论](docs/research/typora-findings.md)：REA 证据、可定位观察、推断和未知项。
5. [验收方案](docs/verification/acceptance-plan.md)：需求追踪、测试层级与失败门槛。
6. [旧版归档](docs/legacy-archive.md)：归档身份、内容核验与恢复方法。

需求与技术方案状态为**待评审草案**。新设计优先验证结构编辑与源文保真能否同时成立，再扩展完整功能；没有把候选框架的 API 能力当作实现完成。

## 本地参考物

`Typora.app/` 保留完整参考应用，`analysis/` 保存提取物与 REA 记录，均在 Git 忽略范围内。新实现不得加载这些文件作为产品依赖。Git 中保留来源清单、关键哈希和证据摘要，见 [provenance](docs/research/typora-provenance.json)。

```sh
python3 scripts/verify-reference.py
```

该命令只读取本地参考包并核对来源清单，不启动应用，也不验证交互行为。缺少本地 Typora 副本时会明确失败。

`build/`、`.build/`、`node_modules/` 和 `test-results/` 中的现存内容属于旧版遗留的本地构建、依赖与证据，不属于新产品输入，也不能证明新版本通过测试。保留其原路径以免破坏已有证据或正在使用的旧应用。
