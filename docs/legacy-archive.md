# 旧版归档与重写边界

2026-10-21，按用户要求先提交全部本地未提交代码与文档，再从零建立新版本。此次是完整重写，旧实现不参与新版本的增量修补。

## 归档身份

| 项目 | 值 |
| --- | --- |
| 归档分支 | `legacy/archive-2026-10-21` |
| 归档标签 | `legacy-archive-2026-10-21`，annotated tag |
| 归档提交 | `01510ed75284d2ac4c05a11ccf1f4ec250108b07` |
| 原 main 提交 | `465505e747b591d262247d52d6cbfac9da0099ee` |
| 新分支 | `rewrite/from-zero`，orphan 历史 |
| 本地压缩包 | `.legacy-local/legacy-2026-10-21.tar.gz` |
| 核验清单 | [legacy-archive.json](legacy-archive.json) |

归档前记录了 248 个非忽略文件，共 2,163,817 字节。提交后逐个读取归档 Git blob，核对 SHA-256 与提交前一致；当时工作区没有剩余的非忽略修改。归档提交新增/变更 92 个文件，其余文件继承自原 main。

归档忠实保存当时状态，不表示旧版本功能正确或通过最终验收。本次没有为归档修复旧缺陷，也没有重跑旧产品测试。远端没有推送，`main` 和远端分支保持原引用。

## 本地未纳入 Git 的内容

| 内容 | 保留方式 |
| --- | --- |
| `Typora.app/` | 根目录完整副本，供新研究使用 |
| `analysis/` | 原有分析保留；新研究写入 `rewrite-20261021/` 子目录 |
| `build/`、`.build/`、`node_modules/`、`test-results/` | 保持原路径，作为旧版本地遗留内容，继续忽略 |
| 旧 `Sources/` 中被忽略的生成资源 | 移至 `.legacy-local/generated-Sources/`，避免新源码树混入旧构建产物 |
| 提交前文件哈希清单 | `.legacy-local/prearchive-manifest.json` |

压缩包包含归档提交中的源码与文档，不包含上述被忽略的大型资源。Git 分支与压缩包均为本地保存；异地备份需要后续单独安排。

## 查阅与恢复

直接读取旧文档，无需切换当前工作区：

```sh
git show legacy/archive-2026-10-21:README.md
git show legacy/archive-2026-10-21:docs/references/2026-10-21-typora-runtime-contracts.md
git log --oneline legacy/archive-2026-10-21
```

需要可编辑旧版本时，在新的空目录恢复，并从归档创建工作分支；不要在归档分支上继续开发：

```sh
git worktree add -b legacy/revisit /private/tmp/ret-legacy-revisit legacy-archive-2026-10-21
```

上例目录须尚不存在。工作树只恢复 Git 跟踪文件；旧测试所需的忽略夹具、构建证据和依赖需要按旧说明另行准备。

## 从零重写的含义

新分支不继承旧源码、旧测试实现、旧 lockfile、旧脚手架和旧发布状态。历史缺陷可以转为新的行为用例，历史运行记录可以作为有边界的参考，但必须重新建立新版本的证据。

保留用户产品意图，不保留旧架构的约束力。此前选择 CodeMirror 全文投影的决策已退出新方案基线；即使新方案仍选择 AppKit、WebKit 或某个相同依赖，也必须依据新需求重新证明适用性。
