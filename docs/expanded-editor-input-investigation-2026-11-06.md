# 展开详情编辑器输入异常：检查报告与解决方案

日期：2026-11-06（Asia/Shanghai）
项目：ZotObsidian Bridge
本轮性质：仅检查、内存实验及方案设计，未实施修复。

## 1. 结论

这不是简单的“Obsidian 建卡慢”或“等待 ACK 才能输入”。当前证据指向详情编辑器自身的 DOM 选区兼容问题，以及它与共享会话之间的中文组合输入竞态。二者可以叠加，不能只修改同步等待时间。

| 发现                                                        | 证据等级                                   | 判断                                           |
| ----------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| XHTML 宿主与 CodeMirror 的大写节点名判断不匹配              | 已复现依赖函数级异常，真实宿主因果链待补证 | 最符合“新行出现、光标仍在上一行”的首要线索     |
| 详情页在 IME 组合期间未更新会话正文，异步状态通知回填旧正文 | 使用真实会话类及模拟视图回调确定性复现     | 已确认存在可导致中文被覆盖的代码路径           |
| 整篇正文替换没有保留选区                                    | 使用真实 CodeMirror EditorState 复现       | 会把正文中间的光标映射到开头，放大回填问题     |
| 补全插件在 ViewPlugin.update 内可能同步 dispatch            | 特定事务类型下复现嵌套更新尝试             | 需修正的独立风险，但不足以单独解释所有输入异常 |
| 现有测试缺少真实 CodeMirror DOM 与系统中文输入法覆盖        | 测试代码审阅确认                           | 先前测试通过不能代表这轮问题不存在             |

**当前不得将本问题标记为修复或验收通过。** 用户已确认双链候选点选可用，这只代表候选点选功能通过，不代表详情页基础输入通过。此前报告中的详情页输入通过记录属于先前包与先前场景，不能覆盖本轮新报告的回归。

## 2. 用户现象与检查边界

### 2.1 本轮问题

1. 在展开详情页增加新行，页面出现新行，但光标不跟随。
2. 点击新行再输入，光标跳回原处。
3. 中文输入有时只显示首字，空格、数字及鼠标选候选词均不能正常提交。
4. 关闭再打开后，之前生成的新行可以编辑；再次新增行仍异常。
5. Reader 内普通 Bridge 小卡片没有这些问题。

“空格换行”在此不擅自解释为一个按键：后续须分别验证 Enter 硬换行、自动折行、普通空格和 IME 空格选词。

### 2.2 本轮实际做了什么

- 只读检查源码、依赖源码、既有执行报告和安装包。
- 执行三个不访问真实 Vault/队列的现有测试脚本。
- 运行内存实验：模拟异步草稿/轮询完成、调用真实会话类、CodeMirror 状态更新及依赖函数。
- 新增本 Markdown 报告。

没有改插件代码，没有构建、安装、重启或操作 Zotero/Obsidian 界面，没有修改测试卡片、主库、草稿文件或实际队列，也没有提交或推送 Git。

本轮没有现场采集真实 macOS 中文输入法事件。因此报告区分“代码级确定复现”和“真实 Zotero 中的最终根因确认”，不把模拟事件当作系统 IME 验收。

## 3. 检查基线

仓库：`/Users/yuke/Desktop/code/zotero-obsidian-bridge`。检查时 HEAD 为 `2c6d9dc0ea5d8a27f1309bf4d52fb0cfa8b720c6`，工作区有既有未提交开发内容，HEAD 不等于全部被检查源码的版本。

只读核对 C 隔离 profile 中的 XPI：

```text
路径：.scaffold/c-profile/extensions/zotobsidian-bridge@qianzhouji.xpi
SHA-256：3423dfa6b6daac8f98abe033f084ac686050fb9892a2fa29a866174b7d41e694

包内 content/editor.xhtml：
8195ae33a77e79c5f9046af93dca5fa9e8dddbce6363807fa131c8db140e0292

包内 content/scripts/zoteroobsidianbridge-editor.js：
53a5a153fcdad6ecd05acbe85b0f7c428b71832f628ff90dd133d285a0e0f1f5
```

这两个包内文件与当前 `.scaffold/build/addon/` 对应文件逐字节相同。包内也包含本报告指出的节点名判断、组合期跳过 scheduleSave 和补全关闭逻辑。这是磁盘安装产物核验，不是对运行中进程内存版本的重新证明。

| 依赖                     | 本地版本 |
| ------------------------ | -------- |
| @codemirror/view         | 6.43.15  |
| @codemirror/state        | 6.7.6    |
| @codemirror/autocomplete | 6.20.4   |
| @codemirror/commands     | 6.11.1   |
| linkedom                 | 0.18.14  |

## 4. 两种编辑界面的关键差异

```text
普通 Reader 小卡
  textarea 原生选区及组合输入
  → input 读取 textarea.value
  → session.edit（组合态拥有者也更新正文）
  → 本地草稿 / 后台同步

展开详情页
  XHTML 文档中的 CodeMirror DOM
  → CodeMirror transaction / updateListener
  → 更新窗口 localContent
  → 非组合态才调用 scheduleSave → session.edit
  → 会话通知到达时，如内容不同则整篇 hydrate
```

两者共用会话与后台同步，并不共用同一种输入控件。普通小卡正常，不能排除详情页独有的 DOM/选区或会话接入错误。

代码入口：[详情页 EditorView 初始化](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-window.ts:487)、[Reader 小卡 input 处理](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/reader-card-popup.ts:464)、[textarea 创建](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/reader-card-editor.ts:1)。

## 5. 发现一：XHTML 下行边界被错误视为等价位置

### 5.1 代码证据

详情页由 [editor.xhtml](/Users/yuke/Desktop/code/zotero-obsidian-bridge/addon/content/editor.xhtml:1) 提供，拥有 XML 声明、XHTML 根节点及带前缀的 HTML 子节点。正式卡与待建卡均打开该文档：[正式卡入口](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/markdown-editor.ts:196)、[待建卡入口](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/pending-markdown-editor.ts:273)。

本地 CodeMirror view 依赖的 `scanFor` 用 `node.nodeName == "DIV"` 阻止“等价选区扫描”穿过行边界，也以 `"BR"`、`"IMG"` 判断特殊节点。其 DOMReader 同样包含大写节点名判断。

`updateSelection` 在目标选区与浏览器当前选区被判断为等价时，会跳过实际选区写入。参见 [节点扫描函数](/Users/yuke/Desktop/code/zotero-obsidian-bridge/node_modules/@codemirror/view/dist/index.js:475)、[选区写入判定](/Users/yuke/Desktop/code/zotero-obsidian-bridge/node_modules/@codemirror/view/dist/index.js:3113)、[DOMReader](/Users/yuke/Desktop/code/zotero-obsidian-bridge/node_modules/@codemirror/view/dist/index.js:4047)。

HTML 文档与 XML/XHTML 文档的元素节点名大小写行为不同；可参照 [MDN tagName 文档](https://developer.mozilla.org/en-US/docs/Web/API/Element/tagName) 和 [nodeName 文档](https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeName)。依赖中采用大写判断也可与 [CodeMirror 官方源码](https://github.com/codemirror/view/blob/main/src/dom.ts) 对照，但版本定位以本地锁定依赖为准。

### 5.2 本轮对照实验

从本地锁定依赖读取原始 `isEquivalentPosition`、`scanFor` 及辅助函数，不改函数逻辑。分别构造 HTML 与 XHTML DOM：上一行包含 `abc`，下一行为含 `<br>` 的空行。比较“abc 后的位置”和“新空行开头”。

| 文档  | 行 / 换行节点名 | 旧行末尾等价于新行开头 | 反向比较 |
| ----- | --------------- | ---------------------- | -------- |
| HTML  | DIV / BR        | false                  | false    |
| XHTML | div / br        | true                   | true     |

这表明相同依赖函数在 XHTML DOM 中会越过应当保留的行边界。结合 `updateSelection` 的跳过条件，可以解释“模型已增加新行，而浏览器光标留在上一行”的机制，也符合“重开后旧行可编辑”的现象。

**证据边界：** 这是使用 linkedom DOM 与真实依赖函数的确定性实验，尚未记录运行中 Zotero 的 `contentType`、实际 `.cm-line.nodeName`、原生 Selection 和 CodeMirror selection 的分歧。因此它是高置信首要根因线索，不应写成已在真实宿主完成修复验证。

## 6. 发现二：中文组合期的旧正文回填竞态

### 6.1 当前时序缺口

[详情页 updateListener](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-window.ts:511) 在 docChanged 时更新 localContent，但组合态下不调用 scheduleSave。这里 scheduleSave 实际先做的是内存 `session.edit`，不是直接同步写入磁盘。因此暂停它同时也暂停了“最新输入进入共享会话”。

[会话通知回调](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-window.ts:579) 对比 localContent 和 snapshot.content，不同就调用 hydrate，没有避开当前视图拥有的组合输入。

[flushDraft](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-session.ts:352) 在异步存储返回后仍 publish。[poll](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-session.ts:395) 虽在开始时检查 composing，但异步读取开始后再进入组合态，返回路径没有完整的二次检查。[保存处理](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-session.ts:647) 同样存在等待期间进入组合态的窗口。

```text
T0 会话正文为 base!，一个草稿写入或轮询已开始
T1 详情页开始中文组合，会话标记 composing
T2 CodeMirror / localContent 为 base!你，会话正文仍为 base!
T3 T0 的异步操作返回并 publish
T4 详情页发现两份正文不同，整篇回填 base!
T5 正在输入的“你”被覆盖，原生组合输入所依赖的 DOM 也受到干扰
```

### 6.2 本轮确定性复现

使用真实 `acquireEditorSession`，通过内存 adapter 和可控 Promise 延后写入返回；模拟详情页现有内容对比及 hydrate 回调，使用真实 EditorState 保存正文。

| 路径                                 | 异步返回前 | 返回后正文 | 组合期覆盖次数 |
| ------------------------------------ | ---------- | ---------- | -------------- |
| 详情页现有接入方式                   | base!你    | base!      | 1              |
| 普通小卡接入方式，组合期间也更新会话 | base!你    | base!你    | 0              |

另一个独立实验先启动真实 session.poll，再开始组合输入并让 readDisk 返回；即使磁盘内容没有变化，旧快照通知仍使模拟详情页丢掉组合输入，覆盖次数为 1。

这确认问题不仅依赖 Obsidian 响应，也可以由本地草稿写入或无正文变化的轮询完成触发。不是只有“两个软件同时编辑”才会发生。

### 6.3 compositionend 也有需要验证的时序

[详情页 compositionend 回调](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-window.ts:748) 立即从 `editor.state.doc` 读取提交内容。锁定依赖的 [compositionend 处理](/Users/yuke/Desktop/code/zotero-obsidian-bridge/node_modules/@codemirror/view/dist/index.js:5327) 在发现未处理 DOM 记录时，会安排微任务执行 observer.flush。

因此原生 compositionend 到达不必然表示 CodeMirror 文档已纳入最终候选词。是否在当前 macOS/Zotero 版本读到了旧状态，需要事件轨迹确认；本轮不将该项标成已复现的系统输入法缺陷。

## 7. 发现三：整篇回填会把光标映射到开头

[hydrate](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/editor-window.ts:558) 使用 `from: 0, to: doc.length, insert: content.markdown`，没有提供保留选区策略，也没有区分“仅标题变动”与“正文变动”。

用真实 EditorState，初始文档为 `alpha\nbeta\ngamma`，光标位置为 8：

| 全篇替换内容      | 替换后光标 |
| ----------------- | ---------- |
| 完全相同的正文    | 0          |
| 仅 beta 改为 BETA | 0          |

这里不是浏览器视觉估计，而是 CodeMirror 状态中的实际 selection。现有回调通常会跳过完全相同的内容，但只要标题不同也会触发整篇 hydrate，正文即使相同也会重置选区。

此外，该函数没有 `try/finally` 复位 hydrating。一旦 dispatch 抛错，后续本地更新可能长期被当作回填过程而跳过。这是静态审查发现的附加风险，本轮未在宿主触发。

## 8. 发现四：补全更新生命周期风险

[双链补全 ViewPlugin.update](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/services/codemirror-wiki-completion.ts:291) 在离开双链上下文时调用 closeCompletion。如果补全仍活跃，该函数会 dispatch，而此时 CodeMirror 正在更新视图插件，不允许嵌套 EditorView.update。

本轮内存实验结果：

- 移动光标离开、无 userEvent 的全文替换、普通换行事务中，补全可能已经由状态层关闭，此时 closeCompletion 不 dispatch，没有嵌套错误。
- 补全处于 pending、输入换行并带 `input.type` userEvent 的事务中，实际扩展回调尝试嵌套 dispatch，可复现更新生命周期冲突。

因此不能把“update 中每次关闭补全都会报错”作为结论。还应注意依赖会捕获 ViewPlugin.update 异常并停用该插件，核心文档更新可能继续，不应把这个条件性问题夸大成所有换行和 IME 失效的唯一原因。

另一个审查点：自定义处理主要检查 `view.composing`，而锁定依赖说明该属性在组合输入至少发生一次文档变更后才为 true；`compositionStarted` 表示更早的组合开始状态。后续需检查组合初期和结束边界，避免补全接受/关闭抢走 IME 的 Enter/Escape。当前没有发现项目代码普遍拦截普通 Space 或数字键的证据。

## 9. 已排除和不能贸然下结论的方向

1. **并非每次会话通知都重写 contentEditable。** 已有 [setEditorInputEnabled](/Users/yuke/Desktop/code/zotero-obsidian-bridge/src/adapters/editor-input-state.ts:1) 同值保护，不能重复归因于先前已修的无条件赋值。但跨视图启停仍宜由 CodeMirror 配置管理。
2. **并非 Markdown 格式化必然吞掉末尾空行。** 对空正文、单独换行、`x\n`、`x\n\n`、三行英文和中文末尾换行执行真实 read/replace 往返，全部逐字符一致。
3. **并非普通 session.edit 必然造成 Enter 跳回。** 使用真实 EditorState 和会话，连续插入五个换行、每次同步内存正文，最终光标从 4 到 9，hydrate 次数为 0。
4. **不能靠延长 debounce 解决。** 它可能改变竞态发生概率，不能恢复正确的 DOM 行边界和正文所有权。
5. **不能以截图或程序派发 composition 事件替代系统输入法验收。** 本轮没有完成后者。

## 10. 推荐解决方案

以下均为下一轮拟实施内容，本轮没有修改。

### S0：冻结基线并建立可判定的诊断

先记录 XPI 哈希、运行时包版本、Zotero/Gecko/macOS 版本和系统输入法。真实宿主中采集：

- document.contentType、根节点命名空间、`.cm-line` 与 `<br>` 的 nodeName/localName。
- Enter 前后 CodeMirror 文档长度、行数、selection.anchor/head 和 DOM Selection 的节点类型/偏移。
- beforeinput/input 的 inputType、compositionstart/update/end、keydown 的 isComposing/key/code。
- 会话 revision、compositionOwner、通知来源、hydrate 原因及事务类型。
- completion 状态和 CodeMirror exceptionSink 报错。

诊断采用显式开启、有限环形缓冲区，不记录正文、候选词、路径全名或其他私人内容；异常信息须脱敏。事件记录本身不得 dispatch、改焦点、读写真实队列或改选区。

判定分支：

| 实际轨迹                                           | 优先处理                         |
| -------------------------------------------------- | -------------------------------- |
| 模型选区已进入新行，DOM 选区未移动，且没有 hydrate | DOM 等价判断 / XHTML 宿主        |
| 新输入后发生旧快照 hydrate，正文回退               | 会话组合态与回填协议             |
| compositionend 先读旧模型，稍后才出现最终输入事务  | IME 提交与 CodeMirror flush 时序 |
| 补全插件出现嵌套更新异常                           | 补全生命周期                     |

### S1：让 CodeMirror 工作在真正的 HTML 文档中

推荐优先验证将详情编辑器主体迁移到本地 `text/html` 页面，而不是继续让编辑器依赖 XML 节点名语义。仅改文件后缀、去掉前缀或补 DOCTYPE 都不算成功，必须验证实际 contentType 和节点名。

执行步骤：

1. 在 C 隔离环境先验证最小 HTML 宿主，只挂 basicSetup，不接同步、补全、预览或真实笔记，复测换行和中文。
2. 优先评估独立本地 HTML 窗口能否保留现有 window.arguments、桥接参数、窗口关闭和会话租约。
3. 若 Zotero chrome 窗口必须保留 XHTML 外壳，则使用固定本地 HTML 子文档承载编辑器，并在该子文档自己的全局上下文加载 CodeMirror。
4. 外壳通过窄接口传入会话和操作能力，明确 ready、checkpoint、close、dispose 责任；不能让两个文档各自释放同一租约。
5. 外壳方案须验证 Cmd+W、焦点、剪贴板、IME 候选窗定位、补全浮层坐标、窗口缩放、预览资源回收和待建卡交接。
6. 只允许固定本地资源获得桥接能力，不允许任意导航或笔记 HTML 访问特权接口；保持预览清洗与资源权限限制。

不推荐全局修改 Node.nodeName、不推荐 monkey patch DOM 原型，也不推荐手动维护一套“每按 Enter 就强制挪光标”的补丁。这些方法容易破坏 IME、多光标、列表缩进和鼠标选择。

如确实选择依赖级修补，须成为可审计、锁定版本、带 XML/HTML 全套测试的显式补丁；不能直接改 node_modules 后交付。宿主迁移是否足够，仍须由真实 Gecko 回归决定。

### S2：分开“即时内存编辑”和“异步持久化”

应当保持：用户输入立即更新本窗口和会话内存；磁盘草稿、Obsidian 请求、ACK 只在后台推进，不能成为前台输入前提。

执行步骤：

1. 把 scheduleSave 中的内存 session.edit 与保存调度职责拆清。详情页每个真实 docChanged 都向会话提交最新内容，包括拥有者的组合期事务。
2. 组合期继续禁止提交半成品到 Obsidian，但不能让会话正文停在旧版本；是否把半成品作为本地恢复检查点，应明确记录为未提交组合态，不冒充正常完成保存。
3. 会话通知区分正文变化、来源变化、状态变化，携带 originViewID、内容 revision 和操作 generation；纯保存状态变化不触发正文回填。
4. 当前视图的确认回声不 dispatch；外部正文更新与本地新编辑并发时进入现有冲突/待合并流程，不用旧内容覆盖拥有者。
5. poll/save/flush 在 await 返回后复查处置状态、组合所有权及内容版本。不能简单丢弃 ACK：合法 ACK 仍需推进其对应 baseline，但不能回退最新正文。
6. 保留已有“晚到 ACK 后继续保存新版本”和幂等建卡语义，不生成重复请求或重复卡片。

### S3：正确处理中文组合生命周期

1. 统一原生组合事件、CodeMirror compositionStarted/composing 与会话 owner 的职责，避免多个布尔值互相覆盖。
2. 组合拥有者编辑期间，禁止状态通知整篇 hydrate、替换编辑 DOM、抢焦点或无意义切换 editable。
3. compositionend 不直接假设模型已最终提交。以 CodeMirror 最终事务为依据收束会话，配合版本/生命周期校验；不能仅靠一个固定延时猜测输入法完成。
4. 候选列表打开时，中文输入法的空格、数字、Enter、Escape 应优先遵循原生组合输入语义；鼠标选词不被双链候选监听吞掉。
5. 组合结束只提交一份最终文本，不丢最后一个字、不重复追加，也不把拼音中间态当作最终内容。
6. 两视图同时打开时，仅拥有者可修改；另一视图只读状态由 CodeMirror editable/readOnly 的配置机制维护。标题输入框的组合态也纳入检查。
7. 关闭窗口时先结束或安全保全组合，再检查点和释放会话；失败时保留窗口及可恢复正文。

### S4：避免破坏光标和撤销历史的回填

1. 标题和正文独立比较。只有标题变化时，不 dispatch 文档变更。
2. 同一正文版本不重复回填；源高亮信息或保存状态变动只刷新对应区域。
3. 合法外部正文更新使用明确的最小 ChangeSet，映射选区并保留方向、必要的滚动位置；不能把所有更新表示成全篇替换。
4. 外部更新标记 origin，不被本地 updateListener 再次保存；正常外部确认不污染用户撤销历史。显式“恢复副本/选择版本”的历史策略另行定义。
5. hydrate 防护必须 try/finally 复位，窗口已关闭或会话已 disposed 的晚到通知不可再编辑视图。
6. 不在每次输入之后强制 editor.focus 或手工重设 selection，以免与鼠标、系统 IME 和辅助功能争夺控制权。

### S5：修正补全生命周期，保留已通过的点选行为

优先让补全状态随同一个 transaction 合法关闭；若确需延后执行，应在更新结束后调度，并检查视图存活、generation、当前上下文和最新 completion 状态。不要在 ViewPlugin.update 内同步 dispatch，也不要使用无版本保护的 setTimeout。

保留已通过的完整路径插入、别名、替换范围校验、用户点选和 stale-response 防护。回归时必须包括 `[[bay]]` 鼠标点选，并确认中文组合期间不会误接受双链候选。

### S6：补充测试，再安装唯一候选包验收

拟涉及的边界包括 editor-window、editor-session、CodeMirror 补全适配器、HTML/XHTML 宿主与两个打开窗口入口。仅在必要时新增小型编辑器同步适配层，不改正文格式、卡片 ID、配对协议或旧卡迁移。

先做模块级修复并用确定性测试证明，再构建一次候选 XPI、记录唯一哈希、安装到 C 隔离 profile。分阶段回归，避免同时修改 DOM 宿主、会话、补全后无法判断哪项生效。

## 11. 本轮已执行检查及结果

| 检查                                  | 结果                             | 不能替代什么                                         |
| ------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| node scripts/test-editor-session.mjs  | 通过                             | 不包含真实 EditorView DOM 或系统 IME                 |
| node scripts/test-c3-c4-ui.mjs        | 通过                             | linkedom 的渲染/textarea 范围测试不是 Gecko 输入测试 |
| node scripts/test-wiki-completion.mjs | 通过                             | 解析及 generation 测试不是真实选区测试               |
| HTML/XHTML 等价选区函数对照           | XHTML 跨行错误等价可复现         | 仍须采集 Zotero 实际节点与选区                       |
| 异步草稿完成 + 中文组合               | 模拟详情页丢字；普通小卡方式不丢 | 不代表真实系统候选窗口已复测                         |
| 开始轮询后进入组合态                  | 旧通知覆盖模拟输入可复现         | 不证明每次丢字都由轮询触发                           |
| 全文替换后的 selection                | 8 → 0，可复现                    | 不表示正常输入必然执行 hydrate                       |
| 补全生命周期对照                      | 特定 input.type 事务尝试嵌套更新 | 普通离开上下文并非全部出错                           |
| 正文换行读写往返                      | 6 类输入逐字符一致               | 不覆盖全部旧格式和任意复杂正文                       |
| 五次正常换行 + 内存会话回声           | 光标正确，零 hydrate             | 不覆盖浏览器 DOM Selection                           |

内存实验通过标准输入运行，没有新建测试脚本或写真实 adapter 数据。后续实施时应把有效复现转成仓库中的持久回归测试，而不是仅保留本报告结果。

## 12. 修复后的验收矩阵

所有写入仅在 C 隔离环境、专用临时卡片进行。先保存基线和哈希，失败后停止破坏性按键测试并保留现场，不尝试在主库复现。

| 编号 | 场景                                           | 通过条件                                                 |
| ---- | ---------------------------------------------- | -------------------------------------------------------- |
| V01  | 行首、行中、行尾 Enter，连续空行，空文档 Enter | 行数正确，模型与 DOM 光标同步，后续字符在预期位置        |
| V02  | 点击新空行、箭头上下移动、Home/End、全选替换   | 无跳回、无倒序、无幽灵文字                               |
| V03  | 普通空格、自动折行、Shift+Enter、列表缩进      | 不混淆视觉折行与硬换行，行为符合编辑器规则               |
| V04  | macOS 简体拼音连续输入一整句                   | 空格、数字、鼠标三种选词均能提交，零丢字、重复或拼音泄漏 |
| V05  | 中文组合期间注入可控 draft/poll/save/ACK 返回  | 正文及组合 DOM 不被旧状态覆盖；最终正文完整              |
| V06  | 组合期双链补全待响应、已显示、被取消           | IME 按键优先；组合完成后候选仍可正常使用                 |
| V07  | 已保存卡、未建卡、Obsidian 离线及恢复          | 都可先本地编辑；晚到 ACK 不回退，最终只生成一张卡        |
| V08  | 普通小卡与详情页同时打开                       | 最新正文一致；组合拥有者不被另一视图抢写                 |
| V09  | 本地编辑与 Obsidian 外部编辑并发               | 按现有冲突规则保全版本，不静默覆盖                       |
| V10  | 仅标题规范化、纯状态通知、源高亮颜色更新       | 正文事务与选区不变，不能触发整篇 hydrate                 |
| V11  | Backspace、实体 Delete、撤销/重做              | 只编辑正文，不删除来源高亮；撤销粒度合理                 |
| V12  | Cmd+W/Close、关闭后晚到通知、再次展开          | 检查点正确，无 disposed 错误，无遗失正文                 |
| V13  | [[bay]] 点选、别名、标题/块链接、普通英文      | 完整链接正确，已通过的候选功能不回归                     |
| V14  | 预览公式/图片/链接、缩放、分隔拖动             | 正文不被重建，焦点及候选浮层位置正常                     |

数量与记录要求：

- 核心换行、点击新行继续输入场景各重复 20 次，零异常；至少覆盖“新建空行”和“重开后既有空行”。
- 三种中文选词方式各做 10 次，组合期间穿插可控异步回调；另做一段至少 100 个中文字符的混合标点输入。
- 离线/恢复与晚到 ACK 至少各 5 个完整周期；重开详情页至少 20 次。
- 组合时序实验应使用可控 Promise/屏障，不靠偶然等待命中；真实系统输入法和程序级事务测试分别记录。
- 验证正文逐字符一致，包括末尾空行；检查本地恢复内容和最终 Vault 内容，不只看 Saved 标签。
- CodeMirror 异常、嵌套更新、未处理 Promise、session disposed 均为 0。
- 保存候选 XPI 哈希、宿主版本、场景编号、日志摘要及结果。任何失败不得用其他场景通过抵消。

## 13. 修复顺序、风险与收尾条件

推荐顺序：S0 诊断 → S1 最小 HTML 宿主对照 → S2/S3 会话与 IME → S4 选区安全 → S5 补全生命周期 → S6 全量隔离回归。

若 S0 显示实际详情页已是 HTML 且节点为大写，应降低 XHTML 假设优先级，转查真实 selection/hydrate 轨迹；不为迎合本报告而强行迁移宿主。

HTML 宿主迁移主要风险在特权桥接、窗口生命周期、浮层坐标和样式资源，不应借此替换同步协议。会话修复主要风险在 ACK 的 baseline 推进与冲突处理，不能为了防回填而彻底停止处理外部更改。组合态保护不能仅靠锁死其他视图而忽视当前窗口的未提交内容。

完成条件：已确认的竞态和选区复现先变成自动化回归；真实 C 隔离宿主的 V01-V14 在同一候选包通过；用户所述原始操作路径重新验证；再更新阶段验收记录。未满足前，保持“详情页输入回归未关闭”，不能据此进入最终发布。

## 14. 资料与证据使用说明

- CodeMirror 文档站本轮访问返回 403，没有把它作为已成功读取的依据。API 语义以本地依赖的声明和实现为准：[组合状态与 contentDOM 契约](/Users/yuke/Desktop/code/zotero-obsidian-bridge/node_modules/@codemirror/view/dist/index.d.ts:772)。
- 依赖源码的上游对照：[DOM 选区辅助函数](https://github.com/codemirror/view/blob/main/src/dom.ts)、[DOM 变更处理](https://github.com/codemirror/view/blob/main/src/domchange.ts)。上游 main 可能变化，本报告具体行号及复现基于本地 6.43.15。
- 旧宿主修复背景：[C0-C2 Host Follow-Up](/Users/yuke/Desktop/code/zotero-obsidian-bridge/docs/c0-c2-host-follow-up-2026-11-06.md:1)。本报告不否认旧测试观察，但明确要求重新打开本轮发现的输入回归。

**最终状态：检查及方案报告完成；修复未实施；真实宿主新一轮输入验收未执行。**
