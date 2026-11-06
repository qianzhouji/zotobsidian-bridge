# B2 执行与验收报告

执行日期：2026-10-31
范围：共享编辑会话、独立编辑窗适配、保存/冲突序列化与生命周期测试。

## 结果摘要

- B2 的会话架构和自动化验收已实现。普通保存、冲突解决、恢复写入和外部磁盘轮询共用同一串行队列；会话由 Zotero 主插件上下文持有，并传入独立编辑窗，供后续 Reader 小卡片复用。
- 会话竞态、草稿恢复、延迟加载、迟到保存回执、冲突、缺失卡片保护、多视图、IME 锁和轮询计时器生命周期均有自动化覆盖。
- B2 的真实宿主联调已在独立环境完成：Zotero 使用项目 `.scaffold/profile` 与 `.scaffold/b2-data`，Obsidian 使用 `.scaffold/b2-vault`，companion 使用 `.scaffold/b2-queue`。从 Zotero Reader 打开独立 Markdown 编辑器后，编辑区、Markdown 预览、卡片路径与源信息均正常。
- 卡片在 Obsidian 保持打开时，Zotero 编辑器保存进入 `Waiting for Obsidian`；等待 3.5 秒仍只有一个请求。关闭 Obsidian 卡片标签后，companion 应用写入、Zotero 收到 ACK 并显示 `Saved`；request/response/ACK 队列和编辑草稿均清空，正文只出现一次目标改动。
- 冲突界面真实联调也通过：损坏的隔离测试 source marker 触发安全拒写并保留本地草稿；修复 marker 后显示磁盘版/本地版对照，选择磁盘版后面板隐藏、状态回到 `Saved`。测试卡 marker 已校验各恰好一处。测试过程中生成的 `Bridge Recovery` 备份均保留，未做清理。
- 未编辑 `Main_Learning`、日常 Zotero profile 或主库卡片；未处理其他队列；未提交或发布。

## 实现内容

1. 新增 `src/services/editor-session.ts`。会话按 Vault、卡片 UUID、来源 ID 和相对路径识别，加载过程 single-flight；维护磁盘基线、当前内容、来源文本、草稿、冲突、IME 状态和修订号。
2. `src/services/markdown-editor.ts` 在 Zotero 主插件上下文创建并持有会话，通过 `openDialog` 参数把同一个会话传给编辑窗；同时导出 `createMarkdownEditorRuntime()` 供 Reader 内嵌视图接入。这样后续小卡片与展开窗可复用会话，而不是各自维护副本。
3. `src/services/editor-window.ts` 改成会话视图适配器。视图挂载接收快照，输入写回会话；关闭视图仅解绑并提交草稿/保存，不直接销毁仍有任务的会话。
4. 保存、冲突解决、恢复副本和磁盘轮询使用同一保存队列；草稿有独立串行队列。迟到回执不能清除新修订；冲突动作依据修订号校验，操作准备期间若又有输入则中止，不覆盖新输入。
5. 多视图通过 view ID 共享快照。IME 组合期间只允许组合所属视图提交；其他视图只读，组合视图卸载时解除锁并继续保存。
6. 无冲突时正文回退到磁盘基线会清理过期草稿；未解决冲突时，即使本地正文等于旧基线也会持久化该版本，避免外部覆盖后丢失本地侧。读取失败且无草稿、卡片缺失、身份不符或草稿路径身份不符时，不会发出空正文覆盖。
7. 新增 `scripts/test-editor-session.mjs` 与 `npm run test:editor-session`。
8. companion 写入超时后，会话跟踪唯一在途 request 并读取其 ACK 结果，轮询期间不重复排队；最近完成结果短期缓存以便 ACK 清理后会话仍可识别回执。真实测试还发现冲突面板在状态清除后未隐藏，现已修复快照更新时同步隐藏面板。

## 验收结果

| 用例                                                     | 结果             | 证据/限制                                                                                                                     |
| -------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| B2-01 独立编辑窗既有编辑、预览、草稿恢复、冲突行为无回归 | **PASS**         | 隔离 Zotero 实际打开编辑器，验证 Markdown 编辑/预览、草稿冲突比较、选择磁盘版本后清除面板；正文正确保留。自动恢复测试也通过。 |
| B2-02 A/B 延迟加载隔离                                   | **PASS**         | A/B 两张卡延迟加载、乱序完成及同卡 single-flight 初始化测试通过。                                                             |
| B2-03 旧保存回执不能清除较新输入/草稿                    | **PASS**         | 自动延迟回执测试通过；真实宿主中待处理请求关闭卡片后得到 ACK，编辑器返回 Saved 且队列、草稿清空。                             |
| B2-04 视图卸载/重新挂载复用会话且无重复定时器            | **PASS（自动）** | 同会话重新挂载、草稿与保存继续；多个视图只启用一个 poll timer，解绑后不再接收快照，最后视图解绑时计时器清理。                 |
| B2-05 同卡片写入串行、缺失卡片不被写成空正文             | **PASS（自动）** | 普通保存与冲突保留本地串行；冲突操作期间新输入不会被旧快照覆盖；缺失/不可读卡片无写入；来源身份和相对路径受校验。             |
| 多视图 IME 组合期间避免兄弟视图覆盖                      | **PASS（自动）** | 组合持有者写入生效；其他视图编辑被拒绝；组合结果成为共享状态。                                                                |
| 冲突正文回退至旧基线后的重启恢复                         | **PASS（自动）** | 未解决冲突时仍保留草稿；模拟新会话重载后，旧本地正文与外部磁盘版本仍组成冲突。                                                |

**B2 总状态：完整验收通过（2026-10-31）。** 自动化与隔离 Zotero/Obsidian 宿主验收均通过。真实宿主确认了从 Reader 进入编辑窗、Markdown 编辑和预览、待 ACK 单请求等待、关闭卡片后的写入与 ACK、冲突比较及恢复。多视图竞争、IME 和部分延迟/故障时序仍由自动化夹具覆盖；这些不是本次真实 UI 手工覆盖项。

## 执行命令

| 命令                                                                                                                                      | 结果                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `npm run test:editor-session`                                                                                                             | PASS                                     |
| `npm run test:card-format`                                                                                                                | PASS                                     |
| `npm run test:reader-popup-prototype`                                                                                                     | PASS                                     |
| `npm run smoke:integration`                                                                                                               | PASS                                     |
| `npx tsc --noEmit`                                                                                                                        | PASS                                     |
| `npx eslint src/services/editor-session.ts src/services/editor-window.ts src/services/markdown-editor.ts scripts/test-editor-session.mjs` | PASS                                     |
| `npx prettier --check ...`（B2 源码、测试、`package.json`）                                                                               | PASS                                     |
| `git diff --check`                                                                                                                        | PASS                                     |
| `npm run build`                                                                                                                           | PASS；最终代码已重新打包并通过类型检查。 |

## 后续阶段边界

- B2 无剩余验收项，可进入 B3。
- B1 的 Zotero Reader shutdown 原位恢复、真实 A/B 50 次与完整插件移除仍未完成；B2 通过不代表 B1 已通过，也不替代 B4 对 Bridge/Native 模式切换的验收。
- `.scaffold/b2-vault` 中保留了本轮测试产生的 `Bridge Recovery` 备份，未删除；其内容均为隔离测试卡历史版本。
