# C6 离线缓存、权限失效与资源回收执行报告

日期：2026-11-10
状态：实现和自动化验收完成；真实宿主验收部分进行中。C6-01 的已缓存离线快照显示通过；未缓存目标、恢复收敛及 C6-02–05 尚未验证。
范围：C6-01 至 C6-05。此报告不签收 C5、C7 或 B6。

## 实现摘要

- `src/core/note-query-cache.ts` 提供仅存在于当前 Zotero 进程内的 LRU 缓存：默认估算上限 32 MiB、512 条记录、128 个缓存分区、每篇笔记资源最多 10 MiB、TTL 30 分钟。容量按 JSON/资源字符串等保守估算，不等于 JS 引擎的精确 heap 计量。缓存只接收用户浏览时明确读取的笔记、链接解析结果和白名单本地图片，不预取 Vault，也不落盘；Zotero 进程退出后缓存清空。
- 缓存键隔离 queue partition、Vault ID、pairing epoch、规范化只读目录范围及笔记路径/修订。队列、Vault 或授权范围不同的分区不会互相读取。权限范围变化时淘汰旧分区并通知卡片组关闭。
- `src/adapters/note-query-client.ts` 将成功的链接解析、正文和本地图片响应写入缓存。在线能力文件暂时不可读时，仅使用当前客户端分区最后已授权的身份查找缓存；这只允许读取带过期提示的快照，不授权新的在线查询。明确 disabled、错 Vault、错 epoch 或错范围会清理/拒绝旧缓存。
- 请求开始时捕获 cache generation；权限/分区变化或清空缓存后，迟到响应不再有资格回填缓存或返回为当前查询结果。客户端关闭仍中止在途查询。
- `src/services/knowledge-note-card.ts` 先显示缓存快照，再异步在线解析和重读。界面显示离线快照及读取时间；在线刷新成功后替换快照。无法验证时保留已缓存正文但明确标记过期；没有缓存时显示 Offline/不可用，不伪装成空笔记。
- 在线检测到来源被删除时失效路径缓存并清空卡片；同一双链改为解析到另一文件时清理旧节点并按新身份重开；同路径修订改变时重读正文。修订不一致时旧锚点不用于定位。
- 关联组关闭/授权失效时取消读请求、关闭关系查询客户端、清空 DOM、撤销由预览生成的对象 URL；在线渲染的图片数据不另存一份长期卡片缓存。桌面窗与 overlay 资源使用既有 C5 生命周期接口，C6 自动 UI 回归覆盖组清理，不等同真实桌面宿主矩阵。
- Zotero shutdown 清缓存；queue/Vault 偏好变化清全局缓存。Companion 对授权目录中的修改、移动/重命名、删除继续更新索引；在线卡片重验用解析路径和 revision 识别变化。

## 自动验收

总入口：`npm run test:c6`。

| 用例                     | 覆盖                                                                                                                                         | 结果                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `test:note-query-cache`  | 限额与 LRU、TTL、跨 queue/Vault 分区隔离、epoch/目录范围失效、旧 revision 锚点失效、资源替换回滚、全局清理与迟到查询 generation fence        | PASS                                                                           |
| `test:c6-cache-ui`       | 缓存优先离线显示、可见读取时间/过期提示、本地图片离线渲染、在线重验替换正文、配对 epoch 变化关闭卡组并撤销对象 URL、无缓存离线目标明确不可用 | PASS                                                                           |
| `test:note-query`        | 四类查询、权限、符号链接、协议限额、旧缓存/迟到响应、锚点、写队列隔离、latest-wins、100 次取消/超时清理及 10,004 项索引夹具                  | PASS；本轮往返均值约 58 ms，最大约 88 ms（本机合成测试，不是产品 UI 延迟指标） |
| `test:b5-recovery`       | ACK 校验、离线重试、撤销、错误、checkpoint 失败、分进程恢复                                                                                  | PASS                                                                           |
| `test:companion-safety`  | Companion 路径安全与重试策略                                                                                                                 | PASS                                                                           |
| `npm run build`          | 第三方声明生成、生产 XPI 构建及 `tsc --noEmit`                                                                                               | PASS                                                                           |
| `npm run lint:check`     | 全仓 Prettier 与 ESLint                                                                                                                      | PASS                                                                           |
| `npm run verify:package` | XPI 归档结构与原生 overlay helper 哈希                                                                                                       | PASS；64 个归档条目                                                            |
| `git diff --check`       | 当前差异空白/补丁格式检查                                                                                                                    | PASS                                                                           |

缓存分区测试发现并修复过一个隔离错误：按路径读取最新正文和路径失效扫描起初未同时检查 queue partition，理论上可能在同 Vault/同授权范围的两个队列之间命中同路径数据。现在记录自身保存 partition，并在读取、替换与失效时校验；已加入回归。

新增入口：`npm run test:note-query-cache`、`npm run test:c6-cache-ui`、`npm run test:c6`。首次 lint 揭示新增 UI 测试缺少 `Buffer` 导入和一个未用参数，已修正；随后全仓 Prettier/ESLint、包完整性及差异检查均通过。C4/C5 受影响的只读卡片、卡组、关系图、Markdown 预览和链接解析回归也通过。

## 真实宿主验收记录与待办

本轮精确包已安装到隔离 Zotero：XPI SHA-256 `e3c1cbf971def085a3778dceec9fdce20ddd7302d09ec2d3f1a695448f719a45`；Zotero 启动参数核对为 `.scaffold/c-profile` / `.scaffold/c-data`（PID 73892）。C Vault 为 `.scaffold/c-vault`、独立 Obsidian profile 为 `.scaffold/c-obsidian-profile`，队列为 `.scaffold/c-queue`。已在线读取 `Mathematics/Bayes.md` 与 `Physics/Motion.md`，随后将 C Obsidian 下线，C Zotero 保持运行。

- **C6-01a，PASS：** 离线时 Motion 知识卡仍显示此前缓存的完整只读正文与公式，并明确显示 `Offline cached snapshot · content may be outdated` 及读取时间；Obsidian 打开按钮不可用。没有把离线状态伪装成在线成功。
- **C6-01b，NOT RUN：** 尝试点击 Motion 卡中的未预热 `Shared` 链接后，AX 状态没有变化，未观察到可判定的“未缓存/离线不可用”提示，因此不记为通过。
- **C6-01c，NOT RUN：** 恢复阶段的 Computer Use 重新解析到了 `Main_Learning`，随即停止 Obsidian 界面操作；没有编辑主 Vault。C Vault Companion 的恢复及在线重验收敛未被确认。
- **数据完整性：PASS（哈希核对）：** 操作前后 Bayes、Motion、P02N01 三个 C Vault 文件 SHA-256 不变：分别为 `f4f5ebfe4e1b573bba055bea800c7fd3b6da54c4fe088eabafe2a16fe68b4348`、`d493b82f9aec03086283c63eff623a930b6ff60e1f6f2b72a16e0827a1640702`、`8e6c0d3f8461d4b796ce6f480456f655eee5859bafc317acda4651266aa29773`。此次没有编辑或保存这些笔记。
- **C6-02 至 C6-05，NOT RUN：** 在线编辑/重命名/移动/删除与断线恢复、图片/对象 URL 和桌面 helper 回收、B5 写入 ACK 隔离、错误配对/权限收紧/资源超限安全降级均未做真实宿主验收。

宿主观察基于本轮界面状态，截图没有另存为报告附件；未列为 PASS 的场景不得以自动化覆盖代签。后续继续测试前，必须先可靠确认 Obsidian 窗口使用 `.scaffold/c-obsidian-profile` 与 `.scaffold/c-vault`，不得在 `Main_Learning` 中操作。

宿主实测须记录 Zotero/Obsidian 版本、XPI SHA-256、配对范围、前后文件清单/哈希、操作结果及 C5 overlay/helper 状态。没有这些记录时保持 NOT RUN，不以组件测试代签。

## 退出条件

C6 只有在上述宿主矩阵完成、B5 写入/ACK 未受影响、无跨分区缓存读取和无未回收 UI/原生资源后才能签收。C6-01a 的结果仅证明“已缓存卡片可以显示离线快照”，不代表离线未缓存目标、恢复、权限失效或完整 C6 通过。下一步先恢复并明确核对 C Companion 的隔离窗口，再按 C6-01b、01c、02–05 逐项取证；最终包变化时须重新构建、记录 SHA 并单独安装验证。
