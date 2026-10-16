# 原生 UI 验证记录

2026-10-15。通过 Computer-Use 打开当前本地构建，观察到原生单文档窗口、菜单和 WKWebView 编辑区域。用系统打开面板载入冻结排版样本；无编辑 Cmd-S 后样本 SHA-256 仍为 f04b0024873e8acc736e6af5a3f216f29f577c54f265cc3bf8cbe0d92d3f9977。Cmd-N 创建独立 Untitled2，英文键入可见且标题标记 Edited。

两次尝试 Control+Space 后逐键输入 nihao，均未出现候选组词；不能据此判定真实中文输入法已验证。已询问用户当前输入法与切换快捷键，其他验证继续。

Untitled2 首次 Cmd-S 后界面查询超时。线程采样 build/native-save-sample.txt 显示主线程阻塞在 NSDocument serialization semaphore，而非普通渲染慢；原 Astra 实现者正在修复真实 activity 嵌套。该应用实例仅含本次测试样本/空白文稿及nihao；没有修改用户原有 Typora 文档。

PDF 独立检查：pdfinfo 证实 /private/tmp/ret-task6-pagination-proof.pdf 共27页，595×842pt A4；pdftotext 可提取中文和末尾表格/长代码。打印来源为真实 WKWebView，更多边距/视觉证据见 task-6-report.md。这不代表 UI 导出入口和两种模式等价性已验收。

## 修复后复测

使用Finder正常打开更新后的签名构建，创建独立文稿并纯文本粘贴标题/强调/两列表格/公式。实际WKWebView可见隐藏标记的标题和强调、左/右对齐表格与公式；首次Cmd-S于数秒内正常呈现系统SavePanel，未重现原始主线程死锁。

将文件名改为native-ui-smoke.md并进入GoTo目录面板后，Computer-Use返回inactive绑定错误，随后cgWindowNotFound；进程仍存活且没有本应用崩溃报告。工具库存请求另有browserpolicy/Statsig网络403。尚未完成实际磁盘保存，不能把此项标为通过。测试输入完整保存在build/ui-unsaved-native.md；未修改冻结样本或用户其他文档。

## 恢复绑定后的实际结果

23:02重新查询已绑定app成功，完成原GoTo目录及SavePanel。窗口变为native-ui-smoke.md且Edited清除；`cmp build/ui-unsaved-native.md build/native-ui-smoke.md`成功，88字节一致。先前的未完成保存状态由本条更新。

23:04通过CmdShiftE的实际应用导出面板生成`build/native-ui-smoke.pdf`。pdfinfo：Creator为ReT Markdown，1页A4 595×842pt；pdftotext保留“原生验证”、正文、表格和公式文字。CmdSlash切为源码模式，窗口仍干净；另存导出`build/native-ui-source.pdf`。这两个PDF的提取文字及72dpi逐像素PNG均一致，证明此样本的两种模式导出结果相同，不推定所有复杂分页情况通过。

随后在测试文稿末尾粘贴“另存为历史验证”。两次独立CmdShiftS均在SavePanel出现前报“This editor service is not available yet.”，文稿和新增内容仍在，未执行成功另存为。这属于实际公共SaveAs入口缺陷，不能归因于Computer-Use绑定；原Astra保存实现者已恢复调查并要求真实公共入口回归。输入备份为`build/native-ui-saveas-input.md`。初次保存/PDF导出成功不覆盖这项失败。

## 快捷键路由根因

进一步操作：普通撤销与CmdS成功恢复88字节原文；重复打开同一文件后Window菜单只有一个命名窗口。直接File菜单SaveAs成功生成`native-ui-save-as.md`，CmdShiftZ恢复此前粘贴内容，证明此样本另存后历史仍连续；脏源码模式的SaveAs面板取消保留修改。

23:36诊断构建在空白文稿也复现CmdShiftS错误，排除“必须已命名/脏文稿/源码模式”的错误假设。`build/verification/native-save-as-routing.json`和`build/native-save-as-trace.jsonl`捕获`writeSafely.missingCapture`，operation=3，原生栈为`NSDocument duplicateAndReturnError:` → `duplicateDocumentWithDelegate:` → 菜单keyEquivalent；没有进入`saveAs.public`。AppKit自动添加的Duplicate占用了该快捷键。修复转由显式菜单目标调用系统SaveAs，未增加未捕获快照的直接写入后门。

诊断阶段还遇到CUA保存/打开面板确认后关闭却没有read/save.to、输出未生成的情况。运行时类型诊断确认默认fileType、可读/可写类型、allowedContentTypes均正确且super.prepareSavePanel返回true；缺乏证据认定为格式注册缺陷，未做猜测性修复。只算面板确认路径尚未完成，不能用界面关闭代替磁盘验证。所有独立测试输入均在build中有源文备份；未操作用户文稿。
