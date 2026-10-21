# 本地 QA 应用身份

Computer Use 的本地 QA 入口固定为 `build/qa/ReT Markdown QA.app`，bundle ID 固定为 `net.ret-markdown.qa`，显示名固定为 `ReT Markdown QA`。不再把版本号、提交或源码哈希拼入应用 ID、显示名或启动路径。该身份与正式应用 `net.ret-markdown.app` 分离。

每次先在独立版本目录构建并保留 canonical 包，再发布到这个固定入口：

```sh
python3 scripts/prepare-qa.py 'build/releases/0.1.0-rc.1/465505e-73ecd74c/ReT Markdown.app' --source-identity 73ecd74ca4f6dfd6d46457919b25caf4b650d58f5d494e30999b7c19fa19269d
```

脚本将完整源码身份、原包路径和版本写入 QA 的 Info.plist 与 `build/qa/current.json`，并重新执行 ad-hoc 签名和严格签名校验。验收先核对 current.json，再通过固定路径操作。旧版本证据继续使用版本目录；固定入口只是当前测试副本，不是不可变发布物。

也可在构建时设置 `RET_PREPARE_QA=1` 与 `RET_SOURCE_IDENTITY=<完整 SHA-256>`，由 `scripts/build-app.sh` 在 canonical 包签名后调用同一脚本。未设置时仅构建 canonical 包。

如果固定 QA 正在运行，脚本拒绝更新，且不关闭应用、不保存用户文稿。由用户保全未保存内容并退出后再更新；进程检查不可用时也拒绝更新。更新前将之前的固定副本保存在 `build/qa/history/`，历史证据及此前带哈希的 QA 包不受影响。不要通过历史副本继续原生验收，以免相同 ID 的多个副本被错误解析。

首次使用固定身份仍可能出现一次应用授权；是否记忆授权由 Computer Use 宿主管理。脚本不修改宿主审批规则、macOS 隐私数据库或权限。ad-hoc 签名的代码哈希会随二进制变化，固定 bundle ID 不等于系统权限的持久签名保证；若宿主后续仍要求授权，应保留其提示并按真实机制处理。

2026-10-20：连续两次发布验证固定入口与 ID 不变，旧副本保留；5 项 Python 单元检查、shell 语法与 diff 检查通过；84 项 Resources 文件与 canonical 一致，canonical 全文件清单未变，QA 严格签名检查通过。记录见 `build/qa/verification.json`。首次原生启动被自动审批按本地未知来源软件要求本次确认；已向用户提出具体启动确认，尚不能声称后续授权复用已通过实测。

2026-10-21：用户在对话中明确授权启动并继续原生验收后，固定路径成功启动；稍后再次连接同一运行中的 QA 成功，没有新审批等待。段落/空行原生补验完成，见[验收报告](0.1.0-rc.1-paragraph-enter-and-blank-lines.md)。这只证明当前运行构建可复用连接，未来更换二进制后的授权持久性仍未验证。


2026-10-21 15:24：用户完全退出固定 QA 后发布 `ba965c55…` 成功，旧副本移入 history，current.json 保存完整身份。更换二进制后通过同一固定路径成功启动并多次连接，没有新增审批等待。83 Web 资源与 canonical 一致，可执行代码排除重签名区域后相同，严格 deep 签名通过，见 `interaction-implementation-20261021/qa-publication.json`。这提供一次“更新构建后仍复用身份”的实测，不保证后续 macOS/宿主授权永久有效；具体原生结果见[原生交互补验](0.1.0-rc.1-native-interaction.md)。
