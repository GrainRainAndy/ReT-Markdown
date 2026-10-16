# SDD ledger — plan: docs/plans/2026-10-14-editor-implementation.md

## 2026-10-14：执行准备

- 需求复核：完成；新增带格式复制已同步 F06/T24，迁移后的本地链接已校验，视觉样本哈希一致。
- 环境：Xcode 27.0，Swift 6.4，Node 26.11.1，npm 12.2.0；当前工作区没有 Git，`AGENTS.md` 为空，没有既有产品代码与测试。
- 模型约束：架构及高难度任务 `gpt-6-astra` / `high`；一般任务和具体代码 `gpt-6.1-sol` / `high`；只有机械性低难度任务才考虑 `gpt-6-luna` / `max`。
- 架构设计 agent：`01a13a8e-0dd1-7c32-b663-db49a1dfbffd`（Franklin，Astra high）；写入架构文档与执行计划，不写产品实现。
- 验收输入：`python3 scripts/generate-fixtures.py` 已运行，生成 19 个夹具文件与哈希清单。
- npm 网络探测：沙箱连接被拒绝后，已获工具自动审核允许并成功查询 CodeMirror view 版本。缓存使用 `/private/tmp/ret-markdown-npm`。

Ruling: 在现有工作区实现，不创建 Git 仓库或 worktree — 当前没有 Git 元数据，用户已明确要求在本项目开始执行；以文件职责和执行记录控制修改 — 代价是当前不能提供提交级回滚与审查差异。

Ruling: 计划、架构、测试记录直接放在 `docs/` 相应子目录 — 遵循用户删除 `superpowers/` 中间层的明确偏好 — 与技能默认目录不同，但不影响需求追踪。

Ruling: 按“复核无误后可以开始”继续设计与实现，不另设重复确认关卡 — 用户已明确授权子代理执行及模型分工 — 后续若改变产品范围或已确认架构仍需更新基线。

## 完成证据规则

代码测试、构建、运行验证、原生系统行为和性能指标分别记录。只标记实际执行且结果符合要求的项目；产品原型不等同于完整首版验收。

## 独立渲染任务

- 子计划：`docs/plans/2026-10-14-rendering.md`。
- Implementer：`01a13a93-1993-7f61-8d46-bb7a43624e1b`（McClintock，6.1 Sol high）。
- 所有权：根 npm 配置、渲染模块、样式、离线资源与 Web 构建脚本；不写编辑器与原生代码。
- Pre-flight：渲染输入只读源文；`RenderResult` 的错误范围采用 UTF-16，与编辑器接口一致；远程占位为正常输出，缺失本地图与错误公式为导出阻断问题；物理页边距归原生打印，CSS 不叠加。

## 总计划 pre-flight

| Tasks | Shared interface/file | Result |
| --- | --- | --- |
| R/3/6 | renderMarkdown、富文本、样式/build | 已固定；根配置只由 R 写入，后续请求其修改 |
| 1/2 | Swift Source/Snapshot/Patch/Commit + Codec | UTF-16、EOL 数量与版本规则一致；2 可先搭骨架，编译待 1 |
| 1/3 | TS Source/Patch/encode/apply | 一致；3 不重写纯 codec，补充编辑历史字段 |
| 3/4 | EditorSession + liveExtensions | 4 导出装饰与表格，3 集成 hook；禁止两个 owner 同改 session |
| 2/5 | SaveCoordinator + 资源迁移 | 5 写独立存储/协议，2 负责文稿接线；成功后才采用引用修改 |
| 2/6 | PDFExporter + ExportReady | 6 独立导出器，2 接菜单；不能用单页截图替代打印 |
| 5/6 | AssetManifest + capability URLs | PDF 使用固定资源映射；不得自动请求远程图片 |
| 1 | tests vs code/files | codecs 和 wire schema 职责闭合，无产品 UI |
| 2 | tests vs code/files | bridge/save 行为可测；系统恢复需实际验证，不能以 mock 代替 |
| 3 | tests vs code/files | 唯一状态与 EOL undo 归本任务；live/source 不新建历史 |
| 4 | tests vs code/files | 表格局部修改、IME、边界导航归本任务；native IME 留运行验证 |
| 5 | tests vs code/files | staged copies、draft manifest、失败恢复闭合；挂接归 2/3 |
| 6 | tests vs code/files | readiness+atomic PDF 与实际分页均有独立门槛 |
| 7 | checks vs claims | 性能/系统设置/视觉等尚未通过，必须记录实际结果 |

Ruling: 对没有文件写入重叠且接口已冻结的子系统允许并行 — 遵循本会话工具对独立 slice 的并行要求，减少等待 — 主控负责统一接口及逐任务审查，交叉修改由原 owner 完成。

## Active tasks

- Task 1 implementer: Kant `01a13a9a-dc4b-75d1-b7ee-fe0d8e0d7018`, Astra high; owns codecs/protocol and their tests.
- Task 2 implementer: Gauss `01a13a9a-dc95-78c0-b11b-c5a6d3b3664a`, Astra high; owns native shell/bridge/save and Swift harness.
- Task 3 implementer: Sol6.1 high; owns session/main/commands/clipboard, consumes fixed codec interfaces while Task 1 runs.
- R implementer continues offline renderer, rootnpm/build/styles; no ownership overlaps.

Ruling: 原生 JavaScript 接口统一为 `window.retEditor.receive(envelope)`，初始化身份为 `window.retEditorBootstrap={documentID,sessionID}` — 两个实现者曾提出不同名称，现统一以编辑器 owner 的公开入口为准 — Task2/3 已通知；JSON 通过 callAsyncJavaScript 参数传入，不拼接源文。

- Task 3 implementer identity: Ptolemy `01a13a9b-534d-7661-9a25-a9a99d6146e6`（6.1 Sol high）。
- Native SwiftPM harness created by Task 2; build caches set to writable `/private/tmp/ret-*` or `build/` directories.

- Task 5 implementer: Bacon `01a13a9d-f44a-7d41-b839-f41e9992d32e`（6.1 Sol high），owns assets/drafts/scheme.
- Task 6 implementer: Lorentz `01a13a9d-f4a6-74e2-ab70-6a6045baff5b`（6.1 Sol high），owns PDF/export readiness.
- Task 4 尚未派发：同时运行上限 6，待现有任务完成释放位置后启动 Astra high。

Ruling: live extension contract以 `web/src/editor/live-contract.ts` 为准 — 回调获取源文、应用根事务、资源解析和 composition 状态，隔离两个 owner 的写入 — Task3 集成 factory，Task4 不改 session。

Ruling: 首次保存/另存涉及图片引用迁移时，使用内部 `setReadOnly {value:true}` 原子锁定编辑再取得 barrier，成功采用路径补丁或失败恢复后解锁 — 防止异步资源复制期间输入使源文区间过期 — 中文组词期间拒绝锁定并保留输入；普通保存不锁定。Task2/3/5 已通知，新增行为必须有保存竞态测试。

## Task 1 implementation evidence

- Report: `docs/testing/task-1-report.md`; TS 56/56 and isolated Swift codec/schema 14/14 pass; same 9 fixtures roundtrip byte-exact. Controller independently ran source TS suite: 56/56 pass.
- Full suites remain pending: session BOM decode helper (default TextDecoder strips BOM), native AssetStore not implemented at that run. Independent task review still required; not marked complete.
- Kant closed to free thread. Task4 Astra launched next using published live-contract.

Ruling: 图片解析使用显式 capability map（load.assets 与 setAssets），不拼接资源前缀 — UUID capability URL 与 Markdown 路径没有可推导关系 — Task2/3/5/6 已统一；样式/资源映射更新不得改变源文或历史。
- Task4 implementer: Parfit `01a13aa7-c81c-79f0-a062-faa7acfa9125`（Astra high）。

## Renderer implementation evidence

- Report: `docs/testing/rendering-report.md`; focused 23/23 +render typecheck/build+isolated Chromium checks pass; nativePDFnotproven. Fullsuite externalunfinishederrors recorded.
- Renderer agent closed, root build/npm/config/index ownership handed to Task3 for integration; renderer/** and styles remain separate reviewed scope. Renderer review pending.
- Task1 reviewer Raman `01a13aa9-b9b6-70f3-bcc9-67d1579ec2b3`（Astra high）；review package `docs/testing/reviews/task-1.diff`。

Task 1: complete — source codec/schema implementation and independent Astra high review approved Spec and Quality. Evidence: `task-1-report.md`, `reviews/task-1-review.md`, captured `reviews/task-1.diff`. Product UI/native save checks remain pending; Task3 asset-map protocol amendments require final integration review.

- Renderer fresh independent review started (Sol6.1 high).
- Controller broad checkpoint: typecheck pending main.ts transport import; web 108 pass/11 fail/1 skipped +transport suite unresolved as Task4 intentionally RED. This is a checkpoint, not a completion claim.

## 2026-10-15 网络断线后恢复

- 用户要求继续；恢复 Task2/3/4/5/6 与 renderer review 原代理，模型设置延续，不重派 Task1。
- 实际检查：root typecheck pass；web 127 pass、2 fail、1 opt-in skip。失败为 native plural image insertion 仍进入 chooser、清空后重填表格单元格 padding 映射错误，已交原 owner。
- 首次 build-app exit23：共享 build/web/app.js 同时被其他构建截断，rsync 检测 truncated。
Ruling: 控制器唯一发布 build/web 和 .app；其他代理浏览器测试使用独立 outdir/write:false — 消除发布同路径写入竞态 — 各 owner 已通知，源代码写入职责不变。

- Task3 implementation report complete: `task-3-report.md`; 25 focused + local file Chromium proof pass, plural insertImage fixed. Review pending; owner closed.
- Renderer independent review Changes required: escapedpipe table issue range collision, list-math outdent, remote percentURL preservation; hard parser fix assigned fresh Astra high. See `reviews/renderer-review.md`.
- Current Release `.app` build and ad-hoc signature succeeded with approved escalation after sandbox dsymutil denial; real UI validation now starts. Native PDF previous synchronous print hung; Lorentz investigating public async print route with external deadline.

## 落盘任务与后续审查

- Task2/4/5/6 implementer reports 已落盘并返回，已关闭原代理。Task4公开liveExtensions factory可接线；18unit+14browser通过。Task5 28focused通过。Task6实际5页及27页PDF证明通过；66native tests 65pass/1skip（elevated）。
- Renderer R1–R3 Astra修复完成，39focused通过；独立定向复核启动。
- Task3独立审查S1–S5五个P2；恢复Ptolemy进行fix round1，接通已完成livefactory，一次修复后需复核。
- FreshAstra high批量审查nativeTask2/5/6交界，分别输出每任务Spec/Quality；Sol6.1high审查Task4及renderer修复。

## Native UI blocking regression

- Actual .app opened frozen sample, no-edit CmdS hash unchanged; created independent Untitled2 and typednihao. First CmdS then AX timed out twice.
- Read-only process sample `build/native-save-sample.txt` confirms main thread blocked in NSDocument serialization semaphore through saveDocument activity. Not classified as generic UI tooling failure.
- Task2 original Astra Gauss resumed fix round1; public NSDocument activity/async save continuation suspected, must reproduce/fix with bounded real activity regression. No raw-file save fallback permitted.
- Real nativeIME notentered throughCtrlSpace twice; optional questionpending user'sinputmethod/shortcut. No nativeIMEpassclaim.

- Task3 fixround1完成并接通livefactory；控制器实际web全套166pass/1optin skip，typecheckpass；原Sol审查者定向复核中。
- Renderer R1–R3 独立复核Spec/Quality PASS，当前修复范围关闭。
- Task4独立审查L1–L4四P2（反斜线管道语法、列对齐、单元格inline语境、cut源文映射）；原Astra Parfit恢复fixround1。
Ruling: Task4可在renderer markdown.ts添加纯inline helper复用同一grammar/referencecontext，不改变现有render API — 修复cell使用block语义 — 此单文件新增helper由Task4独占，最终审查覆盖。

Native review Changes required: Task2 R2-1 public activity deadlock, R2-2 recovery sessionrevision ordering, R2-3 post-write retry fingerprint; Task5 R5-1..4 independent SaveAs recovery namespaces, staged provenance rollback, nested-list image scan, recovered frozen capability retention; Task6 R6-1 HTML-block overflow source mapping.
- Gauss fixes Task2 lifecycle/retry; fresh Astra fixes Task5+crossR2-2 (no undo reset/wireID mismatch); Sol6.1 fixes bounded export mapping. All reports and reproductions are under reviews/.
- Hung own testapp80819 terminated after sample +visible nihao saved to build/ui-recovery-test.md, originalsampleunmodified. No otherapps stopped.

Task 3: complete — S1–S5及S3-R1定向复核Spec/Quality PASS；realfactory已接通。证据 task-3-fix-report.md 与 reviews/task-3-fix-review.md round2。原生IME仍独立待验收，不以synthetic代替。

- 当前浏览器性能首轮常规256KiB live input P95约35.8ms，1MiB live open约1376.6ms；因测试期间renderer源码变动，该轮标记incomplete，且不能代替原生Release验收。边界输入延迟仅附加诊断，50ms明确目标为常规夹具。
- 控制器独立视觉查看PDF第1及27页：白底、公式、代码、末尾表格和长代码显示完整；read-only artifact检查。

Task 4: complete — L1–L4定向复核Spec/Quality PASS（task-4-fix-review.md）。
Task 6: complete for implementation/review — R6-1定向复核Spec/Quality PASS（task-6-fix-review.md）；真实PDF证明有效，应用UI入口仍控制器复测。
- Performance harness: stable browser18series×20samples完成，regularliveinputP9532.5ms、1MiBliveopen1321.1ms；无网络/指纹变化，报告明确非nativeRelease验收。
- Task2fixREADY18focusedgreen，包括真实menu/menu、autosave/menu回归child与heartbeat，R2-3retry/SaveAs修复；重新发布以复测GUI。NativeAstra原审查者恢复定向复核Task2/5。

Task 2 / Task 5: original scoped fixes independently PASS, see `reviews/task-2-fix-review.md` and `reviews/task-5-fix-review.md`. These close R2-1..3/R5-1..4/cross-R2-2, not all GUI acceptance.

## Final integration checkpoint

- Controller fresh final logs `build/final-*.log`: web 187 pass/1 opt-in skip; native 79 total, 78 pass/1 opt-in skip, zero failures; typecheck and Release build/signature pass; real Chromium 22/22, packaged session and renderer checks PASS.
- Bounded current native PDF runtime opted in separately: 1/1 pass, 0.609s test, 27-page searchable Chinese/code A4 artifact `/private/tmp/ret-final-pagination-proof.pdf`. A single Debug runtime proof is not Release performance acceptance.
- Final fresh Astra whole integration review `reviews/final-review.md` reports four P2: FR-1 live body links unreachable, FR-2 reference-image context omitted in live widgets, FR-3 continued reference definitions omitted by native asset scanner, FR-4 live fenced code lacks token highlighting. No new P0/P1. Whole CODE verdict remains Changes Required until scoped fixes reviewed.
- Original Astra Parfit resumed for FR-1/2/4; Astra Russell resumed for FR-3. Disjoint ownership, root remains sole build/web + app publisher. Final reviewer Mill closed until fixes ready.
- Computer-Use recovered the original SavePanel binding. Native test document saved as `build/native-ui-smoke.md`; `cmp` against preserved input succeeds. CmdShiftE opened native export sheet and produced `build/native-ui-smoke.pdf`; actual GUI save/export path now has evidence. More lifecycle/IME/visual/performance gates remain.

- FR-1/2/4 owner READY: `final-live-fix-report.md`; 189web pass/1skip,32browser pass. Independent Mill scoped review `reviews/final-live-fix-review.md` PASS, source/history/table prior fingerprints retained. FR-3 owner READY: `final-assets-fix-report.md`;41nativefocused/29grammar comparisons pass; independent review pending.
- GUI live/source PDF text and72dpi PNG are identical. Clean LIVE direct-menu SaveAs succeeded, subsequent redo restored earlier paste (history retained); cancellation in dirty SOURCE preserved source/dirty state. Keyboard CmdShiftS in dirty SOURCE repeatedly reports unavailable before panel, whereas direct File menu SaveAs reaches panel; original Gauss resumed to isolate this specific public-entry/timing issue before any proposed fix. Ordinary undo+Save still works; same-file Open returned existing sole named window.

## Final clean handoff

- FR-1..4 independent scoped reviews PASS. Runtime shortcut root was automatic AppKit Duplicate, not stale bridge or resource migration: archived RED stack `build/verification/native-save-as-routing.json` shows duplicateAndReturnError → uncaptured autosave-elsewhere write. Explicit MenuController action/target forwards to public NSDocument.saveAs(nil); actual same CUA keyboard path now opens Save As, archived GREEN stack `native-save-as-routing-green.json` confirms correct entry and no uncaptured write.
- All temporary production/test tracing and Info switches removed. Minimal menu correction and externally bounded public-entry/menu regression retained. Independent final scoped review `reviews/native-save-as-fix-review.md` PASS; `reviews/final-review.md` overall Spec/Quality CODE updated PASS, release acceptance NOT COMPLETE.
- Controller final clean source: web189pass/1optional skip, typecheckpass; browser32/32; native84total/83pass/1optionalPDFskip/0fail; separately opted-in nativePDF1/1PASS0.490s,27pages. Final packaged session/render realbrowser checks PASS. Export browser optional check separately enabled before handoff.
- Final Release build/signature PASS; logical bytes11,950,713 (~11.40MiB), 83webfiles byte-match build output, no diagnostic marker/key in binary/plist. Inventory `build/verification/final-bundle.json`; logs `build/final-*.log`.
- Browser final-source rerun18series×20samples finished without errors/source changes; regularliveinputP9548.3ms, boundaryliveopen844.2ms. NativeRelease performance not substituted. See updated performance-report.
- `acceptance-status.md` maps every T01–T25 and preserves native IME/lifecycle/visual/Release performance and incomplete panel-confirmation matrices. No source-control commit/merge claimed: workspace has no Git metadata. No system settings altered. All agents used requested Astrahigh / Sol6.1high allocation; no Luna.

- Last opt-in browser export suite22/22passed (`build/final-export-runtime.log`), including previously skipped actualbrowserfont/image/overflowcase. All enabled checks passed; originalskips retainedinfullsuitecounts, no doublecounting. Final code/test/config fingerprints captured. All subagents closed afterreports/reviews, no unfinished agent task.

## 2026-10-16 actual acceptance follow-up

- User acceptance relay from coder-2: `build/verification/acceptance-handoff.txt`,9confirmedfocus/list/livegrammar/Setext/tablefind/search/menu/dark/layout issues against identical shipped hashes. Plan `2026-10-16-acceptance-fix-plan.md`; prior overall CODE PASS is historical and does not cover new defects.
- Agents authorized allocation retained: Parfit Astrahigh AC3/4/9 (`01a13aa7-c81c-79f0-a062-faa7acfa9125`), Epicurus Astrahigh AC5/7 (`01a14054-b890-71f3-ade6-3d4d841ab494`), Leibniz Sol6.1high AC2 (`01a14054-b8da-7883-8bc6-600bb2c6cbf6`). Main owns AC1/6/8 and root scrollerlineheight. NativeMenu/main/session write sets disjoint; only main publishes.
- Same native baseline normal-permission rerun `build/verification/acceptance-native-unsandboxed.log`:84total,1skip,zero failures; confirms sandbox LS/file denial evidence must not be treated as a demonstrated product defect. Final modified-code native rerun still required.
- Main7actualChromium regressioncases RED forloadfocus2/sharedquery+replacement2/darkcanvas2/scroller1; currentfix7/7GREEN (`acceptance-session-red/green.log`). Main nativeFind/Replace now forward same CM UI/query, no duplicate NSAlert state. Additional actualkeyboard/menu same-panel regression added; pending root rerun.
- Tableowner4behavioralREDcases captured private scratch; root tableInteractions extension agreed via Parfit integration, no LiveOptions contract change. Projection/list owners actively fixing; typecheck may transiently fail on pending new SyntaxSpan test API. No release claim.

- AC2 initial independentreview ChangesRequired AC2-R1 narrowedmarker padding changes body/codegrammar,AC2-R2 laterparagraphbypassescode-firsttaskfallback; freshAstraJames `01a14063-341a-7c32-a3b0-26d623a9c5be`fixround1commands/tests only. SolreviewerMeitner closeduntilhandoff.
- MainAS1 review foundReplaceAll+adjacenttypinghistorymerge in mounted CM (headlessdoesn'trepro). Actualbridge/panel2REDthenroottransactionExtender isolateHistoryfullforinput.replace;11browserGREENincludingprior/followingtyping and3separateundos/BOM/EOL. MillindependentAS1closurePASS, nooverallPASS.
- AC5/7 Epicurus frozen/closed:9table+prior32=41browserGREEN; currentunit239/1skip/typecheckpass. ParfitAC3/4/9frozen/closed10projection andcombined62browserGREEN; freshEulerAstra `01a14066-81e6-70f3-968d-d6ca3a5a987a`reviewsbothlive/table.
- Performance rerun uncoveredmajornewprojection regression:4boundary1MiBlivesamples timeout15s,regular256KiB liveinputmax~232ms vspriorP9548ms; sourceinput~32ms. Stoppedonlyownedbenchmarkpid6646viaSIGINT(scriptcleanup), incompleteartifact `build/performance-acceptance/performance.json` retained. ParfitresumedAstrahigh profile/fixsameownedsyntax/decorations; Eulerreviewnotifiedmutableperformancework, nofinalapproveuntilnewhandoff. Notraisingbudgets/alteringfixtures.

- AC2round1reviewclosedR2/originalR1butresidualR1a unselecteddescendanttabstop semanticloss. Jamesround2unifiedancestor/descendantcolumnplan:111focused,9504combos pass. MeitnerfinalindependentreviewPASS allR1/R1a/R2closed. No furtherlistpatchneeded.
- ProjectionAP1 quotedSetextprefix/AP2 backslashHardBreak corrected afterfreshreview; performance actualprofileconfirmed quadratic gap/quote/membership scans, fixedwithsweep/index/cache (no documentcutoff). Frozenprojection68combinedbrowser/unit272snapshot; freshEulerAP1/AP2+perfalgorithmSpec/QualityPASS, tablePASSretained.
- ALLproductownersfrozen/closed. Rootfinalchecks:289webpass/1runtimeoptinskip,typecheckpass,68realChromiumcasespass; finalnative84total83pass1PDFskip0fail. Opt-inPDF/browserexport nowseparatelyenabled. Finalcomponent20runperfstillpending.
- UseroriginalappPID97142isrunning. OptionalRET_APP_OUTPUTaddedtobuildscript(bashsyntaxpass); rootcandidatebuiltRelease at `build/release/ReT Markdown.app`, signaturevalid. Original`build/ReT Markdown.app`87filehashesexactlymatcholdmanifest,notoverwritten. Isolatedsamebuildcopy `build/verification/ReT Markdown Acceptance.app` withCFBundleIDnet.ret-markdown.acceptance prepared/resigned solelyfornewnativeUItests; originaluserUntitleduntouched.

## 2026-10-16：验收修复冻结检查点

- 四组实现与复核均关闭；AC2-R1/R1a/R2、投影AP1/AP2及会话AS1已独立关闭。全部subagent已关闭，无未领取实现任务。
- 最终冻结验证：Web289pass/1skip；browser68/68；native84total/83pass/1skip/0fail；TS通过；两项可选运行时各自显式开启通过；PDF27页A4。日志见本日acceptance-results。
- 性能最终18×20完成，零错误/源码变化；regular live输入44.9ms、boundary live打开555ms；原生性能未冒认完成。
- RET_APP_OUTPUT独立Release输出通过；87份旧包文件与历史清单一致。新候选83份Web逐字节一致，逻辑大小11,952,903字节；baseline样本哈希不变。
- Computer-Use独立bundleID原生抽查通过焦点、实际保存、列表、查询共享、单元格选区、短表格菜单Escape、深色与排版。完整样本最终保存字节与输入一致。即时新建加载前按键未录入，作为启动时序限制记录。
- 真实IME尝试无候选，未通过；临时切换输入来源后，恢复ABC遇原生控制管道启动失败，当前恢复待确认。未更改启用列表/系统快捷键。全部原生动作仅CUA；没有用shell模拟UI。

## 2026-10-16：二次复验最终冻结与交付

- 外部复验两个P2先2FAIL/1PASS；根负责F07表格，Pasteur `01a14232-3594-7b32-8b32-0e281d82ccde`（Astra high）负责renderer math上下文，新单元测试与真实browser；Hegel `01a14235-b868-76b3-a957-451a6ff8a573`（Astra high）独立复核，发现R1 caret错位、R2生产样式长文pending scroll、R3optional-pipe Tab回流。主控补修并保持所有旧断言；最终Spec/Quality PASS，hash起止一致。两agent均已关闭，无剩余probe。
- 最终产品范围：decorations.ts（0485abf3…）、cell-widget.ts（927b6ad2…）、markdown.ts（267de828…）。math token Map O(T+R)；表格展开与root/mini光标交接、explicit exit UI状态、select.search公开requestMeasure续帧；无新源文副本/history。
- 最终95/95 browser（36.8s）、Web298PASS/1可选skip、typecheck PASS；原始边界3/3；可选Web导出22/22与最终包WK PDF1/1（27页A4）另行开启。原生源码/Tests哈希未变，核心83PASS/1skip复用本轮独立验收检查点，未冒称重跑。
- 新路径build/candidate-20261016/ReT Markdown.app，83份Web匹配、11,954,223字节、strict/deep ad-hoc签名PASS；原旧两个包哈希未变。最终清单reacceptance-final-bundle.json与reacceptance-final-source-sha256.json。
- 独占自有重任务的原性能脚本18×20完成，exit0/errors[]/sourcechanges[]：regular live输入49.8ms（接近50ms组件比较线），boundary live打开564.5ms，boundary输入208.9ms诊断。原生startup/RSS/IME/PDF规定序列仍未测。
- CUA pipe仍失败；本轮没有最终原生窗口新证据。输入来源08:56:57只读已ABC，先前恢复待确认事项解除。最终状态及完整限制见2026-10-16-reacceptance-results.md和acceptance-status.md。

## 2026-10-16：0.1.0-rc.1 版本化交付及原生通道恢复

- 用户重启后台后 CUA inventory 与原生操作恢复。用户要求明确版本号，当前 canonical 为 `0.1.0-rc.1`，正式版目标 `0.1.0`；后续发布/验收产物用版本路径，历史证据保留原名。
- Carver 实现、Tesla 独立复核，主控派发均显式配置 `gpt-6.1-sol` / high；复核 Spec/Quality PASS，二者已关闭，无 Luna。主控追加发布与验收状态文档，复核中原文件 hash 仍表示当时快照。
- 实际 Release 构建成功：`build/releases/0.1.0-rc.1/ReT Markdown.app`，版本字段 0.1.0-rc.1 / 0.1.0 / 1；87 文件、11,954,469 字节，83 Web 与旧冻结候选一致，strict/deep 签名 PASS。逐文件 SHA 复验通过，历史 app 未覆盖。
- 自有版本化 QA 隔离 bundle ID；原生打开已有夹具、引用分数排版、点击 next 查找表格 `---:` 命中可见、CmdShiftS 另存为成功，81 字节与输入完全一致。CmdShiftE 实际导出 1 页 A4 PDF，文本可提取，PNG 检查无裁切/重叠。详见 `0.1.0-rc.1-native-smoke.md`，没有把首次 Return 无变化冒称快捷键 PASS。
- 未重跑版本整理前的 298/95 行为测试或 18×20 性能序列。真实 IME、完整原生生命周期/视觉/性能门槛继续保留，完整 V1 未验收通过。
