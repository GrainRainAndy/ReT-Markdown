# Git 双线管理记录

当前用户决策：开发主线命名为 `dev`，仓库默认分支 `main` 作为 release 线，暂不限制仅 PR 更新。**本地改名与远端非强推／非删除规则已完成；首次公开推送未执行。**

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

结论：**开发线改名及不强制 PR 的管理要求通过；远端 dev 同步未完成，待明确公开推送授权。**
