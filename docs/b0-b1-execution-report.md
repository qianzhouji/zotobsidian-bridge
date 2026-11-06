# B0–B1 执行报告

执行日期：2026-10-30；状态复核：2026-10-31

项目：Zotero Obsidian Bridge

范围：卡片元数据/命名迁移基线（B0）与 Reader 评论浮窗接入验证（B1）。

## 结果摘要

- **B0：针对性验收通过。** 元数据 v4、属性区精简、旧卡片兼容、`PxxNxx` 命名及后台路径迁移均有代码和自动回归。Obsidian 1.14.5 隔离 Vault 的 Reading View 与 Live Preview 也做过实际检查。
- **B1：主要 Reader 行为通过，阶段仍部分验收。** 最新本地构建 XPI（0.1.0，B1 reader-mode 代码）已安装到隔离 `.scaffold/profile`，永久插件 ID `zotobsidian-bridge@qianzhouji` 当前处于 active。真实下划线批注在 Bridge 模式下首次点击即显示原型壳；原生颜色、页码及标签操作均已验证并恢复，临时下划线已删除。真实插件停用后重新打开批注可见原生评论，但停用前未处于 Bridge 隐藏评论状态，因此“Bridge 壳已挂载、原生评论已隐藏时 shutdown 后原位恢复”**明确标记未完成（NOT RUN）**；真实 A/B 身份快切 50 次和完整插件移除恢复也未完成。
- 未在主 Zotero profile 安装本轮构建、未写入 `Main_Learning`、未提交或发布。

## 隔离边界

- 本次验收使用项目 `.scaffold/profile` 和 `.scaffold/data` 启动的隔离 Zotero；日常 Zotero 与主 Vault 未操作。本轮安装本地构建 XPI 仅作用于该隔离 profile。
- B0 显示测试夹具位于 `.scaffold/b0-vault`，不属于主 Vault。
- 临时 `readerMode` 偏好已清除，开发者控制台读回 `undefined`。临时下划线 `Previous optimization methods`（PDF 物理页码 2，annotation key `F226IUCK`）已验证原生/Bridge 行为后删除；临时标签 `bridge-b1-temp` 已添加并移除。Reader 侧栏复核只剩原有两条批注，原评论 `Bridge integration test annotation` 保持不变。
- 本轮在隔离插件管理器中停用插件后，通过 Reader 再次打开该原有批注，原生评论 `Bridge integration test annotation` 正常显示；随后重新启用插件。停用时没有已挂载的 Bridge 原型壳，因此此结果只证明停用后原生评论可用，不代表已验证隐藏评论的原位恢复。隔离 profile 最终插件 active、`readerMode` 未设置；主 profile 未触碰。
- 测试批注 `RQR9RU33` 的持久化评论核对为 `Bridge integration test annotation`；没有编辑、删除或保存批注内容。

## B0 实现

1. 新卡片同步字段改为 v4 空 inline `<span data-payload>` 元数据载体；Obsidian Properties 只暴露 `paper_title`。`bridge_*`、`zotero_*` 等同步字段仍保留在文件中，不再铺满属性面板。
2. 解析器兼容旧 YAML、过渡 HTML 注释及旧 `display:none` div 格式；源更新时迁入 v4，并保留未知用户属性和 `## My notes` 正文。
3. 批注卡片统一采用 PDF 物理页码和页内序号，例如 `P02N01.md`。仅旧批注 key 文件名参与自动迁移；用户自定义文件名不自动改动。
4. 手动/后台共用路径迁移服务；迁移检查位于来源哈希短路之前。来源哈希未变化时也会迁移旧路径，并保持 card UUID、来源哈希和用户正文。
5. 更新 `docs/card-format.md` 与阶段路线状态。

## B0 验收证据

| 检查                                         | 结果    | 证据                                                                                                       |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| YAML、过渡注释、旧隐藏 div、v4 的读取和升级  | PASS    | `npm run test:card-format`；验证 UUID、可见属性、载荷读取及用户正文保留                                    |
| 后台同步中的旧路径迁移                       | PASS    | `npm run smoke:integration`；覆盖来源变化与哈希不变两种情况，确认无重复卡片                                |
| 属性精简与渲染                               | PASS    | Obsidian 1.14.5 隔离 B0 Vault 的 Reading View / Live Preview 检查；Source 模式显示原始 Markdown 属预期行为 |
| 既有集成回归                                 | PASS    | 集成 smoke 通过，包含冲突保护、队列恢复、多个 PDF 映射、100 条卡片导入等既有场景                           |
| Obsidian companion 写入与 ACK 回归           | PASS    | `npm run test:companion-r3`；覆盖安全移动/重放、资源校验、ACK 清理、Markdown 恢复/冲突和配对               |
| 插件编译与类型检查                           | PASS    | `npm run build`                                                                                            |
| companion 进程中断/迟到 ACK 的真实双应用注入 | NOT RUN | 属于后续 B6 的跨应用故障恢复验收，不作为本次 B0 通过证据                                                   |

## B1 实现与验收

新增 `src/adapters/reader-popup-prototype.ts`：仅在显式 Bridge 模式下观察 Reader 文档；根据已保存 annotation ID 查找来源；成功确认身份后隐藏 `.comment` 并挂只读原型壳；身份未知时 fail-open；切回原生模式或停用时恢复评论。`renderToolbar` 事件给出的文档不是保存批注 popup 所在文档，因此 `src/hooks.ts` 现在优先使用 `reader._iframeWindow.document`，事件文档只作 fallback。此原型不编辑 Markdown、不创建卡片，也不改变原生评论。

`npm run test:reader-popup-prototype` 通过，覆盖：

- 原生模式默认不接管；Bridge 模式下来源 ID 和 PDF 物理页码映射正确。
- 100 次原生/Bridge 模式切换无重复壳。
- 50 次 A/B 批注身份切换不串卡。
- 未知身份回退到原生评论；停用时恢复评论和 ARIA 状态。
- Reader iframe 文档优先于 toolbar event 文档；缺少 iframe 时回退到 event 文档。

**真实宿主结果：** Zotero 10.0.6 隔离 Reader 的进程路径已核实。真实已保存黄色高亮 `RQR9RU33` 单击后，Bridge 原型壳直接显示批注来源 ID 和 PDF 物理页码 2；原评论 `Bridge integration test annotation` 保持不变。重启后曾发现 Reader 预先恢复、而事件监听尚未注册的情况，导致既有 Reader 没有接入；已通过启动时扫描 `_readers` 并在 `_initPromise` 后再次接入修复。真实 popup 上验证了 100 次打开/关闭、5 轮 A/B 批注切换，以及 Bridge/native 偏好即时切换；切回 native 后原生评论框即时恢复。本轮另在隔离 PDF 第 2 页创建下划线夹具 `F226IUCK`，确认 Bridge 模式下直接点击首次打开即显示原型壳及来源 ID/物理页码 2；原生颜色黄色→红色→黄色、页码 2→3→2、标签添加/移除与删除操作均通过。临时夹具删除后 Reader 侧栏只剩原有两条批注；`readerMode` 偏好已清除并读回 `undefined`。

| 检查                                 | 结果    | 说明                                                                                      |
| ------------------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| 原型组件与 fail-open/恢复逻辑        | PASS    | 自动 DOM 夹具；真实 native/Bridge 即时恢复也通过                                          |
| 100 次真实 popup 开关                | PASS    | Zotero 10.0.6 隔离 Reader，真实打开/关闭循环                                              |
| 真实 Reader A/B 身份快切 50 次       | PARTIAL | 真实 Reader 完成 5 轮；自动夹具 50 次通过                                                 |
| popup 所在文档与批注身份/物理页码    | PASS    | 隔离 Reader；真实批注 `RQR9RU33`，PDF 物理页码 2                                          |
| 已保存黄色高亮单击直接显示 Bridge 壳 | PASS    | 隔离 Reader 自然点击；无二次菜单点击                                                      |
| 已保存下划线单击直接显示 Bridge 壳   | PASS    | 隔离 Reader 临时下划线 `F226IUCK`；Bridge 模式下首次直接点击显示来源 ID 和 PDF 物理页码 2 |
| 原生颜色切换与恢复                   | PASS    | 临时下划线由黄色改为红色，再恢复黄色；菜单复核红色被选中                                  |
| 原生页码编辑与恢复                   | PASS    | 临时下划线页码 2 改为 3，再恢复为 2；未改动 PDF 文件                                      |
| 原生标签添加与移除                   | PASS    | 临时标签 `bridge-b1-temp` 添加后移除；批注恢复为“添加标签…”                               |
| 原生删除及更多菜单                   | PASS    | 通过目标批注菜单删除临时下划线；Reader 侧栏确认只剩原有两条批注                           |
| 模拟插件停用/shutdown 后恢复原生评论 | PASS    | 自动 DOM 夹具验证 observer 清理、评论和 ARIA 状态恢复                                     |
| 真实 Zotero 插件停用后原生评论可用   | PARTIAL | 隔离 profile 中 `active=false` 后重新打开原批注，原生评论正常显示；随后已重新启用插件     |
| Bridge 壳已挂载时停用并原位恢复评论  | NOT RUN | 停用前没有挂载 Bridge 壳，未验证 shutdown 对隐藏 `.comment` 的实际恢复                    |
| 真实 Zotero 插件卸载/移除后恢复      | NOT RUN | 未执行完整 Remove/重新安装流程                                                            |

**B1 当前为部分验收，不能标记完整通过。** 高亮和下划线直接进入 Bridge 壳、真实 popup 循环、native/Bridge 即时恢复、原生颜色/页码/标签/删除及自动 shutdown 逻辑均已验证。真实 Reader A/B 身份快切目前完成 5 轮（自动夹具 50 次通过），尚未达到真实 50 次；真实宿主中“Bridge 壳挂载时停用并原位恢复”和插件完整卸载/移除仍未验收。Bridge 壳仍是只读原型，不是 Markdown 编辑/预览 UI；完整编辑 UI 留待 B2 以后实现。

## 执行命令

```text
npm run test:card-format                 PASS
npm run test:reader-popup-prototype      PASS
npm run smoke:integration                PASS
npm run test:companion-r3                PASS
npm run build                            PASS
npx eslint src/hooks.ts src/adapters/reader-popup-prototype.ts scripts/test-reader-popup-prototype.mjs PASS
npx prettier --check src/hooks.ts src/adapters/reader-popup-prototype.ts scripts/test-reader-popup-prototype.mjs docs/b0-b1-execution-report.md docs/bridge-mode-roadmap.md PASS
git diff --check                         PASS
```

本轮运行了 B1 相关文件的定向 ESLint 和文档/源码 Prettier 检查，未运行全仓 lint。工作树原有多个阶段的修改仍未提交；本次不创建覆盖无关修改的提交。
