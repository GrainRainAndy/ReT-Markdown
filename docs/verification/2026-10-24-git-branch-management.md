# Git 双线管理记录

用户决策：当前 rewrite 线作为开发主线，仓库主分支作为 release 线。保留现有名称，长期活动线为 `rewrite/from-zero` 与 `main`。

## 核查事实

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

## 本轮落地与边界

- `AGENTS.md` 加入长期分支职责、PR 目标、发布集成与 hotfix 回流规则。
- 新增 [Git 分支与发布流](../git-workflow.md)，明确首次独立历史衔接须保留双亲历史、发布树采用获准重写快照，后续转普通合并。
- 保持当前工作区在开发线；不移动 main，不改写旧归档，不把未完成原生验收的 alpha.4 视为已批准 release。
- 保留任务开始前 README、B08 报告、验收方案及三个未跟踪验收文档的修改，不代为提交。
- 远端开发线同步、GitHub 分支保护尚未执行。涉及 public 仓库，首次开发线推送会上传整条已提交重写历史；应以明确同步授权执行。日常开发同步与对外产品发布分别判断。

验证范围为分支引用、完整任务差异、文档链接及暂存路径；本轮只改协作文档，不重跑产品测试。**本地管理规则已落地，远端落地未完成。**
