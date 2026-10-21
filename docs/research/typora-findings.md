# Typora 逆向证据与重写启示

日期：2026-10-21。对象：仓库根目录 `Typora.app`，版本 1.14.10（7786），bundle ID `abnerworks.Typora`。本轮研究服务于完整重写的需求和方案，不是恢复 Typora 的全部源码或宣称完整行为等价。

## 1 身份与复核方法

本轮重新读取本地包、生成全包清单，并核验历史提取的 181 个 SystemJS 切片与该包的原始字节完全一致。选择 9 个核心模块建立新的 REA 分析输入；没有启动本地副本或执行包内 JavaScript。原生行为表引用前期运行样本，并明确保持历史证据身份。

| 对象 | SHA-256 |
| --- | --- |
| `Contents/MacOS/Typora` | `71aebecaac7b21965c541113b6e0d9b792a095f44aa487a0a6366f224fcbb83a` |
| `Contents/Resources/TypeMark/appsrc/main.js` | `8e716a084097a976ab9ed8ea06d8f0b505f14a8dc0c022b3dc1a09a741225e16` |
| 完整文件/链接清单摘要 | `ee2d7a553e0d88c5b34df7704205d579f230386e51b4dd465631410da12cb057` |
| 本轮 REA 九模块输入根摘要 | `24e05c5cbf67c03612115656e3811083d43b9be684a92929fcce750068f4e596` |

全包清单覆盖 678 个文件和 5 个符号链接，不包含目录项；其摘要算法见 [provenance](typora-provenance.json)。目录项是否计入会改变“条目数”，不能与历史包含目录的 887 项直接比较。

核验入口为 `python3 scripts/verify-reference.py`。完整清单、精确切片和 REA 完整记录保存在本地 `analysis/typora-1.14.10/rewrite-20261021/`；Git 仅跟踪 provenance 和[REA 摘要](rea-summary.json)，不提交参考应用和提取实现。

## 2 REA 记录与覆盖

| 标识 | 类型 |
| --- | --- |
| `ev_2b14a22949584d49104a69afecfc3c412bd1629f3a93af73c01b6de8da806bbb` | 本轮九模块 parent Evidence |
| `ev_f433856b8274012551e2cee4c7993e9d87c18cd74b6fa6d094f206bd3794c111` | parent 的摘要视图 |
| `ev_918a4167e2527cd7ba66df31207210101a12e5debc8addc9ac4c930752ff693f` | SourceView 资产的定向视图 |
| `ev_77a8c659574c992942d3976e1475ed9c3a6bc114c3eba6ea1839d09a7a5648c2` | 前期 JSBridge 子集分析，本轮通过原字节哈希复核其来源 |

九模块为 Editor、NodeDef、Node2Mark、Brush、UndoManager、SourceView、File、Export、JSBridge。输入 208,117 字节，9 个 JavaScript 文件解析成功，0 解析失败，398 findings。**application 和 semantic 覆盖均为 partial**，6 个 application unknowns、11,389 个 semantic unknowns。

REA 未识别该输入的 SystemJS bundled modules，统计 modules 为 0；181 个模块边界来自前期本地 AST 提取与本轮原字节核验。结果预算导致 NodeDef、Node2Mark、SourceView 的语义分析未开始或关系图未展开；对应静态文件观察保留。不能把文件解析成功当成完整数据流恢复。

SourceView 视图还将若干 `node.get("text")` 一类调用列作 network endpoint 候选。这是语法启发式结果，**不支持真实网络请求的结论**。分析必须回到调用上下文，不能把工具类别原样写进产品事实。

`rea-evidence.json` 为本次导出的完整会话包（导出时 3 条记录、53,559,726 字节）；随后取得的 SourceView 视图单独保存为 `rea-sourceview-view.json`。导出的 session unknowns 为 0 仅指登记的会话未知项，不抵消 parent 内 11,389 个语义 unknowns。

## 3 可定位的静态观察

以下 main.js 范围均为原包 **UTF-8 半开字节范围**；其他方法范围明确标为局部 UTF-16。别名服务于阅读，不是原生符号恢复。

| ID | 观察 | 来源与边界 |
| --- | --- | --- |
| S01 | macOS 包声明 TyApplication/Document，并包含原生 WebKit 桥接；共享 JS 有条件加载 Electron 的分支 | 本地 Info.plist；TypeMark/index.html 27–34、54–64 行；JSBridge 原字节 `[1332880,1338125)`。原生 + WebKit 是多项证据支持的架构判断，不推断所有内部类实现 |
| S02 | `Editor.getMarkdown` 在源码模式读源码 CM，普通模式读 `nodeMap.toMark()` | `[1682219,1682349)`；本轮重新读取精确原字节 |
| S03 | `Editor.store` 按节点类型从活动 DOM 或代码/数学 CM 回写节点 | `[1631736,1632863)`；说明节点、DOM 与局部编辑器有同步边界，不证明任意时刻完全一致 |
| S04 | NodeDef 持有节点、父子/兄弟关系、NodeMap 的 blocks/allNodes | `[1302103,1317728)`；结构模型不是物理行列表 |
| S05 | Brush 在 IME/鼠标按下时延后处理；刷写涉及解析、替换、选区和 undo | `interaction-audit-20261021/focus/Brush.js` 的 `brushQueue` 局部 UTF-16 `[1236,2310)`；内部处理原字节 `[125430,128799)` |
| S06 | 输入法处理建立 isIME 生命周期，提交后排入 brush 并记录 snapshot | Editor 原字节 `[1648093,1648984)`；不能据此宣称真实候选/取消流程已通过 |
| S07 | Selection 分普通节点、源码 CM、块 CM 保存书签；Undo 恢复结构/选区/焦点 | `focus/Selection.js` 的 getPosBookmark `[11279,11524)`、buildUndo `[11992,13128)`；`focus/UndoManager.js` exeCommand `[6074,13023)`，均局部 UTF-16 |
| S08 | 进入 SourceView 会 setValue、focus 并 clearHistory；退出有 reloadContent 路径 | `focus/SourceView.js` show `[5779,7284)`、hide `[7890,8948)`，局部 UTF-16。不能进一步概括为“跨模式所有历史都丢失” |
| S09 | Fences 有块内键盘处理及边界交接；删除局部 CM 前同步节点 | `focus/Fences.js` onKeyDown `[19342,21510)`、addCodeBlock `[21510,25635)`，局部 UTF-16；本轮来源已通过 181 切片核验 |
| S10 | Node2Mark 保留部分 pattern/缩进/空白信息，同时也规范化数学、表格等内容 | main 模块 `[20356,31199)`；围栏至数学分支 `[25573,26893)`。保留属性不等于任意输入字节无损 |
| S11 | File.syncContent 请求在前端进行完整性检查并返回内容/资产；真正写盘在桥接另一侧 | 回调 `[193001,193188)`；File 模块 `[266838,294048)`。检查失败分支仍可继续调用同步函数，不能视作完备保存屏障 |
| S12 | 前端快照含正文、节点、历史、选区等；外部更改具有重载/询问分支 | File generateSnap 起始字节 281600、presentedItemChanged 283090；macOS 与 Node 分支条件不可混用 |
| S13 | 图片复制等请求交给宿主，收到成功结果后更新引用 | ImageEdit `[136750,186503)`，copyImage 调用 `[139117,139253)`。原生授权、覆盖和回滚尚未证实 |
| S14 | 导出先同步编辑并等待部分呈现，再产生内容及导出参数 | Export `[362054,393474)`；dataForExport `[368440,368942)`。不证明 PDF 分页质量或跨作业快照隔离 |
| S15 | 包内桥接注册 eval handler 并提供同步 prompt 路径 | TypeMark/index.html 122–140 行。仅为静态接口观察；未验证 frame 可达性，不能直接宣称存在可利用漏洞 |

`focus/` 的完整基路径为 `analysis/typora-1.14.10/interaction-audit-20261021/`；main 模块切片总索引为 `analysis/typora-1.14.10/modules/index.json`。本轮选取九模块的范围、原哈希和新输入路径亦写入 tracked provenance。

## 4 已有原生样本的复用

历史报告已随旧版归档，可通过以下命令查阅：

```sh
git show legacy/archive-2026-10-21:docs/references/2026-10-21-typora-runtime-contracts.md
```

其原始 case JSON 和夹具仍保留在 `build/verification/0.1.0-rc.1/interaction-audit-20261021/continuation/`。历史运行目标是 `/Applications/Typora.app`，不是启动仓库副本；其核心脚本哈希与本轮副本一致。相同包身份支持参考，但不替代当前设置、OS 和会话下的新运行验证。

| 历史样本 | 记录结果 | 新产品选择 |
| --- | --- | --- |
| TY-01/04 | 闭合/未闭合代码 Enter 增加 LF，失焦仍在代码块 | 保留此行为，并要求保存重开一致 |
| TY-02/03 | Cmd+Enter 退出代码；空代码 Backspace 转段落；Undo 恢复 | 定义成独立结构命令和历史事务 |
| TY-05 | 段落 Enter 后 Backspace 可合并回原段 | 明确新产品的段落拆分/合并契约 |
| TY-06/07 | 数学不续 Markdown 列表，但尾部 LF 可在序列化时消失 | 参考 owner 路由，拒绝尾 LF 隐式规范化 |
| TY-08 | 列表缩进可重编号并改变样本子项关系 | 新产品以完整子树移动和局部保真为准 |
| TY-09 | Setext H1 改 H2 更新下划线 | 覆盖标题整体结构，不遗留分隔符 |
| TY-10 | 活动 AX、失焦呈现、磁盘字节不同；剪贴板 payload 未直接读取 | 分别核验可见状态、实际剪贴板、根源文、保存结果 |

历史截图留在当时对话中，未导出到工作区；这些记录不是可自动重放的完整视觉基线。真实 IME、表格组合选择和窗口焦点链仍未由这些样本证明。

## 5 对新方案的影响

1. **输入归属优先于语法外观。** 正文、代码、数学、表格对同一按键有不同语义，需要统一路由与边界交接。
2. **结构、选区、历史必须共同提交。** 仅保证最终字符串相同，无法保证继续编辑时的位置和 owner 正确。
3. **保存的正确性不能寄托于失焦清理。** 参考应用的序列化会修正表示，新产品若要求保真，就必须让编辑事务本身产生合法结果。
4. **源文与结构不是二选一。** 可以用源文作持久化权威、结构作交互模型，但必须证明双向映射和无损改写，不把两个模型当成可独立写入的状态。
5. **桥接是生命周期协议。** 从调用名称无法证明写盘成功、窗口关闭屏障或错误回滚；新实现必须单独设计并故障注入验证。

这些是工程推断和新设计取舍，不是 REA 自动恢复出的系统保证。

## 6 研究清单与未决问题

| 研究问题 | 状态 | 下一步证据 |
| --- | --- | --- |
| 本地包身份与切片对应 | 已回答 | 后续换版本重新生成清单 |
| 宿主/编辑器边界 | 静态支持，原生内部实现部分未知 | 如需具体写盘结论，定向原生分析或受控 I/O 观测 |
| 节点、DOM、CM 和源码读取关系 | 主要静态分支已回答 | 事件时序需原生运行轨迹 |
| 代码/数学基本操作 | 静态 + 部分历史样本 | 新环境逐键回放，补未知边界 |
| 全部选择、输入法、拖选与表格行为 | 部分回答 | 系统 IME 与表格夹具，记录焦点、源文、截图和时间顺序 |
| 自动保存、崩溃恢复、资源原子性 | 未解决 | 宿主处理器或受控故障观测，不能由 JS 调用推断 |
| PDF 分页、性能、无障碍 | 未解决 | 固定样本的真实输出、测量与 VoiceOver 回放 |
| 全部 Typora 功能或动态调用图 | 本轮不覆盖 | 不作为本产品范围承诺 |

需求和技术方案可以据上述已知边界形成完整草案，但“Typora 全面逆向完成”仍不是本轮可支持的结论。
