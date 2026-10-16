# Computer-Use 恢复诊断

2026-10-16。项目实现与候选包未修改。本次仅检查本机客户端日志、进程元数据和CLI帮助，并重置本会话的cua_repl kernel。

## 实际证据

- 重启后和本会话连接重置后，`cua.getState()`仍返回`Sky Computer Use native pipe startup failed`。
- 客户端日志`~/Library/Logs/com.openai.codex/2026/10/16/codex-desktop-f5d15ac7-c618-4496-b7a4-7cee6e30bcc2-20393-t0-i1-004158-0.log`于01:39:09、01:40:39、01:42:16 UTC记录`browser-use native pipe rejected socket peer reason=untrusted-process-ancestry`，最后一次与本会话重置后重试时间对应。
- 只读进程检查：桌面客户端PID20393启动于08:41:53本地时间；SkyComputerUseService PID20551仍运行、父进程为20393，启动于08:42:05。app-server相关进程17739及node/node_repl启动于06:21，早于当前桌面客户端。
- 因此不能只凭高层startup failed判断屏幕录制/辅助功能缺失。现有证据指向连接进程来源校验，旧后台连接可能有关；尚未证明重启后台一定修复。
- 本机CLI帮助确认支持`codex app-server daemon restart`。目前没有执行该命令，也没有结束任何用户进程、关闭其他会话或修改安全权限/配置。

## 下一步

先让使用同一后台服务的正在运行任务结束或手动停止，并保存工作，然后在独立Terminal中执行`codex app-server daemon restart`，随后重新打开客户端/恢复当前会话。此操作会暂时中断共享服务连接；保存的历史会话不需要删除或逐个关闭。重启后先只读验证窗口列表，再恢复产品原生验收。若仍拒绝，应保留上述日志排查产品兼容性，不通过禁用来源校验绕过。

## 后台重启后的验证

用户报告后台已重启后，cua.getState()成功返回原生应用与浏览器列表，未再出现native pipe启动错误。控制通道恢复已得到实际只读验证。仅据此确认连接恢复，不将先前进程来源关联推断扩大为完整根因证明。后续继续最终候选原生验收。

随后在版本化独立 QA 中完成原生打开、查找、另存为及 PDF 导出，见[0.1.0-rc.1 原生抽查](0.1.0-rc.1-native-smoke.md)。期间一次自动审批超时重试后恢复，一次 ScreenCaptureKit 捕捉失败后恢复；没有修改安全权限或绕过工具限制。
