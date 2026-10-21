# Typora 连接排查与本地副本

## 本地副本

已使用 `ditto` 将 `/Applications/Typora.app` 完整复制到工作区根目录 `Typora.app`；`.gitignore` 增加 `/Typora.app/`，`git check-ignore` 与 ignored status 均确认排除，Git 索引没有该包中的文件。此前 `analysis/typora-1.14.10/originals/` 仍有提取资源与主程序副本，但不是完整 `.app`，本次未覆盖历史分析资料。

版本为 1.14.10（7786），bundle ID 为 `abnerworks.Typora`。核对 887 个文件/目录/符号链接条目，678 个文件，文件逻辑总大小 46,142,886 字节；文件字节 SHA-256、符号链接目标和文件可执行位与原应用完全相同。保留原 ID，不修改或重新签名。

源应用与副本的 `codesign --verify --deep --strict` 均返回 arm64 签名无效。因为二者内容相同，这不是复制产生的差异；本次未修复签名，也未建立签名状态与连接超时的因果关系。

## 连接结果

1. 先前通过 `cua.getApp('abnerworks.Typora')` 连接曾两次 `timeoutReached`。当时进程已运行，尚未建立这份工作区副本。
2. 本轮只读检查原应用 PID 76528。两秒 sample 中主线程在 AppKit 正常事件循环等待，没有观察到主线程忙循环或死锁；这不能排除历史/间歇性异常。所检查的 Codex 日志子集中未找到足以还原这两次超时的详细原因。
3. 使用 `cua.getApp('/Applications/Typora.app')` 成功返回“未命名”窗口和 Typora HTML 无障碍树；随后独立 AX 读取与截图均成功。资源 URL 明确指向 `/Applications/Typora.app`。当前连接恢复已验证，不需要退出 Typora、重启服务或更改权限。
4. 副本建立后，再用 `abnerworks.Typora` 得到明确的 ambiguous app identifier，工具列出原应用和工作区副本两个路径。这是新增副本导致的确定性身份歧义；不能倒推为复制前超时的原因。

后续原生对照固定使用 `/Applications/Typora.app` 的完整路径；工作区 `Typora.app` 作为静态逆向参考物，不通过 bundle ID 猜测应连接哪个副本。此次尚未启动工作区副本，也没有修改现有文稿。

证据目录：`build/verification/0.1.0-rc.1/typora-connection-20261021/`，包括 `copy-verification.json`、`typora-sample.txt`、`diagnosis.json`。AX 与实际截图见本次 Computer Use 记录。连接恢复不等于代码块等编辑行为已经完成原生对照，行为审计仍需逐项执行夹具。
