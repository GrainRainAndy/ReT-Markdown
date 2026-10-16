# 0.1.0-rc.1 版本整理报告

2026-10-16。实现子任务仅整理版本、构建元数据及发布文档；其静态检查记录保留如下。主代理随后完成实际构建及原生抽查，见末尾追加记录；没有重新进行性能采样。**0.1.0-rc.1 是发布候选，正式版目标为 0.1.0；完整 V1 仍需验收。**

## 写入范围

| 文件 | 变更 |
| --- | --- |
| `package.json` | canonical `version` 从 `0.1.0` 改为 `0.1.0-rc.1` |
| `package-lock.json` | 仅同步顶层及 `packages[""]` 的根版本；依赖记录不变 |
| `scripts/build-app.sh` | 读取 canonical 版本，提取三段数字短版本；默认输出 `build/releases/<version>/ReT Markdown.app`；复制模板后写入短版本及 `ReTReleaseVersion`，随后沿用原资源组装与签名流程 |
| `Resources/Info.plist` | 模板短版本由 `0.1` 改为 `0.1.0`，数字构建号 `1` 保留 |
| `README.md` | 当前版本、规范 app 链接、构建行为及 RC 验收边界 |
| `docs/releases/0.1.0-rc.1.md` | 候选版本说明、历史行为证据和正式版剩余门槛 |
| `docs/testing/versioning-report.md` | 本报告 |

没有新增脚本，未修改 Swift/TypeScript 产品实现、既有测试或当前验收状态报告。历史脚本、日志、报告及 app 副本均未重命名或覆盖。工作区未初始化 Git，未创建提交。

## Apple 字段约束

Apple 规定 `CFBundleShortVersionString` 使用点分隔的三段整数，仅包含数字和点；本构建从 canonical 版本生成 `0.1.0`。[Apple 官方说明](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring)

`CFBundleVersion` 使用点分隔的一至三段整数；本次保留模板中的 `1`，不将 `rc.1` 写入该数字字段。[Apple 官方说明](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)

完整 `0.1.0-rc.1` 写入自定义 `ReTReleaseVersion`。`package.json` 为唯一发布版本来源；模板 `0.1.0` 是合规的基础值，在组装包内 plist 时仍由 canonical 版本覆盖。产品显示名继续为 `ReT Markdown`。`RET_APP_OUTPUT` 仅覆盖输出路径，不覆盖包内版本。正式版 `0.1.0` 须更新 canonical 与 lockfile 根版本并重新构建校验。

## 已执行的低影响检查

所有检查均 exit 0；临时 plist 位于 `/private/tmp`，没有生成 app。

| 命令／检查 | 结果 |
| --- | --- |
| `bash -n scripts/build-app.sh` | Bash 语法通过 |
| `node --input-type=module` 内联检查 | canonical 为 `0.1.0-rc.1`，lockfile 两处根版本一致；将三处根版本还原后与编辑前 JSON 深比较完全一致，确认依赖、npm scripts 等字段未变化 |
| `python3` 内联检查调用 `/bin/bash -c` | 仅执行脚本中 `export npm_config_cache` 之前的版本／路径片段：默认输出为工作区的 `build/releases/0.1.0-rc.1/ReT Markdown.app`；设置 `RET_APP_OUTPUT=/private/tmp/ret-isolated/ReT Markdown.app` 时保持覆盖值 |
| `python3` 内联检查调用 `/usr/libexec/PlistBuddy` | 对独立临时 Info.plist 执行脚本中的两条元数据命令；读回短版本 `0.1.0`、构建号 `1`、完整版本 `0.1.0-rc.1`，其余 plist 字段与原模板一致 |
| `plutil -lint Resources/Info.plist` | 模板格式通过 |
| `python3` 内联 Markdown 链接检查 | README 和候选版本说明中的既有本地目标存在；版本化 app 链接明确待主代理构建 |
| `python3` 内联 `difflib.unified_diff` | 人工核对构建脚本、模板及 README 差异，符合限定范围 |

没有写入持久测试，也没有运行 npm、Swift、浏览器、原生 UI 或性能测试。检查使用编辑前文件快照，未依赖 Git。

## 证据归属与后续限制

历史 298 项 Web 单测通过、95/95 浏览器交互通过及 27 页 A4 WKWebView PDF，均按原日志路径引用于[候选版本说明](../releases/0.1.0-rc.1.md)；本次仅变更构建元数据，不把这些历史结果冒称为版本化 app 的重新验证。

主代理继续负责实际版本化 app 构建、包内 plist、资源一致性与签名校验，并使用独立 app 副本进行原生 UI 验收。真实中文 IME、完整视觉对照、原生生命周期与规定原生性能仍是正式版门槛；详情以[验收状态](acceptance-status.md)及其后续原生验收证据为准。

本任务写入到此结束。

## 主代理实际构建与抽查追加

版本实现及独立复核均已完成并关闭子代理；[独立复核](reviews/0.1.0-rc.1-version-review.md)为 Spec/Quality PASS。主代理派发两者时显式设置 `gpt-6.1-sol`、`reasoning_effort=high`；子代理无法独立确认底层路由，不把该参数声明扩大为运行时路由证明。

实际执行 `bash scripts/build-app.sh` exit 0，输出 `build/releases/0.1.0-rc.1/ReT Markdown.app`。包内读回完整版本 `0.1.0-rc.1`、短版本 `0.1.0`、构建号 `1`。87 个文件共 11,954,469 逻辑字节；83 份 Web 资源与整理前候选一致。`codesign --verify --deep --strict` 通过；后续逐文件大小及 SHA256 与[包清单](../../build/verification/0.1.0-rc.1/bundle.json)再次匹配。

独立身份 QA 副本完成文件打开、引用公式、表格分隔行查找、另存为字节比较及原生 PDF 导出；见[本版本原生抽查](0.1.0-rc.1-native-smoke.md)。新的[源码清单](../../build/verification/0.1.0-rc.1/source-sha256.json)记录当前配置；原历史清单保留。上述新证据不覆盖正式版剩余验收门槛，也未将历史行为测试或性能结果计作本版本重跑。
