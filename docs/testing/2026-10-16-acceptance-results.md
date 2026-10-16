# 2026-10-16 验收修复结果

9类反馈对应的修复已完成，四组独立复核均通过；当前可运行候选为 `build/release/ReT Markdown.app`。完整V1验收尚未通过，真实IME、系统生命周期、完整视觉及原生性能仍有门槛。旧的 `build/ReT Markdown.app` 保留，未覆盖用户运行实例。

## 修复与复核

| 项目 | 当前证据 | 限制 |
| --- | --- | --- |
| AC1 新建焦点 | transport加载后聚焦现有CM；两种模式浏览器回归；原生CmdN加载完成后无需点击即可输入abc | 同一工具批次在加载完成前发送的按键未录入，不承诺启动阶段按键缓存 |
| AC2 列表转换 | 标记替换、缩进列及后代tab语义；111 focused回归、9,504组合探针、独立复核通过；原生菜单得到1. alpha/2. beta并落盘 | 原生复杂嵌套键盘矩阵未全量执行 |
| AC3 基础实时语法 | HR、连续引用、实际序号、转义/实体投影，独立复核通过；原生截图看到正确结果 | 活动块按设计显示源标记 |
| AC4 Setext | 单一标题几何、引用内Setext回归及独立复核通过；原生非活动标题仅一条边框 | 完整Typora对照未执行 |
| AC5 表格查找 | cell映射/可见命中/替换/撤销回归；原生搜索右并Return后单元格出现蓝色选区 | 源分隔符及跨多单元格选区不在本次投影范围 |
| AC6 查找统一 | 原生Edit→Find与CmdF共用CM面板及右查询；ReplaceAll撤销隔离经独立复核 | 不用headless搜索fallback证明真实面板语义 |
| AC7 右键菜单 | 短表格实际右键显示六项覆盖菜单，Escape关闭且焦点回单元格，正文位置不变；9项浏览器与独立复核通过 | 长样本第一次AX右键落在末尾并打开WK默认菜单，该次不算表格成功证据 |
| AC8 深色背景 | palette变量统一，空白/长文稿浏览器回归及原生截图通过 | 未更改系统外观设置 |
| AC9 实际排版 | 行高1.6、段落/块公式/短表格几何、原生居中公式和短表格可见；投影性能修复后独立复核通过 | 完整同视口Typora视觉对照仍待完成 |

定向报告与复核：列表 [修复](acceptance-list-fix-round2.md) / [复核](reviews/acceptance-list-fix-review.md)，投影 [修复](acceptance-projection-fix-report.md) / [性能](acceptance-projection-performance-fix.md) / [复核](reviews/acceptance-projection-fix-review.md)，表格 [修复](acceptance-table-fix-report.md) / [复核](reviews/acceptance-table-fix-review.md)，会话 [修复](acceptance-session-fix-report.md) / [复核](reviews/acceptance-session-fix-review.md)。

## 冻结源码后的验证

| 检查 | 实际结果 | 日志/产物 |
| --- | --- | --- |
| Web单元/集成 | 289通过、1可选运行时跳过 | build/verification/acceptance-web-final.log |
| TypeScript | 通过 | build/verification/acceptance-typecheck-final.log |
| 真实浏览器交互 | 68/68通过 | build/verification/acceptance-browser-final.log |
| 原生测试 | 84总数，83通过、1可选PDF跳过、零失败 | build/verification/acceptance-native-final.log |
| 显式开启Web导出运行时 | 22/22通过 | build/verification/acceptance-export-runtime.log |
| 显式开启原生PDF | 1/1通过，27页A4，中文与代码可搜索 | build/verification/acceptance-pdf-runtime.log、acceptance-pagination.pdf |
| Release组装及签名 | 通过，ad-hoc签名 | build/verification/acceptance-build.log |
| 浏览器性能 | 18组各20样本、零错误、源码未变化；常规live输入P95 44.9ms，1MiB live打开555.0ms | build/performance-acceptance-final/performance.json |

运行时补测不重复计入常规测试数量。1MiB输入206.6ms仅诊断，不适用常规50ms比较线。浏览器指标不能代替原生Release冷启动/RSS/IME/PDF规定序列。

Release逻辑大小11,952,903字节，83份网页资源与build/web一致。清单 `build/verification/acceptance-bundle.json`，源码/测试/配置指纹 `acceptance-source-sha256.json`。Typora固定样本SHA256仍为 `f04b0024873e8acc736e6af5a3f216f29f577c54f265cc3bf8cbe0d92d3f9977`。

## 原生复测与剩余门槛

使用独立ID `net.ret-markdown.acceptance` 的验收副本；复制Release后仅更改启动身份并重新签名，产品实现与资源相同，签名元数据不同。没有重建或覆盖运行中的旧应用。

实际保存abc后只读核验字节为 `b'abc'`；同一自有输出随后用于列表和复杂样本，最终 `build/verification/acceptance-fixed-focus.md` 与 `acceptance-fixed-input.md` 字节完全一致。各阶段由Computer-Use读取AX确认；截图为本会话工具输出，没有将未落盘截图称为附件。复杂样本导出GUI未再执行；当前最终PDF证据是独立原生运行时27页测试。

尝试已启用输入来源后，工具键入ni没有显示候选框，不能证明真实IME通过。只读Carbon查询依次观察到Russian–QWERTY、简体拼音、Russian–QWERTY；恢复ABC的下一次动作遇到 `Sky Computer Use native pipe startup failed`，刷新仍失败。没有修改启用输入法列表或快捷键设置；当前输入来源恢复尚待工具恢复后确认。此前服务重启也中断过打开应用，已通过检查状态后继续，未重跑已完成的自动验证。

真实中文组词/取消/删除/撤销、系统关闭设置与Versions、完整Typora视觉对照、原生Release规定性能仍未验收。上述缺口不能由合成composition、浏览器性能或历史截图代替。

## 后续只读输入来源检查

2026-10-16 08:56:57工具主机时间的Carbon只读查询返回`com.apple.keylayout.ABC / ABC`。当前来源已为ABC，先前恢复待确认的事项解除；本轮未执行新的输入来源切换，也不将其作为真实IME通过证据。
