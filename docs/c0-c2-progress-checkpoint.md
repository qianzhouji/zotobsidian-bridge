# C0-C2 暂停检查点

## 最新恢复与验收（2026-11-06 14:44）

任务已恢复，Computer Use 已可用。展开窗的光标倒序、旧正文覆盖、虚假冲突与关闭时 session disposed 已修复；待建卡/正式卡输入、Backspace、Cmd+W、草稿重启恢复、晚到建卡交接、最终包 20 次展开关闭及多项双链/权限/读写隔离现场验证已通过。

原生 Obsidian 对照已完成：已有笔记的 wiki/别名/Markdown 链接、嵌套标题、块引用、同笔记标题及重名文件目标与 Bridge 一致。原生遇到重复标题选第一个、缺失标题仍打开文件；Bridge 保守返回 `ambiguous` / `missing`，这两项不是完全相同行为。38 个 Vault 内容文件前后哈希一致，未创建缺失笔记，主库未操作。

Reader 源码完整 Cmd-click 矩阵、未同步本地标题、代码/注释/转义排除及双 Reader 同时首卡编辑已补测通过。两份离线草稿分别关闭重开并二次编辑，恢复 C Obsidian 后唯一落入 `P01N07` / `P02N05`，无串卡，队列与草稿清空。同时修复待回执保存使用沙箱缺失的 `structuredClone` 导致草稿保存失败的问题；当前 C XPI 为 `7975d1e3...`，companion 未变。

最终候选包已补测实际 Zotero 客户端查询、受控在途旧配对代次拒绝，以及已有卡和待建卡的离线草稿、重启、晚到回执和窗口开关；两张卡各唯一落盘，队列与草稿清空。

Reader 小卡公式样式已修复，隔离宿主中上标、分数和下标通过定向视觉复测。当前修复包为 `f8088fde...`，先前完整补测使用 `7975d1e3...`；尚未在新包重跑全部矩阵。

**C0-C2 仍非全量验收完成。** 依赖 C3-C5 的子卡 UI 尚未实现和验收。最新包、故障注入边界和证据见 [11 月 6 日宿主补充报告](c0-c2-host-follow-up-2026-11-06.md)。下文保留为历史快照，不再代表当前工具或进程状态。未提交、未推送、未发布，主库未修改。

更新时间：2026-11-05 17:29（Asia/Shanghai）。最新版 C 隔离包下，Reader 与展开编辑器的开关、编辑/预览、Native/Bridge 模式切换、两条批注来源切换及原生上下文菜单均通过；正向 Bridge 截图已保存。用户确认新高亮首次点击立即显示 Bridge，建卡期间输入的文字得到保留；只读检查确认测试文字已写入对应 Markdown 卡。未触碰主库。

## 当前结论

**C0-C2 不能标记全部验收完成。** 只读服务、链接解析和编辑器导航接入已有实现，自动化及真实 Obsidian 文件通道测试通过；C0 真实宿主浮层交互、C2 两种 Zotero 编辑器的完整现场点击矩阵仍未完成。C3-C7 未开发。

B4 保存失败恢复验收继续按用户要求延后；B5 真实双应用验收以及历史 R 阶段待验项均未被本轮关闭。

## 隔离环境与包

仓库：`/Users/yuke/Desktop/code/zotero-obsidian-bridge`。

| 用途                 | 相对仓库路径                         |
| -------------------- | ------------------------------------ |
| Zotero profile       | `.scaffold/c-profile`                |
| Zotero 数据库        | `.scaffold/c-data`                   |
| Obsidian Vault       | `.scaffold/c-vault`                  |
| Obsidian 应用配置    | `.scaffold/c-obsidian-profile`       |
| 独立队列             | `.scaffold/c-queue`                  |
| 安装清单             | `.scaffold/c-host-manifest.json`     |
| 最后一次真实读取证据 | `.scaffold/c-live-query-report.json` |

最近重启 PID：Zotero `55741`、Obsidian `55742`。进程参数证明仅为 C 隔离路径；Zotero `extensions.json` 显示永久 ID `active=true`、`userDisabled=false`，`prefs.js` 的 `readerMode=bridge`。

- 当前 Zotero XPI SHA-256：`881a561062beb8fd5f9413c974e1718f50dc0d5de538c45825bca8515fc0f1e3`，与安装包一致。
- 当前 companion `main.js` SHA-256：`ddb1e42d3b45f4a729768af34f4006c103e533b18102e192b6e29d8c6d2c410f`。
- 刷新前包的备份：`.scaffold/c-install-backups/1793847070332`。
- 本轮未修改主 Zotero profile、主文库或 Main_Learning；未自动关闭主应用。

## 本轮完成

1. 重开 C 系列两端，按精确启动参数检查进程，替换并重启的只有 C 隔离实例。
2. 修复冷启动锚点问题。旧实现只有在 `metadataCache.changed` 后才记录正文版本，导致已有笔记重启后一直返回 `indexing`。现在按需读取已保存正文，用 Markdown 解析器校验已有标题和块的位置；校验通过才将导航元数据绑定到当前内容哈希。陈旧位置、缺失或新增标题/块不会直接被信任。
3. 标题匹配在真实 companion 中调用公共 `resolveSubpath`；重复标题仍返回 `ambiguous`，不任意选择一个。
4. 补齐 `Bridge Recovery` 目录的读取排除，增加搜索游标安全整数检查。
5. 加入精确路径限定的 `scripts/refresh-c-host.mjs`。它先备份隔离包，再停止精确匹配的 C 进程；退出失败就拒绝安装，不强制杀进程。不是通用主库安装脚本。
6. 加强真实查询脚本：明确断言标题/块找到、重复标题歧义、锚点缺失，而非仅检查 `status=ok`；记录文件前后哈希和 100 次查询延迟。

## 已运行验证

| 验证                                  | 结果与边界                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                       | 通过；Zotero 构建和 TypeScript 检查                                                                                                         |
| `npm run build:obsidian`              | 通过                                                                                                                                        |
| `npm run test:note-query`             | 通过；10,004 条索引记录只初始化一次、增量更新、四种接口、安全负例、陈旧索引、100 次取消/超时清理、写队列命名空间隔离                        |
| `npm run test:note-links`             | 通过；链接语法、源区间、代码/注释排除、当前未保存正文锚点                                                                                   |
| `npm run test:note-navigation`        | 通过；DOM 事件/销毁/迟到响应；不是真实鼠标验收                                                                                              |
| `npm run test:b5-recovery`            | 通过；自动化，不关闭 B4/B5 现场待验项                                                                                                       |
| `npm run test:card-markdown-preview`  | 通过                                                                                                                                        |
| `npm run test:reader-popup-prototype` | 通过；组件测试，不等于 C0 真实交互                                                                                                          |
| `npm run test:pending-card-drafts`    | 通过；新高亮即时可编辑壳、晚到 ACK、草稿落盘/重开、模拟重启、写盘失败与重试                                                                 |
| `npm run test:companion-r3`           | 通过；现有写入、ACK、冲突/恢复、编辑等待等回归                                                                                              |
| C 系列改动的定向 ESLint               | 通过                                                                                                                                        |
| `npm run lint:check`                  | Prettier 全量通过；ESLint 仍被既有 `scripts/create-b0-preview-vault.mjs` 第 40/42 行不规则空格、第 52 行未声明 `process` 阻塞，未改动该文件 |

真实 Obsidian 验证时间：`2026-11-05T00:55:11.095Z`。调用方为 Node 文件通道客户端，服务方为真实运行的 C companion；**不是 Zotero UI 端到端测试**。

- 别名搜索、两个目录中同名 `Shared` 的源目录解析、`../` 相对链接、Markdown 读取和 PNG 读取通过。
- `Posterior#Worked example` 与 `^bayes-rule` 返回 `found`；重复 `Example` 返回 `ambiguous`；不存在的标题返回 `missing`。
- 不存在的文件返回 `not-found`，不创建笔记。
- 8 个 Markdown 文件和 1 张图片前后内容一致；聚合 SHA-256：`496a6a98722e3af76bca86b6e8fb3fcbf9fb912e7472ca5b8b5de95223a5ec8e`。
- 100 次顺序热索引搜索：p50 `43.95 ms`，p95 `86.36 ms`，最大 `95.81 ms`。本地磁盘、8 笔记真实 Vault，不含 UI 渲染；不能冒充 1 万笔记宿主性能或云盘成绩。

## 已知限制与剩余验收

- **C0 根卡浮层及新高亮即时 Bridge 已通过核心现场复验，阶段出口仍待后续子卡实现**：早期截图显示原生评论框；刷新隔离包后 Bridge 卡正常显示。Reader 与展开编辑器分别完成 20 次开关，编辑/预览切换、Native/Bridge 回退、两条批注来源切换及原生上下文菜单均正常。只读 API 核实 `8RV5FHQ5`/页标 `i` 对应 `P01N01.md`，`P8EL8G4E`/页标 `2` 对应 `P02N01.md`。正向截图保存在 `.scaffold/c-evidence/c0-bridge-card.png`，SHA-256 `27fab155608610fcb5438b15947a6fb91ebc1bed1ca8f60be2a3339cc24563c0`。早期新高亮首次点击先显示原生框、稍后才出现 Bridge；代码确认旧流程需等批注保存、串行建卡和 companion 回执。新实现已在批注 ID 稳定后立即显示可编辑 `creating` Bridge 壳，Zotero 本地草稿在 ACK 后交给正式编辑会话；延迟 ACK、关闭重开、写盘失败及并发新草稿保护的自动化通过。用户在 C 隔离 Reader 确认新高亮首次点击立即显示 Bridge，编辑输入保留；只读核查新批注 `GD5RJHP4` 对应 `P02N04.md`，正文 `My notes` 中保留 `test`。离线/重启及双 Reader 并发现场复验仍待完成。路线要求的多窗口子卡交互需等待 C3-C5 实现后再验；不得提前宣称 C0 完整结束。
- **C1 仍欠 Zotero 端真实客户端联调**：已通过真实 companion 文件通道测试，不能当成 Zotero 窗口内查询、权限切换和读写同时进行的现场证据。
- **C2 仍欠 Reader/展开窗真实点击与 Cmd+点击矩阵**，以及全部支持语法逐项对照原生 Obsidian 的现场验证。
- 冷启动验证采用保守策略：不能证明与当前正文一致的复杂块结构/缓存返回定位暂不可用。独立块 ID、复杂列表/表格块等冷启动兼容需扩充夹具，不能宣称任意 Obsidian 语法完全兼容。
- 当前链接点击只解析目标并发出 `zob-note-link-resolved`，不弹出正式知识子卡。补全属于 C3，知识卡/连线属于 C4-C5。
- 当前会话没有可用桌面点击/截图工具；停止反复尝试窗口坐标定位。恢复后先检查工具是否恢复；否则只继续可验证的代码/接口工作，并单列人工 UI 待验项。
- C1 协议、C2 链接支持表和阶段执行报告已整理：`docs/note-query-protocol.md`、`docs/note-link-support.md`、`docs/c0-c2-execution-report.md`。此文件仍作为统一检查点。

## 恢复后的继续验收（2026-11-05）

### 隔离 Reader 夹具

- C Zotero API 端口 `23127` 对应 `.scaffold/c-data`，运行进程仍使用 `.scaffold/c-profile` 与 `.scaffold/c-data`；隔离 Obsidian PID `31344` 使用 `.scaffold/c-obsidian-profile` 与 `.scaffold/c-vault`。
- 已生成两页纯合成 PDF `.scaffold/c-reader-fixture.pdf`，PDF 标签为第 1 页 `i`、第 2 页 `2`，文件 SHA-256：`be69af29c2818648c647fccc19cee841ee69114f6d97d024e6032122ef19966c`。
- Zotero 10.0.7 的 Connector 源码确认 `/connector/saveAttachment` 要求有效非空 URL；首轮脚本传空 URL，创建了无附件的合成父条目 `3J4WV4ZP`。未重试相同创建、未删除该条目。
- 修正为 `/connector/saveStandaloneAttachment` 后，Zotero 自动识别合成 PDF 并生成文献父条目 `A3DDKUFD` 与 PDF 附件 `IYE76ATZ`。通过本地 API 的 `302 file://` 位置在 C 数据目录内做路径约束并核对磁盘文件哈希，结果与源 PDF 完全一致。证据：`.scaffold/c-reader-fixture-import.json`。
- 该夹具已用于真实 Reader 点击。首次结果为原生评论弹窗；刷新 C 隔离包后，用户对同一来源 `8RV5FHQ5` 复测确认 Bridge 卡显示，并报告 Reader 与展开编辑器分别 20 次打开/关闭正常、展开编辑器编辑/预览切换正常、Native/Bridge 模式切换可恢复各自弹窗。随后在第二条高亮 `P8EL8G4E` 与原高亮间切换，用户确认正常且无残留；只读 API 确认两张卡来源 ID 各自匹配。用户确认原生上下文菜单正常；正向截图及 SHA-256 见上。多窗口子卡交互待 C3-C5 实现后验收。

### C1 租约修复与真实 companion 复验

- 故障定位：隔离 Obsidian 后台时，Electron 将定时器节流到约每 60 秒执行一次；原能力租约仅 30 秒，产生间歇性过期窗口。客户端按设计拒绝过期能力文件，显示 `offline`，不是 Markdown 查询或锚点解析错误。
- 修复：新增独立 `NOTE_QUERY_CAPABILITIES_TTL = 120000`，只延长 companion 能力公告租约；单次查询请求上限仍为 30 秒，默认请求时限仍为 3 秒。增加 60 秒后台节流有效、超过 120 秒失效、不可超长签发的回归断言。
- 只刷新 C 隔离 Obsidian companion，未重启 Zotero。原 `main.js` 备份位于 `.scaffold/c-install-backups/1793843498032-obsidian-refresh/`。新 companion SHA-256：`ddb1e42d3b45f4a729768af34f4006c103e533b18102e192b6e29d8c6d2c410f`。
- 修复后额外监测 70 秒：后台能力心跳约在第 60 秒续期，120 秒租约始终有效；随即再次通过 100 次 live-query。最新报告：`.scaffold/c-live-query-report.json`，时间 `2026-11-05T02:19:45.838Z`。别名、同名/相对路径、标题/块锚点、歧义/缺失锚点、Markdown 与 PNG 读取及缺失文件不创建均通过；9 个 Vault 内容文件前后哈希一致，聚合 SHA-256 `496a6a98722e3af76bca86b6e8fb3fcbf9fb912e7472ca5b8b5de95223a5ec8e`。100 次顺序热查询 p50 `44.85 ms`、p95 `85.59 ms`、max `87.58 ms`。
- 这项是真实 Obsidian 插件服务与本机文件队列测试，不是 Zotero XPI 调用 companion 的 Reader 界面端到端验收；后者仍待现场操作。

### 本轮验证

| 验证                                  | 结果                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `npm run build`                       | 通过                                                           |
| `npm run build:obsidian`              | 通过                                                           |
| `npm run test:note-query`             | 通过；含 10,004 条索引、安全、锚点、取消/超时和新租约边界      |
| `npm run test:note-links`             | 通过；语法/上下文矩阵、源码区间、URL 安全                      |
| `npm run test:note-navigation`        | 通过；DOM 路由测试；真实 Reader 20 次交互未执行                |
| `npm run test:reader-popup-prototype` | 通过；原生保留、模式切换、重试、关闭恢复等组件级回归           |
| `npm run test:companion-protocol`     | 通过                                                           |
| `npm run test:companion-safety`       | 通过                                                           |
| `npm run test:companion-ownership`    | 通过                                                           |
| `npm run test:companion-r3`           | 通过；写入兼容、ACK、冲突/恢复及单所有者回归                   |
| C Reader 夹具校验脚本                 | 通过；限定隔离 profile/data，附件路径在 C storage 内，哈希吻合 |
| C companion 100 次 live query         | 通过；仅文件通道，不含 UI 渲染                                 |

`npm run lint:check` 的 Prettier 全量检查通过；随后 ESLint 被既有 `scripts/create-b0-preview-vault.mjs` 第 40/42 行不规则空格及第 52 行未声明 `process` 阻塞。定向 ESLint/Prettier 对本轮 C 源码与脚本通过。

### 当前结论

- C1 的只读协议/服务及真实 companion 文件通道复验通过；Zotero Reader 内实际搜索/解析调用仍未验收。
- C0 Reader 首次 Bridge takeover、20 次 Reader 开关、20 次展开编辑器开关、编辑/预览切换、Native/Bridge 回退、两条批注间来源切换、原生上下文菜单及正向截图已通过；路线规定的 C3-C5 子卡交互仍待功能实现后验收。
- C2 解析器和导航自动化通过；Reader、展开窗、Cmd+点击及原生 Obsidian 候选/解析行为矩阵仍未验收。
- 当前工具环境没有桌面点击/截图能力，不能代替用户完成以上 GUI 门槛；在此之前 C0-C2 整体不得标记“验收完成”，也不进入依赖 C0 宿主稳定性的后续视觉阶段。

## 下一步与工作区状态

1. C0 当前剩余：等 C3-C5 子卡 UI 完成后，执行路线规定的双窗口子卡交互验收。
2. 如 C 隔离应用退出，用 `node scripts/prepare-c-host.mjs launch` 重开；按精确参数核对路径，不使用主库窗口或主端口。
3. companion 已安装哈希见上。仅源码再次变化且构建通过时，才使用隔离刷新脚本。
4. 如需复测只读通道，执行 `node --experimental-strip-types scripts/check-c-live-queries.mjs`。该脚本只读测试笔记、写 C 只读消息与测试证据，不操作写同步队列。
5. 不具备桌面工具期间，不宣称 C0/C2 宿主 UI 通过。

## Git 与应用状态

当前 HEAD：`2c6d9dc0ea5d8a27f1309bf4d52fb0cfa8b720c6`。源码和文档均保存在本地工作区，尚未创建本轮 commit、未推送 GitHub。

本轮没有创建 commit 或推送。C Zotero 与 C Obsidian 隔离实例仍运行；已启用 companion 会继续刷新能力心跳。主 Zotero、主 Vault 未操作。

## 待创建卡片草稿持久化修复（2026-11-05）

- 定位：卡片创建与 Bridge 编辑器本地草稿本来是两条异步路径。草稿应先落入 Zotero data directory 的 `pending-cards`，之后才在卡片 ACK 到达时交接给正式卡片。此前 UI 会显示“本地草稿保存中”，而 Reader 弹窗销毁不会等待异步 flush 完成；写盘慢或关闭与写入重叠时，用户可能在卡片创建前关闭并误以为内容已保存。不能把 Obsidian 建卡延迟当成草稿持久化成功的证明。
- 修复：pending 草稿仍先写 Zotero 本地存储，不等待 Obsidian；关闭/交接时 flush 会持续等待到最新排队版本完成。卡片随后创建时，启动与定时恢复器会按来源 ID 找回草稿：仅在 card/source 身份匹配且卡片正文为空时自动合并；正文已被独立修改则保留草稿并报告冲突，不覆盖。重复创建请求复用同一 pending create 请求，避免重试生成重复卡。
- pending Bridge 壳已有“展开/收起”入口；离线或创建等待期间也可进入较大编辑面板。Cmd+W 关闭展开面板仍未处理，按用户要求列为低优先级。
- 新增自动回归：写盘延迟期间再输入新版本并触发关闭 flush，确认磁盘保留最新文本；关闭 pending 弹窗后检查 Zotero data 草稿；模拟卡片稍后出现后恢复正文并验证草稿仅在正文确认后删除；并发 Obsidian 修改时保留待恢复草稿。
- 通过：`npm run test:pending-card-drafts`、`npm run test:companion-queue`、`npm run test:reader-popup-prototype`、`npm run test:editor-session`、`npm run smoke:integration`、`npm run build`、`npm run build:obsidian`、TypeScript、定向 ESLint、Prettier 与 `git diff --check`。
- 候选包仅安装到 C 隔离实例；旧包备份于 `.scaffold/c-install-backups/1793880655360`。C Zotero PID `64294`、C Obsidian PID `64295`；新 XPI SHA-256 `1273411be82763a5b19ab72c47be6a53633fb80e293ba0d1204485e74d5fce78`，companion SHA-256 未变：`ddb1e42d3b45f4a729768af34f4006c103e533b18102e192b6e29d8c6d2c410f`。
- **真实宿主待验**：请在 C 隔离 PDF 新建一条临时高亮，立刻打开 pending Bridge、输入唯一标记并关闭弹窗；待 Obsidian 恢复并建卡后，检查同一标记出现在卡片且没有重复卡。需记录草稿实际落盘、恢复耗时和队列最终清空。此前 C-OFFLINE-1105 测试在恢复 Obsidian 后最终进入卡片，但发生在本修复候选包安装前，不能算本版验收。
