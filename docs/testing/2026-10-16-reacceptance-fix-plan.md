# 2026-10-16 二次复验修复计划

独立输入：`build/verification/reacceptance-results.txt`，冻结候选与源文件哈希一致。根控制器复跑边界脚本：表格隐藏分隔行、引用内块公式两项失败；列表内块公式对照通过。失败日志 `reacceptance-controller-red.log`。本次修复完成前，上一轮绿色记录不等于完整V1通过。

1. 根控制器：表格根选区与表格相交且不能投影到单一正文单元格时展开源文。包含分隔行、外层管道、跨单元格/跨表格边界；单元格内部选区继续沿用mini编辑器。不修改源文、不产生历史；保留composition屏障。新增真实CM回归先RED。
2. Pasteur（Astra high）：公式上下文使用完整文档解析出的对应math token，复用安全renderer；保留原UTF16错误/源文范围。写范围限markdown.ts、render.test.ts、新math spec及报告。根控制器只负责decorations.ts把math接入已有上下文缓存。两个产品写集合互斥。
3. 完工后独立审查，复跑原边界与完整Web/真实浏览器；TypeScript检查，重新构建独立候选路径并签名、资源哈希核验。原生Swift实现未修改时复用既有单测证据，实际PDF运行时对新Web另行验证。
4. 投影/renderer路径改变后重新检查既定性能夹具，继续保留原生IME/生命周期/视觉/RSS门槛。原生UI服务失败不能算产品通过或产品失败。

不覆盖旧运行中的 `build/ReT Markdown.app` 或已有验收副本。新候选采用新目录，完成后更新README/清单指向。原始验收脚本和报告保留。
