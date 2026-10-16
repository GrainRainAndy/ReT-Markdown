# 表格隐藏源文查找修复

F07要求完整源文查找定位隐藏语法时展开必要源文。旧组件将整表始终替换为widget，单元格mini-view只能显示单一内容单元格内的范围，因此分隔符、外侧pipe、跨单元格/行/表格边界都不可见。

根控制器在`web/src/live/decorations.ts`投影时判断根选区：与表格相交且不能完全投影到同一内容单元格的选区，直接保留根源文。分隔行不在内容rows中。收起选区后位于表格内部、内容单元格之外的caret仍保留源文，允许继续编辑对齐标记；表格首尾边界保留既有Tab退出行为。单元格内部继续使用原mini-view，根history与源文不变。composition期间仍沿用原映射屏障。

先运行独立复验，原边界2失败/1通过。新增8项真实CM回归均先失败，最小展开修复后均通过；另增separator定位→ArrowLeft→键入冒号→撤销/退出，先失败后补caret分支。RED日志`build/verification/reacceptance-table-red.log`与`reacceptance-table-caret-red.log`；最终结果以`reacceptance-table-green.log`为准。

新增测试`web/test/reacceptance-table-source.spec.ts`覆盖分隔符、管道、跨单元格/行/边界、真实面板焦点与返回cell命中、BOM/混合EOL字节不变和replace/undo。未执行最终原生UI复测，不以Chromium证明macOS完整验收。

最终本组9/9通过（3.3秒）；独立复核与整体组合验证另行记录。

## 独立审查补充与最终实现

Astra独立probe发现两个额外边界，初步9项绿灯未覆盖。跨cell选区收起到cell内容后，widget重建，但旧逻辑只为非空根选区创建mini-view；因此root caret落在替换DOM中，浏览器后续输入错误落到after。`cell-widget.ts`现在也投影空caret；先同步mini selection，仅当根view拥有焦点时将输入焦点交给mini，查找panel仍保持自身焦点。原两个probe 2/2通过，并新增command/panel两项与一次undo。

长文滚动最初bare harness还受缺少生产CSS/body margin影响；独立对照加载实际typography/palette与DOCTYPE后，80/160/200段落仍确认真实失败。trace显示CM虚拟视口测量超过其有界迭代次数，发出Viewport failed to stabilize后退出，scrollTarget保留却没有下一帧；source模式对照正常，公开requestMeasure恢复命中。修复在liveExtensions的公开updateListener监听select.search，首轮测量后下一帧调用公开requestMeasure，校验view连接、选区一致、live且非composition。不直接操作scroll、不访问private、不新建事务或history，不提高CM内部预算。

新增80/160/200实际样式viewport测试先3项RED，再14/14表格GREEN（4.8秒）。日志`reacceptance-viewport-red.log`、`reacceptance-table-final-green.log`、`reacceptance-caret-handoff-green.log`。数学实现不受这些补充修改影响。完整browser及独立最终复核另行记录。

## 整套兼容性验证

首次空caret接线后的整套91项出现旧L3/L4两个有效失败（日志`reacceptance-final-browser.log`）：root空caret不应覆盖当前拥有焦点的mini编辑器选区。最终选中cell的条件收紧为非空root选区，或root本身拥有焦点的空caret。它保留既有mini选区与composition后的剪切，同时允许从展开源文收起选区时进行必要焦点交接。没有修改旧测试断言。旧两项与14个新F07场景合计16/16通过（`reacceptance-caret-regression-green.log`），随后再次执行完整91项，最终日志另存`reacceptance-final2-browser.log`，保留失败历史。

## 合法省略边缘管道的Tab边界

独立review进一步确认optional edge pipes使cell.from/to与table.from/to相同，通用空caret交接会把显式Tab退出立即拉回mini。最终TableController仅记录显式exitPosition的UI焦点意图；caret位置改变、非空选区或显式cell focus清除此标志。它不是另一份文稿状态，也不产生事务/历史。新建widget由raw source选区收起时没有exit意图，仍允许交接到header起点caret。

新增无外管道、无左管道、无右管道三项Tab控制，及无左管道header起点收起选区编辑控制。旧L3/L4与18项F07合计20/20通过（7.7秒，`reacceptance-focus-exit-green.log`）。产品最终焦点文件hash `927b6ad2d64a2f4d3279f81ac3e1b9d2430a38d6e0fe265c4cb4a63095382423`，全套95项后续日志`reacceptance-final3-browser.log`。
