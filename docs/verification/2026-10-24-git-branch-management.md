# Git 双线管理记录

当前用户决策：开发主线命名为 `dev` 并公开同步，不加入远端保护；默认分支 `main` 作为 release 线，首次发布前保持空文件树且不保留旧 main 历史；不限制仅 PR 更新。**Git 双线管理通过：dev 已推送，main 已重置为空发布基线并恢复保护，legacy 归档分支和标签已推送。** 以下保留各阶段事实，当前状态以文末最终核查为准。

## 首次核查事实（改名前）

2026-10-24，通过本地 Git 和 `git ls-remote --symref origin HEAD 'refs/heads/*'`、`gh repo view` 只读核实：

| 对象 | 状态 |
| --- | --- |
| 仓库 | `GrainRainAndy/ReT-Markdown`，public |
| GitHub 默认分支 | `main` |
| 本地与远端 main | `465505e747b591d262247d52d6cbfac9da0099ee`，旧版初始提交 |
| 本轮开始时开发线 | `rewrite/from-zero` → `0689868`；含 alpha.4 实现提交 `add2130` |
| 开发线根提交 | `71455bc`，与 main 无共同祖先 |
| 远端分支 | 本轮核查仅有 `main`，开发线尚未推送 |
| 远端保护 | main 传统分支保护 API 返回 `Branch not protected`，仓库 rulesets API 返回空列表；本轮没有创建保护规则 |
| 归档 | `legacy/archive-2026-10-21` 与 `legacy-archive-2026-10-21` 保持原有身份 |

首次远端读取被本地沙箱拒绝连接；经命令级授权后读取成功。这不是仓库认证失败。没有更改全局 SSH、凭据或网络设置。

## 首次规则落地（改名前）

- `AGENTS.md` 加入长期分支职责、PR 目标、发布集成与 hotfix 回流规则。
- 新增 [Git 分支与发布流](../git-workflow.md)，明确首次独立历史衔接须保留双亲历史、发布树采用获准重写快照，后续转普通合并。
- 保持当前工作区在开发线；不移动 main，不改写旧归档，不把未完成原生验收的 alpha.4 视为已批准 release。
- 保留任务开始前 README、B08 报告、验收方案及三个未跟踪验收文档的修改，不代为提交。
- 远端开发线同步、GitHub 分支保护尚未执行。涉及 public 仓库，首次开发线推送会上传整条已提交重写历史；应以明确同步授权执行。日常开发同步与对外产品发布分别判断。

此阶段验证范围为分支引用、完整任务差异、文档链接及暂存路径；只改协作文档，不重跑产品测试。当时结论为本地规则已落地、远端落地未完成，后续调整如下。

## 开发线改名及允许直接更新

- 依用户后续指令，执行 `git branch -m rewrite/from-zero dev`。改名前后 HEAD 均为 `be0211d`，提交、reflog 与工作区完整保留；随后管理约定提交为 `d45c176`。
- `AGENTS.md`、分支流程和 README 的当前分支说明更新为 `dev`。历史验收报告、原始计划和归档记录中的 `rewrite/from-zero` 保留其历史含义。
- README 只暂存开发线名称变更；原有 B08 段落修改仍留在工作区。其他五份已有未提交／未跟踪文件以 SHA-256 核对未变，main 与归档引用未移动。
- GitHub 已创建 [long-lived-branches 规则集](https://github.com/GrainRainAndy/ReT-Markdown/rules/25776002)，ID `25776002`、enforcement=`active`，精确匹配 `refs/heads/main` 和 `refs/heads/dev`，规则只有 `deletion` 与 `non_fast_forward`，bypass 列表为空。**未设置 `pull_request`、强制审批或必需 CI 检查，允许直接 push。** 规则类型按 [GitHub 官方 API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)配置。
- 首次 `git push --no-follow-tags -u origin dev` 在命令启动前被自动审批拒绝。其理由是当前用户明确授权改名及调整 PR 要求，尚未明确涵盖向 public 仓库公开上传整条重写历史。没有重试或通过其他接口创建远端分支。回读远端仍只有 main；两个分支名的有效规则均返回 `["deletion", "non_fast_forward"]`。
- 待明确公开同步授权后，推送范围仅为 `dev` 的已提交历史并建立 `origin/dev` 跟踪；不包括 main、归档、标签、未提交文件、参考应用或忽略的构建／证据目录。推送不代表 alpha.4 获得发布批准。

该阶段结论：开发线改名及不强制 PR 的管理要求通过；当时远端 dev 同步未完成，后续已获授权并完成，见下文。

## 明确授权后的远端落地与最终核查

用户随后明确授权公开推送开发线，要求 dev 不加入远端保护，并确认旧版已归档后可清空 main、不保留其历史；随后另行授权将 legacy 分支推到远端。

- `dev` 首次成功推送提交 `290b8a900cd7f93520d1727eedebd644df662aa1`，建立 `origin/dev` 跟踪。本记录与最终协作规则随后通过普通提交同步到 dev。
- 规则集 `25776002` 改名为 [release-main](https://github.com/GrainRainAndy/ReT-Markdown/rules/25776002)，仅匹配 `refs/heads/main`，active、无 bypass，规则为 `deletion` 和 `non_fast_forward`。有效 dev 规则为空；不要求 PR、审批或必需 CI。
- 旧 main 提交 `465505e747b591d262247d52d6cbfac9da0099ee` 先保存到远端 `legacy/main-before-reset-2026-10-24`，再执行用户明确授权的一次性重置。仅临时移除 main 的非快进限制，使用指定旧 SHA 的 `--force-with-lease` 更新，并在 finally 步骤恢复保护；回读确认保护已恢复。
- 本地与远端 `main` 均为 `9be35bb2125828fc6c674681a882dfb515cff4ed`，无父提交，tree ID 为 `4b825dc642cb6eb9a060e54bf8d69288fbee4904`，文件条目为零。仓库默认分支仍为 main；未将任何开发候选合入发布线。
- 本地与远端完整归档分支 `legacy/archive-2026-10-21`、标签 `legacy-archive-2026-10-21` 均解析到 `01510ed75284d2ac4c05a11ccf1f4ec250108b07`。归档包含旧 main 历史；这次仅上传原有归档引用，没有修改归档内容。
- 本地备份 `.legacy-local/legacy-2026-10-21.tar.gz` 保留，SHA-256 为 `8b9b38958b784817afef5f82a2869ea312324921c94cbb2fe649f94775e2f666`，与归档清单一致。
- README 的已有 B08 修改、B08 报告、验收方案及三份未跟踪验收文档保留，SHA-256 与本次操作前一致；不纳入本任务提交。当前工作区始终在 dev。

验证范围：本地与远端引用、默认分支、空树与父提交、有效保护规则、归档身份和备份校验、完整任务差异、相对链接及暂存路径。只涉及 Git 管理与文档，不重跑产品测试。

结论：**本次 Git 管理通过。** 这不构成 alpha.4 整体验收通过或产品发布授权；后续发布需按 [发布流](../git-workflow.md)固定候选、验收并取得对应授权。
