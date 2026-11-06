# C5-A/B 执行与宿主补测报告

日期：2026-11-07
状态：**实现、自动回归和 C 隔离详情编辑器关键场景通过；最新 Reader 可见性修复包已完成 Bridge 正文链接行锚点现场复验。C5 整体尚未完成全部宿主验收。**
范围：C5-A 每条关系使用独立来源锚点；C5-B 卡组成员打开后，自动发现并连线当前可见卡片之间的真实链接。本文是 [C5 原执行报告](c5-execution-report.md) 的补充，不替代 C0-C4、B4/B5 或 C5 其余验收项。

## 结果摘要

用户报告的两项问题已落到卡组关系层处理：多个链接不能再共用“最近一次点击位置”作为来源；新卡加入现有卡组后，会只读解析根卡和已打开子卡的链接，并把解析到当前可见卡组成员的关系补入图中。解析限两个并发请求，可取消、按内容代次淘汰旧结果，并只使用现有 `resolve-link` 能力；不自动打开目标、不读未打开笔记正文、不写知识卡、不使用同步写入队列。

C 隔离详情编辑器的根卡、Bayes 与 Motion 三卡场景通过：先从根卡打开 Bayes，再从 Bayes 的 `Motion model` 打开 Motion 后，现有卡组关系线出现；此时无需再点击根卡中的 Motion 链接来补根卡到 Motion 的关系。随后点击根卡中已有的 Motion 链接，复用现有 Motion 卡，Bayes 的线仍留在自己的关系锚点，没有随最后一次点击跳到 Motion 锚点。测试只打开只读知识卡并移动两个面板查看连线，没有编辑 Markdown 正文。

初始候选包的 Reader 结果与卡组验证分开记录：当时点击现有高亮首先仍出现 Zotero 原生评论框，仅从菜单成功打开 P02N01 详情编辑器。该历史记录不代表最新包结果；最新 Reader 现场复验见下文“Reader 可见性根因与正文行复验”。

## 实现与保护边界

- 新增 `src/core/visible-card-relations.ts`：从根卡实时 Markdown 和已打开卡片的已保存正文中收集链接，按 Vault 解析结果规范化路径，只保留两端都已存在于当前卡组的有向边；相同规范路径去重，别名不会创建重复节点。
- 更新 `src/services/knowledge-note-card.ts`：卡组内容变化后延迟触发只读关系重算；新内容取消旧代次，重新校验配对/权限 scope，旧响应不得覆盖新结果。待同步根卡从当前编辑缓冲读取，子卡只读已配对 Vault 内容。
- 更新 `src/services/knowledge-card-group-surface.ts`：根批注到弹出卡的关系线以 `(sourcePath, targetPath)` 独立保存正文 DOM 锚点；重排/点击其他链接不会重写已有关系的锚点。不可见或被滚动容器裁切的源链接回退到相应源卡标题，不借用其他链接位置。Bridge 链接锚点与弹出知识卡之间、弹出卡彼此之间的连线统一从卡片左右侧边进入；同列卡片按路径稳定分配相反侧边，避免箭头叠位。双向关系保留在模型及提示文字中，画面只绘制一条双箭头。
- Reader 小卡、待创建卡片和展开编辑器都注册根卡路径、实时 Markdown 与可见预览锚点。编辑/预览重绘更新锚点；仅 DOM 重绘但正文未变时不重复解析请求。
- 关系扫描有界并发为 2，单次 `resolve-link` 超时 4 秒，可通过 generation、AbortSignal 和 scope epoch 变化取消/丢弃。扫描错误只将关系标记为 partial/unavailable，不阻塞输入、预览、保存或 ACK。
- 卡组导航来源图与语义链接图分开。移除一条链接不会因此关闭用户已经打开的只读知识卡。

## 自动化与静态验证

以下检查在本次候选包构建前通过：

```text
npx tsc --noEmit
npm run test:c5-visible-relations
npm run test:c5-linked-card-group
node --experimental-strip-types scripts/test-c3-c4-ui.mjs
npm run test:note-links
npm run test:note-navigation
npm run test:editor-session
npm run test:b5-recovery
npm run test:reader-popup-prototype
针对本次涉及的 8 个源码/测试文件运行 ESLint
对涉及文件运行 Prettier
git diff --check
npm run build
```

`test:c5-visible-relations` 覆盖 canonical alias 去重、根卡与已打开卡互链、两个 worker 的并发上限、错误/取消与过时代次、不可见目标排除、代码/注释/转义/嵌入排除、关系锚点稳定、隐藏锚点 fallback、Bridge 到卡片及卡片互链的左右侧边几何、链接编辑移除关系但保留打开卡片，以及配对 scope 改变时不接纳旧结果。既有 `test:c5-linked-card-group` 和 C3-C4 UI 测试亦通过。

## 隔离宿主证据

| 场景                                                                           | 结果        | 证据边界                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 运行目标包及数据隔离                                                           | 通过        | XPI 安装到 `.scaffold/c-profile`；Zotero 参数同时指向 `.scaffold/c-profile` 与 `.scaffold/c-data`。C Vault 是 `.scaffold/c-vault`，底栏显示 connected。主 Zotero/Main_Learning 未操作。 |
| 根卡打开 Bayes                                                                 | 通过        | P02N01 展开详情编辑器中打开 `Mathematics/Bayes`，显示其只读内容；未自动打开 Bayes 中其他链接目标。                                                                                      |
| Bayes 再打开 Motion                                                            | 通过        | 从 `Motion model` 链打开 `Physics/Motion`，同一详情窗出现第二张只读卡；随后看到根卡到已打开目标的补充连接，无须额外点击根卡 Motion 链接才建立该关系。                                   |
| 点击根卡 Motion 后的节点复用与锚点                                             | 通过        | 已打开 Motion 卡被复用，没有新增同路径卡；截图中根卡 Bayes 与 Motion 链的位置和对应目标保持分离，Bayes 关系没有跳到最后点击的 Motion 锚点。                                             |
| 正文完整性                                                                     | 通过        | 编辑器状态显示 `Saved`；本次未输入/删除/保存正文。只有只读知识卡打开及浮卡位置变化。                                                                                                    |
| Reader 原位弹窗                                                                | 未通过/待查 | 直接点击高亮首先显示原生评论框；从其菜单打开详情编辑器可用。Reader mode 持久偏好是 `bridge`，但本次没有观察到原位 Bridge 小卡。不可把详情编辑器成功当成 Reader 原位弹窗通过。           |
| 两 Reader 并行隔离、真实卡组上限、Reader 空白区输入穿透、关闭/停用完整资源矩阵 | 未运行      | 沿用 C5 原执行报告中的缺口。                                                                                                                                                            |

## 候选包

- XPI：`.scaffold/build/zotero-obsidian-bridge.xpi`
- SHA-256：`9814ce616f2da49d8c9085c98f08ab5a24a1272ff7d5bb042b7c4a9929455ef0`
- 已依用户授权安装到 `.scaffold/c-profile` 并重启 C 隔离 Zotero，PID `19907`。
- 安装前隔离 XPI 备份：`.scaffold/c-install-backups/1793981978206-zotero-only`
- 未安装到日常 Zotero；未操作 `Main_Learning`；未提交或推送 Git。

### 标题栏连线视觉微调

- 新构建 XPI：`.scaffold/build/zotero-obsidian-bridge.xpi`
- SHA-256：`63376b7308b1c4779238a1f9dbf0c8c923a37fe0ab6c258ac1885b6a202155d4`
- 定向回归 `test:c5-visible-relations`、`test:c5-linked-card-group`、`npx tsc --noEmit`、Prettier、ESLint 和 `npx zotero-plugin build` 均通过。
- 该微调包尚未安装到隔离 Zotero，故只记录为代码与构建通过，不声称已完成真实宿主目视验收。

### 侧边箭头纠正

- 按用户确认的视觉规则，将 Bridge 正文链接到知识卡、以及知识卡彼此之间的关系线统一改为连接卡片左右侧边；Bridge 端仍锚定对应的实际链接文字。同列卡片使用稳定的相反侧边分配。
- 候选包：`.scaffold/build/zotero-obsidian-bridge.xpi`
- SHA-256：`b6dd3662c30e66dc3b84d2a9212f680af055a9f14bf0beb5be081ecbb37abcbe`
- `test:c5-visible-relations`、`test:c5-linked-card-group`、TypeScript、ESLint 与生产构建通过。
- 此哈希是新构建候选，尚未安装到 C 隔离 Zotero；先前对旧哈希的安装授权不视为对本包的授权。

### Bridge 正文链接行锚点修正

- 此轮仅处理了同一目标多个别名链接的选择问题，未解决 Reader 仍回退到标题栏的实际根因。点击链接时记录其目标与同目标出现序号；预览重绘后重新定位该行，不保留已脱离 DOM 的元素引用。尚未点击的关系按链接路径具体程度选择锚点。
- 知识卡之间已验证的左右侧边箭头路径未改动；Bridge 关系线仍以对应链接行的矩形中心为正文端点，另一端接知识卡侧边。
- 回归新增覆盖：同一 Bayes 目标的 `[[bay]]` 与 `[[Mathematics/Bayes]]` 精确点击选择、预览 DOM 替换后的锚点恢复、改点另一别名后箭头随之移动。
- `test:c5-visible-relations`、`test:c5-linked-card-group`、TypeScript、ESLint、Prettier、`git diff --check` 与生产构建通过。
- 新候选包 SHA-256：`87cb7b484df0ef7f6e636cac7a71b922b5390e7e11d0681eef15d6d41347bc5e`。已按用户授权安装到 C 隔离 profile，并重启进程 PID `31838`；构建包、profile 内 XPI 和隔离清单中的哈希一致。安装前备份位于 `.scaffold/c-install-backups/1793989437541-zotero-only`。
- 宿主目视复验尚未完成：点击 Reader 批注的 `Open / Add Obsidian card` 后，macOS 显示 “Open the obsidian link with Obsidian?” 确认框，且 `Open Link` 当时为禁用状态；Computer Use 随后超时，未能打开 Bridge 卡确认箭头是否落在具体正文链接行。此次没有编辑或删除批注正文，也没有操作主 Zotero 或 Main_Learning。

### Reader 可见性根因与正文行复验

- 根因：Reader 样式隐藏原生 `.annotation-popup.zob-reader-card-host`（`visibility:hidden`），同时显式显示其 Bridge 子卡（`visibility:visible`）。原 `anchorVisible()` 检查每一个祖先的 visibility，误把实际可见的后代正文链接排除，导致标题栏回退。此前 LinkeDOM 测试没有模拟 computed style，因此未覆盖此宿主条件；不是 Obsidian 队列或建卡速度导致。
- 修复：只按链接自身的 computed visibility 判断继承后的可见性；仍检查祖先的 `display:none`、hidden 属性、滚动裁切及视口交集。侧边端点、曲线控制点和双箭头绘制代码未修改。
- 回归：加入隐藏原生外壳、显式可见 Bridge 后代的结构与 CSS 继承模型，旧代码在精确链接行断言失败；修复后 Bayes、自动补入的 Motion 分别使用自己的正文链接行，且真正隐藏或 display:none 祖先内的链接仍被排除。C5-A/B、卡组、知识卡、Reader 原型、C3/C4 UI、ESLint、Prettier、TypeScript 和生产构建通过。
- 用户授权后安装 XPI SHA-256 `bea9aed8fac895985817800136576038d2f591b482e628c80b7f3b59658fc4a7`，仅重启 `.scaffold/c-profile` / `.scaffold/c-data` 的 Zotero（PID `32607`）。profile 内 XPI 哈希一致；旧包备份为 `.scaffold/c-install-backups/1793989828498-zotero-only`。
- Computer Use 现场通过：在 C 合成 PDF 第 2 页双击既有高亮，Bridge 原位浮卡成功显示；切预览，点击正文 `Mathematics/Bayes`，再点击 `Physics/Motion`。解析完成后的截图显示两条根卡关系分别落在各自正文链接行，不再指向 `P02 · P02N01` 标题栏，知识卡端仍从侧边接入。两张知识卡部分重叠，本轮不据此额外宣称拖动或完整卡组矩阵通过。
- 仅进行只读预览导航，没有编辑正文、创建或删除批注，没有操作主 Zotero 或 Main_Learning。

## 后续

1. 最新包已完成该 C Reader 既有高亮的原位 Bridge 弹窗及正文行锚点复验；其他 Reader 生命周期/并行矩阵仍按原清单补齐，不将一次场景通过扩大为全部 Reader 验收完成。
2. 按 `docs/c5-execution-report.md` 补齐两组独立 Reader/展开窗隔离、窗口上限及完整关闭/停用清理矩阵。
3. 不因 C5-A/B 通过而关闭 C0-C4 未完成门槛、B4 保存失败草稿恢复或 B5 真实双应用验收。
