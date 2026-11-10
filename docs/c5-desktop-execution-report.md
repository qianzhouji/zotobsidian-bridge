# C5-C.1–C.5 桌面窗口阶段执行报告

更新时间：2026-11-08

## 执行范围

本轮按 `bridge-mode-roadmap.md` 中 C5-C.1 至 C5-C.5 推进。目标是验证“独立系统窗口原型”和建立后续桌面卡片所需的生命周期/显示边界；本轮不接入普通知识卡内容，不改 C5-A/B 已验收的连线路由，不实现 C5-C.6 桌面布局或 C5-D 跨窗口线层。

## 基线与隔离

- 仓库基线：`e8ae962af935bc3dc1f037548978042db6c71efb`，分支 `feature/card-naming-properties`；C5-C 开始前除已有的 `docs/bridge-mode-roadmap.md` 规划改动外，工作树干净。本轮保留该规划改动。
- 依赖锁：`package-lock.json` SHA-256 `23fd35454028164dea6241aba9cf1fe2da614182ddf6f0e7381f8f91c3f4cf53`。
- 环境：macOS 27.2（Build 26B123）、Apple M3 / `arm64`、Node `v25.8.1`、npm `11.11.0`。Zotero 10.0.8 / BuildID `20261106121736`；应用声明兼容 Gecko 140.0–140.99，精确 Gecko runtime build 尚未从隔离进程确认。系统检测到内置屏与 RV100mini Q 外接屏；屏幕相对排列坐标尚未采集。
- 隔离目录：`.scaffold/c-profile`、`.scaffold/c-data`、`.scaffold/c-vault`、`.scaffold/c-queue`、`.scaffold/c-obsidian-profile`；Vault ID `0f87b99b-93ae-442f-9cf6-ef533d6e7dfc`。既有夹具基线见 `.scaffold/c-fixture-manifest.json`。
- 宿主核验时，C Obsidian 使用 `.scaffold/c-obsidian-profile` / `.scaffold/c-vault` 运行；日常 Zotero 已退出。唯一启动的 Zotero 进程 PID `25848`，启动参数为 `-profile .../.scaffold/c-profile -no-remote`；隔离配置指向 `.scaffold/c-data`。未对日常 profile、Main_Learning 或主队列做界面或数据操作。
- 隔离 profile 现安装候选 XPI；安装文件与候选包 SHA-256 一致。C Reader 根卡现场检查使用既有合成 PDF 和已存在测试批注，没有编辑、删除或新建批注。
- 未复制运行中的 Zotero/Obsidian 数据库；未触碰 Main_Learning、主 Zotero 数据目录或主队列。

## 本轮实现

- 新增 `KnowledgeCardSurface` 显示接口，当前 `KnowledgeCardGroupSurface` 实现该接口；`createKnowledgeNoteCard` 可注入 surface 工厂，未传入时沿用既有窗口内 surface。`clampCardRect` 和原有侧边箭头/端点实现未改。
- 新增 `DesktopCardWindowHost`，只允许本插件 `chrome://<addonRef>/content/` 下打包资源，并通过 Zotero chrome window 的 `openDialog` 创建独立、非模态、可缩放窗口。
- 新增开发构建专用合成卡片入口 `openDesktopWindowPrototype()`。窗口显示虚构只读内容并通过 `desktop-card-ready` 握手；不读取 Vault、不发送 companion 请求、不写入卡片。
- 新增窗口身份/状态注册表及窗口组协调器：按 profile、owner、root session、group、Vault、pairing epoch、规范路径识别；限制每组 8 张、每个原始宿主 16 张；同路径聚焦复用；就绪超时/初始化失败、迟到 ready、Cmd/Ctrl+W、owner 卸载会执行有代次保护的状态清理。
- 新增焦点组与本地键盘适配器。键盘监听只安装在原型知识窗；Cmd/Ctrl+W 关闭本知识窗，Backspace/Delete 不在普通内容区域触发浏览器回退；文本输入区域仍可正常编辑。
- 新增 `test:c5-desktop-windows`，使用模拟宿主验证窗口组行为。该测试不替代 Zotero/Gecko/macOS 真实窗口验收。

## 自动化结果

以下测试均于本轮通过：

| 项目                                  | 结果                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run test:c5-visible-relations`   | 通过：C5-A/B 独立锚点、自动关系、别名、去重、取消与 scope 失效                                                       |
| `npm run test:c5-linked-card-group`   | 通过：循环/菱形/复用/隔离组/尺寸边界/收起                                                                            |
| `npm run test:reader-popup-prototype` | 通过：Reader host 路由、模式切换、重试、关闭恢复                                                                     |
| `npm run test:editor-session`         | 通过                                                                                                                 |
| `npm run test:pending-card-drafts`    | 通过                                                                                                                 |
| `npm run test:b5-recovery`            | 通过                                                                                                                 |
| `npm run test:wiki-completion`        | 通过                                                                                                                 |
| `npm run test:note-links`             | 通过                                                                                                                 |
| `npm run test:note-query`             | 通过：4 操作、权限/路径/迟到响应/取消与超时清理                                                                      |
| `npm run test:note-navigation`        | 通过代码与 DOM 探针；真实 Reader/editor 20 次交互不属于该自动化结果                                                  |
| `npm run test:knowledge-note`         | 通过                                                                                                                 |
| `npm run test:card-markdown-preview`  | 通过：安全 Markdown、公式、图片与对象 URL 清理                                                                       |
| `npm run test:image-resource`         | 通过                                                                                                                 |
| `npm run test:companion-safety`       | 通过                                                                                                                 |
| `npm run test:c5-desktop-windows`     | 通过：身份复用、数量上限、ready/timeout/failure、迟到事件、owner unload、创建失败名额回收、50 次焦点交接与局部快捷键 |
| `npm run lint:check`                  | 通过：Prettier + ESLint                                                                                              |
| `npm run build`                       | 通过：生产构建 + TypeScript                                                                                          |

## 开发原型包与宿主现场结果

- 原型包：`.scaffold/c5-desktop-prototype-v2.xpi`，版本 `0.1.0`，插件 ID `zotobsidian-bridge@qianzhouji`。
- 当前候选 XPI：`.scaffold/c5-desktop-prototype-v2.xpi`，版本 `0.1.0`，插件 ID `zotobsidian-bridge@qianzhouji`。
- SHA-256：`abe58dc07b257fd038b3c256f8ef86fdd5fbc2d061b4f2a30abf34f1c0a1697b`。
- 由 `zotero-plugin build --dev` 输出打包目录后封装；`unzip -t` 检查通过；开发 API `openDesktopWindowPrototype` 与失败后可重试提示已在包内 bundle 中确认。候选包和隔离 profile 扩展目录中的安装包哈希均为上述值。
- 隔离 Zotero 已加载该插件，开发者控制台可见 `Zotero.ZoteroObsidianBridge.api.openDesktopWindowPrototype`。合成只读知识卡窗口显示 `Ready`，内容与控件初始化正常。
- 屏幕报告 `2048×1152`、可用区域 `2048×1122`、`devicePixelRatio=2`；Zotero 主窗几何为 `(647,214) 1064×764`。原型窗口通过宿主 `moveTo(1750,250)` 后，其报告坐标超出 Zotero 主窗右边界 `1711`；这证明独立窗口坐标不受父窗矩形限制，但只是脚本移动，**不是鼠标拖拽通过证据**。另一次移动到 `(1450,180)` 也可被窗口报告。
- 实际 Reader 中打开了已存在 Bridge 根卡，再从 Zotero 主窗口创建合成子窗；关闭子窗后返回 Reader，根卡仍显示且正文未变。该往返完成一次，不是计划要求的 50 次焦点矩阵或 20 次开关压力测试。
- 鼠标拖拽现场未通过：CUA 标题栏拖拽返回 `AXError.noValue`，无法确认窗口是否被真实鼠标移动。Cmd+W 也无法判定：CUA 发出的事件记录只有 `Meta` 键释放，没有 `w` 键事件；这不是应用快捷键失败的有效证据。可用窗口关闭按钮正常关闭原型窗。
- 真实初始化失败、超时 UI 和连续开关 20 次尚未在宿主完成；真实 IME、撤销/重做、跨应用/多屏行为也未测。C5-D 桌面线层完全未实现。

## 阶段状态

| 阶段                     | 状态                           | 说明                                                                                                                                                                                             |
| ------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C5-C.1 基线与隔离        | **部分完成**                   | 分支/锁文件/环境和隔离路径已记录；候选 XPI 已精确安装到 `.scaffold/c-profile`，运行 PID 参数和 C dataDir 已核对。代码级基线回归通过；逐项资源计数、显示器拓扑及精确 Gecko runtime 尚未完整采集。 |
| C5-C.2 顶层窗口原型      | **宿主部分通过**               | 打包 XHTML、ready 握手、真实顶层窗口和脚本移动坐标已验证；真实 Reader 根卡打开后关闭子窗仍保留。鼠标标题栏拖拽未能由 CUA 可靠执行；20 次循环及真实失败 UI 未验。                                 |
| C5-C.3 状态/显示后端分离 | **部分完成**                   | surface 接口和注入点已抽出；知识卡节点仍由 `createKnowledgeNoteCard` 在根 Document 创建，尚未迁移到子窗口 Document，也没有跨 Document 的生产卡片 view/消息协议。生产卡片后端未切换。             |
| C5-C.4 窗口身份与状态机  | **原型自动化通过，生产未接入** | 原型组身份、8/16 上限、路径复用和清理测试通过；当前生产知识卡 surface 与注册表尚未共用计数，真实双 Reader/跨后端合并计数未验。                                                                   |
| C5-C.5 根卡/焦点/键盘    | **部分宿主通过**               | 真实 Reader 根卡在一次子窗创建/关闭后保留；模拟焦点/键盘测试通过。Cmd+W 受 CUA 未发送 `w` 键限制而无法判定；50 次宿主焦点矩阵、IME/撤销/补全未验，原型监听不作用于生产卡片。                     |

## 后续退出条件

继续宿主验收时使用已安装的精确候选包，进程必须仍指向 `.scaffold/c-profile`。当前已有证据：子窗 ready、脚本坐标超出 Zotero 父窗边界，以及关闭子窗后 Reader 根卡仍在。后续需用真实鼠标完成标题栏越界拖拽、开关 20 次、初始化失败/超时清理、50 次组内焦点转换与 Cmd+W；若 CUA 仍无法正确发出鼠标/键盘输入，需由用户在隔离实例执行并回报，不得伪记为通过。不得全局覆盖 Zotero 原生 popup。

即使原型的剩余宿主项目通过，C5-C.3、C5-C.4 的生产集成缺口仍需在真实知识卡窗口 UI 开发前解决；跨桌面连线仍属于 C5-D，当前未实现。故 C5-C.1–C5-C.5 **尚未完整签收**。

## 2026-11-08 生产后端集成补充

以下为本报告原型记录之后的新增工作；原有 `.scaffold/c5-desktop-prototype-v2.xpi` 哈希和宿主结论仅描述旧原型，不代表当前生产候选。

### 生产集成

- `createKnowledgeNoteCard` 现在可通过 surface factory 使用独立桌面窗口后端；Reader 根卡、pending 卡和展开编辑窗均接入同一生产创建路径。桌面偏好默认关闭，未启用时沿用原有 inline surface。
- Desktop surface 先在根文档创建卡片状态节点，解析获得 canonical path 后才创建受控的 Zotero 顶层 XUL 窗口；ready 握手后将该卡片节点迁入子窗 Document。Markdown 和图片/资源渲染使用卡片当前所属的 `ownerDocument`。
- inline 与 desktop surface 共用挂在 Zotero 主窗口的 profile 注册表。身份包含 profile instance、原始 owner、root session、group、Vault、pairing epoch 和 canonical path；pending 卡先预留名额，同路径解析后转成规范路径 lease。注册表统一执行每组 8 张、每个 owner 16 张的限制与清理。
- 原生窗口关闭及 Cmd/Ctrl+W 均通知根图移除对应知识卡，释放注册名额；初始化失败、超时和 owner 关闭会清除窗口及 lease。若桌面后端启动失败，当前路径回退至 inline surface。
- 已新增/更新自动化覆盖注册表共享、配额去重、pending lease 转 canonical path、失败和迟到事件清理、跨文档挂载、窗口关闭对根图的通知，以及关闭快捷键路由。

### 当前自动化验证

2026-11-08 本轮下列命令通过：

| 检查                                  | 结果                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `npm run test:c5-desktop-surface`     | 通过：生产跨文档挂载、共享 lease、外部关闭、Cmd+W 清理和 inline 回退 |
| `npm run test:c5-desktop-windows`     | 通过：共享身份、8/16 配额、ready/失败/关闭清理、焦点交接和本地快捷键 |
| `npm run test:knowledge-note`         | 通过                                                                 |
| `npm run test:c5-linked-card-group`   | 通过                                                                 |
| `npm run test:c5-visible-relations`   | 通过：C5-A/B 锚点与关系回归                                          |
| `npm run test:reader-popup-prototype` | 通过                                                                 |
| `npm run test:note-query`             | 通过：权限、路径、迟到响应、取消与超时清理                           |
| `npm run test:editor-session`         | 通过                                                                 |
| `npm run test:pending-card-drafts`    | 通过                                                                 |
| `npm run lint:check`                  | 通过：Prettier + ESLint                                              |
| `npm run build`                       | 通过：生产 XPI + TypeScript                                          |
| `git diff --check`                    | 通过                                                                 |

当前生产候选：`.scaffold/build/zotero-obsidian-bridge.xpi`，版本 `0.1.0`，SHA-256 `64f44356d6aa92002de0a3d1c1e9d1444c778977603bb41a3ae1b4b6b278e0c9`。截至本补充写入时，尚未将这个新哈希的候选安装到隔离 profile，也没有将自动化结果冒充为 Gecko/macOS 实测。

### 当前阶段边界

| 工作                                     | 状态                                 | 证据/未完成项                                                            |
| ---------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| 生产卡片 backend 与 surface 切换         | **已实现，自动化通过**               | 真正 XUL 窗口中的 Markdown 内容/本地图资源由本轮新候选验收               |
| inline 与 desktop 共用注册表及 8/16 配额 | **已实现，自动化通过**               | 真实重复开卡、跨 Reader 名额回收需隔离宿主补验                           |
| 生产窗关闭与根图生命周期                 | **已实现，自动化通过**               | 真实 X 按钮、Cmd+W 后根卡保持及重新打开仍待宿主验证                      |
| 独立窗口拖出 Zotero/详情窗边界           | **未验收**                           | 需在 C 隔离 Zotero 中真实拖动 XUL 标题栏；脚本 moveTo 不算鼠标证据       |
| 子卡焦点切换、Cmd+W 与窗口关闭矩阵       | **未验收**                           | 需在 C 隔离环境验证只关子卡、不关根卡，并重开同一关系                    |
| C5-C.6–C5-C.8                            | **实现及自动化通过；宿主验收待完成** | 桌面布局/资源生命周期/退出矩阵已实现；真实显示器与键鼠矩阵待当前候选验证 |
| C5-D 跨窗口连线层                        | **未实现**                           | 不属于当前候选范围；不可宣称虚线随卡片在整个桌面移动                     |

本节记录 C5-C.1–C5-C.5 完成后的阶段状态。后续 C5-C.6–C5-C.8 开发与自动化结果见本报告末尾的 2026-11-08 补充；C5-C 整体仍需完成真实宿主矩阵。C5-D 不属于当前实现范围，仍未实现。

## 2026-11-08 白屏故障调查与 DOM 镜像修复

### 真实宿主故障

- 曾获准安装的生产候选 SHA `64f44356d6aa92002de0a3d1c1e9d1444c778977603bb41a3ae1b4b6b278e0c9` 在 C 隔离 Zotero 中可创建标题为 `Bayes · Zotero Obsidian Bridge` 的原生窗口，但窗口内容区持续白屏；Reader 中的卡片点击未产生可见知识卡内容。
- 因原生窗口已创建且标题按规范路径更新，窗口打开和路径解析至少部分成功；问题不再用“Obsidian 建卡慢/队列等待”解释。源码检查发现该候选把 Reader Document 中的活动卡片 DOM 用 `adoptNode` 移入独立 chrome Document。自动化 linkedom 环境不能复现 Zotero Gecko 的真实跨文档边界；因此这条迁移路径是白屏的主要嫌疑点，但尚须新包现场复验确认修复有效。

### 修复内容

- 移除活动卡片节点的跨文档迁移。父窗口继续持有唯一业务状态、NoteQueryClient、授权校验和知识图关系；桌面窗口从自身 Document 导入独立 DOM 镜像。
- 通过 MutationObserver 同步卡片异步加载的状态、文本和渲染树；桌面副本将按钮命令和双链点击转发至父窗口现有控制器，外链沿用既有 launcher。窗口关闭/Cmd+W 仍由共享注册表和根图清理处理。
- 新增自动测试，验证镜像确属子窗口 Document、父卡内容变化同步、刷新命令与双链点击转发、关闭清理及 inline 故障回退。此测试是模拟 Document 证据，不等同 Zotero Gecko 宿主通过。

### 当前候选和验收边界

- 最新生产 XPI：`.scaffold/build/zotero-obsidian-bridge.xpi`，SHA-256 `49ff8d2638f582efe2364632ecbc6e856143b7209e6468027551cce7d10c749d`。`unzip -t` 通过；真实宿主结果见本节后续记录。
- `npm run lint:check`、`npm run test:c5-desktop-surface`、`npm run test:c5-desktop-windows`、`npm run test:knowledge-note`、`npm run test:c5-linked-card-group`、`npm run test:c5-visible-relations` 和 `npm run build` 均通过；build 包含 TypeScript 检查。
- 后续已按用户授权将该 SHA 安装到 C 隔离 profile；真实宿主仍白屏，结果及下一候选见下方 2026-11-08 实测记录。不得把 DOM 镜像自动化通过当成 Gecko 宿主通过。
- 新包现场验收清单：确认 Bayes/Motion 内容与公式/图片出现；双链点击仍在同组正确复用/创建；真实鼠标将知识窗拖出 Zotero/详情窗边界并拖回；从根卡和子卡往返切焦点；Cmd+W 只关闭子卡并清除根图关系，根 Bridge 卡/Reader 保持；通过关闭按钮重复关闭/重开并确认 lease 回收、无空白孤儿窗口。
- 真实标题栏拖出、焦点循环和 Cmd+W 尚未完成；自动化不替代宿主验收。C5-C.1–C5-C.5 暂不整体签收，C5-C.6–.8 与 C5-D 仍未完成。

## 2026-11-08 DOM 镜像候选真实宿主复测与 XHTML 布局修复

### `3c0c4f19...` 真实宿主结果

- 用户授权后，通过 `scripts/refresh-c-zotero.mjs` 将 SHA-256 `3c0c4f19d49b7cd502eddf7fa280438843f6a7ab52a30c2d5db1a35dd3ba88d6` 安装到 `.scaffold/c-profile`；备份位于 `.scaffold/c-install-backups/1794122893121-zotero-only`。隔离 Zotero PID `38728` 启动参数显式指向 `.scaffold/c-profile` / `.scaffold/c-data`，profile 内扩展 `active: true` 且哈希相同；`desktopKnowledgeCards` 为开启状态。
- C0 Reader 中既有根卡 P02N01 正常显示正文和双链。点击 `Mathematics/Bayes` 后，原生独立窗口正确显示标题 `Bayes · Zotero Obsidian Bridge`，但内容区完全白屏，未显示卡片正文。这是该 SHA 的真实宿主 **FAIL**，并非等待 companion 队列即可解释。
- 用原生关闭控件关闭白屏子窗后，Reader 根 Bridge 卡仍在且正文保持；关闭回收/根卡保留 **PASS**。Cmd+W 的 CUA 快捷键投递未能形成可判定结果；窗口内容白屏期间未执行拖出 Zotero 的拖拽验收。

### 根因假设与新修复

- 独立窗口资源是 XHTML 文档。旧 CSS 用未命名空间限定的 `html, body` 选择器设置高度；在 chrome XHTML 文档中这些选择器可能不匹配 XHTML namespace，导致百分比高度链断开，绝对定位的 `#card-host` 与卡片落在零高度包含块中。该假设与“标题脚本运行、ready 成功、整个内容区白屏”的表现相符，但只有安装新包后真实显示正常，才能关闭根因验证。
- 新修复在 `desktop-knowledge-card.css` 声明 XHTML namespace，并用 `html|html`、`html|body` 建立 100% 高度链；`test:c5-desktop-surface` 新增了静态回归，但它没有覆盖真实 Gecko 窗口内的挂载完成状态。
- 候选 `.scaffold/build/zotero-obsidian-bridge.xpi` SHA-256：`49ff8d2638f582efe2364632ecbc6e856143b7209e6468027551cce7d10c749d`。`test:c5-desktop-surface`、`test:c5-desktop-windows`、`lint:check`、`build`（含 TypeScript）、`git diff --check` 和 `unzip -t` 通过；这些均未能预测此次宿主白屏。
- 用户授权后，此 SHA 已安装到 `.scaffold/c-profile`，隔离 Zotero PID `40293`，安装备份 `.scaffold/c-install-backups/1794123683860-zotero-only`。C 隔离 Obsidian PID `3065` 指向 `.scaffold/c-vault`，Vault 中 Bayes 正文可见且 Bridge 状态为 connected，排除 companion 未运行这一直接原因。
- C Reader 根卡 P02N01 可正常显示正文。点击 `Mathematics/Bayes` 后，子窗标题为 `Bayes · Zotero Obsidian Bridge`，但白色内容区为空；AX 树仅有窗口容器，没有 `#card-host` 内的卡片控件或正文。该 SHA 的独立卡片真实宿主验收 **FAIL**，XHTML 高度假设不足以解释/修复问题。
- 对白屏窗口尝试 `Cmd+W` 未关闭；CUA 鼠标拖动调用返回 `AXError.noValue`，且窗口内容空白，因此快捷键、真实拖出边界及焦点验收均记为 **NOT PASS / INCONCLUSIVE**，不可推定成功。新 SHA 的子窗关闭控件与 lease 回收也未能可靠复验；先前 `3c0c4...` 的关闭后根卡保留结果仅是旧候选证据，不覆盖当前 SHA。
- 下一步应在 `DesktopCardWindowGroup` ready 事件、`mountInWindow` 入口/出口、`#card-host` 子节点挂载和失败回退处建立可见握手/状态，并加入真实 Gecko 宿主诊断；首先确定父窗口是否执行挂载、挂载是否异常、DOM 是否存在但布局不可见。修复后需构建新哈希并单独获得安装授权，再复测内容、关闭回收、真实拖动、焦点和 Cmd+W。C5-C 阶段仍未签收。

### 挂载阶段可观测候选（宿主复测失败）

- 为避免再次把“窗口脚本 ready”误当成“卡片已挂载”，XHTML 初始显示 `Window ready; waiting for card content...`；父窗口进入挂载时更新为 `Mounting card content...`，只有 `#card-host` 接收镜像 DOM 后才设置 `data-mounted=true` 并隐藏状态提示。
- 自动回归增加 `data-mounted=true` 断言；`npm run test:c5-desktop-surface`、`npm run lint:check`、`npm run build`（含 TypeScript）、`unzip -t` 和 `git diff --check` 均通过。它们只证明代码路径/包结构，不证明 Gecko 会完成挂载。
- 诊断候选 SHA-256：`8119aafae078bbe8ae2aab1621d155ede3f61e56e72ceabb90fcc7bcfecff5b2` 已获授权安装到 `.scaffold/c-profile`，重启时 PID `41687`，备份 `.scaffold/c-install-backups/1794124919961-zotero-only`。CUA 确认 C0 Reader 根卡可打开；点击 Bayes 后独立窗口持续显示 `Window ready; waiting for card content...`，未进入 mounting。Cmd+W 后窗口仍在。此 SHA 的内容/快捷键宿主验证 **FAIL / NOT PASS**；真实鼠标拖拽和关闭回收仍未验收。

## 2026-11-08 初始文档生命周期核查与修复

### 已确认的代码缺陷

`DesktopCardWindowGroup.open()` 原来在 `openDialog()` 返回后立即监听子窗口 `unload`，并立即安装焦点/键盘监听，没有等待正式卡片文档。项目现有编辑器的 `observeWindowClose()` 与其测试已经明确防护初始 `about:blank` 文档卸载，新的桌面知识卡协调器却遗漏了同一边界。

本轮先新增“初始空白文档 unload 后窗口注册仍应处于 opening”的回归。**修复前稳定失败**：注册表中对应 lease 已消失。按原调用链，该 unload 会拒绝 ready、移除 lease 和监听；随后 fallback 再请求关闭时找不到窗口记录。子窗仍可继续加载自身 XHTML，却失去父窗口挂载和有效键盘监听。这与诊断包的 waiting/快捷键症状一致，但尚未采集原生文档切换事件序列，因此该缺陷是否充分解释现场故障，仍须新候选宿主复验。

另确认一处相关清理缺口：加载完成前主动关闭窗口时，若未收到对应 unload，ready Promise 可能一直不结束。现在统一在移除 entry 时结算该 Promise。

### 修复范围

- 就绪检查同时核对目标资源 URL 与 `data-ready`，不接受初始/错误文档上的就绪标记。
- 仅在正式文档就绪后绑定子窗 unload、焦点和 Cmd/Ctrl+W 监听；初始空白文档卸载不再释放窗口身份。
- 就绪阶段增加由稳定父窗口驱动的 50ms 有界轮询，覆盖文档替换导致 load/custom-ready 监听丢失的情况。保留 10 秒总超时；就绪、失败、提前关闭、owner 卸载及 dispose 都回收轮询和超时计时器。
- 初始化失败写入 `data-ready=failed`，即使失败事件丢失，父窗口也能发现并回退/回收。
- 关闭尚未就绪的 entry 时统一拒绝 ready Promise，避免内容加载链悬挂。
- 未修改 C5-A/B 的侧边几何、正文链接行锚点或路由算法；未安装到日常 profile，未写入主库或 Main_Learning。

### 回归与候选

- `test:c5-desktop-windows`：新增初始 unload、文档替换并丢失全部旧监听、轮询恢复、替换后 Cmd+W、提前关闭及失败标记清理；通过。
- `test:c5-desktop-surface`：生产 surface 在就绪事件丢失后仍挂载内容，且不误回退到 inline；关闭通知/lease 回收通过。
- C5-A/B 可见关系与卡组、Reader popup、EditorSession、pending 草稿、只读知识卡、安全 Markdown 预览、B5 恢复回归均通过。
- 读取协议测试首次遇到夹具偶发失败：`issuedAt` 和 `expiresAt` 分别调用 `Date.now()`，跨毫秒会使 TTL 超限。生产客户端已使用同一时间戳；本轮仅修正夹具，不放宽生产验证。修正后 `test:note-query` 连续两次通过。
- `npm run lint:check`、`npm run build`（含 TypeScript）和 `unzip -t` 通过。
- 本节修复候选 SHA-256 `84066f3ff364bc8f59e43fcb74cd34a4bffc4aa641e3f6a945b2052ae1564259` 后经用户授权安装到 C 隔离 profile；真实宿主结果见下节。

### 下一步宿主验收

获准安装此新 SHA 后，仅重启 C 隔离 Zotero：检查 Bayes/Motion 正文、公式与图片；检查嵌套双链与同路径复用；Cmd+W/关闭按钮只关闭子卡且根 Bridge 卡和正文保持；重开后名额回收正常；最后验证真实拖出宿主边界与焦点交接。上述均不能由模拟 Document 回归替代。C5-C 仍未整体签收，C5-D 未实现。

## 2026-11-08 窗口生命周期修复宿主复测与嵌套导航缺陷

- 用户授权后，SHA `84066f3ff364bc8f59e43fcb74cd34a4bffc4aa641e3f6a945b2052ae1564259` 安装到 `.scaffold/c-profile`；PID `43852` 参数指向 `.scaffold/c-profile` 和 `.scaffold/c-data`，安装文件哈希已核对，旧包备份为 `.scaffold/c-install-backups/1794126338660-zotero-only`。
- C Reader 既有 P02N01 根卡中打开 Bayes：独立窗口显示正文、数学公式和 Ready，未再停在 waiting；Cmd+W 后仅该子窗关闭，根卡及正文仍在。再打开 Bayes 成功，点击子卡关闭按钮后根卡仍在。此过程证明该场景可重开，但未直接采样注册表内部计数，不能推定所有关闭路径资源回收均已通过。
- 从根卡打开 Motion，正文、公式及图片的 AX 节点可见；从 Motion 点击 Bayes 可以打开 Bayes 子窗。关闭 Bayes 后，Motion 窗口的正文仍是 Motion，但卡头和路径错误显示 Bayes。随后关闭 Motion 再点击根卡 Motion 链，没有观察到 Motion 重开；此嵌套场景关闭回收 **FAIL**。
- 排查发现 desktop surface 的 `onCardLink` 将原卡实例作为 `open()` 的 `reuse` 参数，新目标因此覆盖来源卡身份；自动回归先复现来源卡消失，删除该错误参数后，来源和目标卡分别保留，关闭目标并再次打开通过。
- 当前源码已完成上述嵌套导航修复；`test:c5-linked-card-group`、`test:c5-desktop-surface`、`test:c5-desktop-windows`、`test:c5-visible-relations`、`lint:check` 和 `build`（含 TypeScript）通过。新 XPI SHA-256 `4300f7f33e2ded9c4a3a1d80be2bc5adf44ee1b76e0158459b8918d2b5242aa9` **尚未安装或做宿主验证**；C 实例仍是 `84066f...`。
- 下一候选需要在 C 隔离实例重测 Motion → Bayes：两窗标题/正文各自正确、关闭 Bayes 后 Motion 保持正确，再关闭并从根卡重开 Motion；另需验证根卡/草稿保留和注册/窗口回收。真实鼠标拖出边界、焦点矩阵和跨桌面连线仍未验；C5-C 与 C5-D 均不可整体签收。

## 2026-11-08 嵌套导航修复宿主复测

- 用户授权后，将 SHA-256 `4300f7f33e2ded9c4a3a1d80be2bc5adf44ee1b76e0158459b8918d2b5242aa9` 安装到 `.scaffold/c-profile`，安装文件哈希与候选一致；启动 PID `44627` 的参数指向 `.scaffold/c-profile` 和 `.scaffold/c-data`。旧包备份为 `.scaffold/c-install-backups/1794126611630-zotero-only`。
- 在 C Reader 既有 P02N01 的预览中打开 Motion，窗口标题、路径 `Physics/Motion.md` 和正文均为 Motion；从 Motion 打开 Bayes，标题、路径 `Mathematics/Bayes.md` 和正文均为 Bayes。
- 对 Bayes 使用 Cmd+W 后，Motion 保持打开，标题、路径与正文仍为 Motion；使用 Motion 的卡片关闭按钮后，Reader 根卡 P02N01 和正文保持，状态显示已保存。
- 从根卡重新打开 Motion 成功；再次从 Motion 打开 Bayes，使用 Bayes 的卡片关闭按钮后，Motion 仍正确，再从 Motion 重新打开 Bayes 成功。该场景的身份隔离、逐张关闭和重新打开 **PASS**。
- 本次没有直接采集注册表 lease、对象 URL 和监听器计数；重新打开成功不能单独证明所有资源已回收。没有执行真实鼠标拖出边界、完整焦点/快捷键矩阵、压力循环或 C5-D 跨桌面连线测试。仅本次嵌套场景通过，C5-C 和 C5-D 尚未整体验收。

## 2026-11-08 C5-C.6–C5-C.8 桌面布局与阶段退出

### 开发内容

- 新增 `fitWindowRectToScreen()`：把窗口限制在当前单一显示器的可用区域，兼容多屏负坐标、菜单栏/Dock 安全区，并在物理可用区小于常规最小尺寸时缩小到可达尺寸；不会将卡片放入显示器之间的虚拟空隙。
- 新增 `arrangeDesktopWindowRects()` 和组级 `arrangeWindows()`：为已打开的子卡提供排列/找回入口；按 owner 所在显示器布局，窗口过多或显示区太小时退化为级联排列。
- Zotero 窗口 host 使用 Gecko screen manager 获取可用矩形；卡片 ready 后以及 move/resize/恢复事件后做节流边界校正。XUL 窗口声明最小宽高，CSS 同步给出同一尺寸下限；退出时移除事件监听与计时器。
- Markdown 图片资源现在以 Blob 交接给子窗口，在子窗口自身创建 Object URL。替换/移除图片、关闭或挂载失败时回收 URL；不复用来源 Document 的 URL。桌面只读副本明确 `contenteditable=false`。
- 新增桌面布局、生产 surface、窗口 host 回归，并把 C5-C.8 十项集成用例按自动化/真实宿主分别记录，避免自动化通过被误读为宿主签收。

### 自动化与构建结果

| 检查                                                                 | 结果                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run test:c5-desktop-layout`                                     | PASS：负屏幕坐标、可用区域边界、边缘贴靠、最多 8 窗布局、小屏降级 |
| `npm run test:c5-desktop-surface`                                    | PASS：只读镜像、独立图片 URL、替换/移除/关闭回收、排列入口状态    |
| `npm run test:c5-desktop-windows`                                    | PASS：ready 边界校正、move 防抖、整理窗口、监听和计时器清理       |
| `npm run test:knowledge-note` / `npm run test:card-markdown-preview` | PASS：知识卡内容、公式/图片渲染与 Markdown 安全回归               |
| C5-A/B 可见关系、卡组、Reader popup、B5 草稿恢复等定向回归           | PASS                                                              |
| `npm run lint:check`                                                 | PASS                                                              |
| `npm run build`（含 TypeScript）                                     | PASS                                                              |
| `unzip -t .scaffold/build/zotero-obsidian-bridge.xpi`                | PASS                                                              |

生产候选 SHA-256：`b4abbbb4fff7c407503fbd5eb902052a2dae1a5f4ef63fa46df8212e1e7c7b9b`。生成后尚未安装到隔离 profile。当前 C Zotero PID `44627` 仍运行已验收嵌套导航的旧候选 `4300f7f33e2ded9c4a3a1d80be2bc5adf44ee1b76e0158459b8918d2b5242aa9`；新代码没有真实宿主证据。

### C5-C.8 逐项退出矩阵

| 用例                                         | 当前状态                                                           | 尚需的真实宿主证据                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| C5C-01 两种根入口、真实顶层窗口及拖出父窗口  | 用户确认真实拖出/回拖 PASS；详情窗独立知识卡链接 PASS              | Reader 与展开窗各自开卡及拖出父窗的证据需按入口分别归档                                            |
| C5C-02 别名/重复/循环/片段及两组隔离         | **用户确认真实宿主测试 PASS（2026-11-09）**                        | 本项关联测试由用户确认完成                                                                         |
| C5C-03 根卡/子窗焦点往返 50 次、关闭保留草稿 | **50 次焦点压力：用户确认真实宿主 PASS（2026-11-09）**             | 草稿、队列和其他子卡不变的单独核对仍需确认                                                         |
| C5C-04 边界、整理找回、最小尺寸和显示器恢复  | 基础真实拖动/布局及多屏/显示器项目由用户确认 PASS；几何自动化 PASS | 最小尺寸/缩放边界压力、分辨率变更、拔屏与唤醒恢复的具体操作/拓扑未归档；不从“多屏通过”外推这些子项 |
| C5C-05 打开/关闭中撤销、超时、迟到结果       | 确定性故障注入自动化 PASS                                          | 新候选在真实 Gecko 窗口做快速关闭/重开，确认无孤儿                                                 |
| C5C-06 每组 8 / 每 owner 16 配额             | 模型/注册表自动化 PASS                                             | 真实宿主达到上限并验证已有卡仍可聚焦、关闭后可重开                                                 |
| C5C-07 公式、图片、只读安全及笔记哈希        | 真实宿主正文/公式/图片只读展示 PASS；自动化 PASS                   | 安装前后 Vault 文件哈希及 companion 写请求计数；完整安全负例记录                                   |
| C5C-08 Cmd+W、复制/滚动与根卡输入/IME        | 有限场景 Cmd+W/逐级关闭通过；自动化 PASS                           | 真实复制/滚动、完整焦点交接后根卡中文 IME、撤销/删除/补全矩阵                                      |
| C5C-09 切模式、关闭 Reader、停用及重启清理   | 自动生命周期自动化 PASS                                            | C 隔离宿主逐项操作，重启后无孤儿窗口且 B5 草稿收敛                                                 |
| C5C-10 能力失败时回退                        | 自动化 fallback PASS                                               | 真实失败处理/提示检查；不得把安全回退记作桌面功能 PASS                                             |

## 2026-11-09 C5-D 宿主 IPC 集成复测：Darwin 平台识别修复

- 用户授权精确候选 SHA-256 `ad18d0c1008b58cda4d008c85d7acb694f6c26d86b47d7fc4aa48e6d493e0fce` 仅用于 C 隔离宿主验收。该包已装入 `.scaffold/c-profile`；运行中的 Zotero PID `10944` 的命令行明确指向 `.scaffold/c-profile` 和 `.scaffold/c-data`。C Obsidian PID `3065` 明确指向 `.scaffold/c-obsidian-profile` 和 `.scaffold/c-vault`。
- 在 C 隔离 Zotero 的 Run JavaScript 面板只读检查运行时信息：`Services.appinfo.OS === "Darwin"`，`processID === 10944`，`PathUtils.profileDir` 指向 `.scaffold/c-profile`。设置 `desktopKnowledgeCards` 为启用；从既有 `P02N01` 打开 Bayes 与 Motion 时，两张独立只读知识卡均能加载且内容/公式显示正常。
- 真实 helper 检查失败：打开知识卡后 `ps` 未见 `desktop-overlay-helper`，且 `.scaffold/c-profile/zotero-obsidian-bridge/native-overlay/` 尚未创建。故本轮没有原生 helper ready 握手、快照 ACK、Finder/Obsidian 穿透、跨窗口拖动/滚动、焦点层级、移动跟线或进程退出回收的真实宿主证据；这些项目不得记为通过。
- 根因已定位：`NativeDesktopEdgeOverlayHost.prepare()` 只用 `/mac/i` 判断平台，但 Gecko/macOS 实际回报 `Darwin`，造成生产 runtime 在启动子进程前拒绝平台，且上层按 fail-closed 设计隐藏连线、保留独立知识卡，因此界面看似能开卡而没有桌面线层。
- 修复：平台判断改为同时接受 `mac` / `darwin`；IPC 宿主回归使用实际 Gecko 值 `Darwin`，并增加 Linux 在读取资源/启动 helper 前拒绝的负例。`test:c5-native-overlay-ipc`、`test:c5-desktop-runtime`、`test:c5-desktop-integration`、Prettier、ESLint、生产构建、TypeScript 与 `verify:package` 均通过。
- 修复候选 XPI SHA-256：`1909b437bc1e61bc97ba666bc6a9e4fe3302680ba58a9640f874afe1ab45e6d5`。生成后尚未获准安装；C 隔离 profile 当前仍装原候选 `ad18d0c1…`。不得用重启菜单或 Zotero JS 重启该隔离实例，以免它按默认 profiles.ini 启动到日常 profile；安装获准后必须先退出，再用显式 `-no-remote -profile .../.scaffold/c-profile --dataDir .../.scaffold/c-data` 重启，并核对 PID 参数。
- 下一步仅在该新包获准安装后继续：确认 helper 进程由 C Zotero 启动，观察并验证 ready 能力握手及首个 snapshot ACK；通过 `ping/pong`、移动知识卡观察线段跟随且收到 ACK；在 Finder 和 C Obsidian 测线条与透明区域的点击/拖动/滚动穿透；切换应用焦点与层级；关闭最后一张知识卡等待 helper idle reap，最后退出 C Zotero 并确认进程、提取二进制及 overlay surface 全部回收。若任一阶段失败，记录原始状态并停止伪记后续项通过。

**阶段结论：** C5-C.6–C5-C.8 的代码实现、定向自动化、lint、TypeScript/生产构建及 XPI 完整性检查完成。真实测试必须继续限定在 `.scaffold/c-profile`、`.scaffold/c-data`、`.scaffold/c-vault` 和 `.scaffold/c-queue`；安装当前候选前需确认精确 SHA。C5-C 整体尚不能签收，原因是新候选的真实宿主拖拽/显示器、压力/焦点、配额、生命周期与输入矩阵未完成。C5-D 跨窗口虚线层仍未实现，本轮未改变 C5-A/B 箭头侧边端点和 Bridge 正文锚点算法。

## 2026-11-08 C5-C.6–C5-C.8 真实宿主补测与公式样式修复

### 当前候选与实现修正

- 经用户授权安装的上一候选 SHA `b4abbbb4fff7c407503fbd5eb902052a2dae1a5f4ef63fa46df8212e1e7c7b9b` 正在 C profile 使用；进程 PID `48950` 启动参数只指向 `.scaffold/c-profile` / `.scaffold/c-data`，profile 内安装 XPI 哈希与该值一致。
- 真实子窗核对发现 Bayes 与 Motion 公式重复显示。检查 `.scaffold/c-vault/Mathematics/Bayes.md`、`Physics/Motion.md` 后确认每个公式在源 Markdown 中只写一次；缺失的是独立桌面卡片文档对 KaTeX 无障碍 MathML 副本的视觉隐藏样式。Reader 弹窗已具有同类规则，知识卡样式此前未补。
- 已在 `installNoteUIStyles()` 加入 `.zob-knowledge-body .katex .katex-mathml` 的 visually-hidden 样式，并在 `scripts/test-c3-c4-ui.mjs` 增加回归断言：MathML 仍留在 DOM 供辅助技术读取，但不再与 KaTeX HTML 视觉副本叠显。
- 修复后生产候选 SHA-256 `b47e8be13af9e220dc84d8623b0f9fe60581769510d6a5c681af5a784879cbc0`。构建、lint、定向回归、XPI 完整性检查通过；该新哈希尚未安装，需用户对精确包授权后再做修复效果宿主回归。

### 本轮真实宿主观察

- 在当前 `b4ab...` C 隔离实例中，从 Reader 根卡 P02N01 打开 Bayes、从 Bayes 打开 Motion。两张独立窗口标题、规范路径、Ready 状态与正文身份正确；AX 可读取公式结构和 Motion 图片节点 `Synthetic color grid|66`。放大 Motion 窗后截图确认本地彩色图片已实际显示。
- 截图同时确认内联公式和块公式均出现 KaTeX 渲染结果与可见 MathML 副本，构成真实宿主缺陷；它不是 Markdown 重复写入，也没有编辑/修改 Vault 文件。本候选 C5-C.7 的公式视觉验收 **FAIL**，已由上述新候选修复，仍待安装后重测。
- 对 Motion 使用 `Cmd+W` 后回到 Bayes，Bayes 内容仍在；再对 Bayes 使用 `Cmd+W` 回到 Reader 根卡 P02N01，正文和“已保存”状态仍在。使用卡片关闭按钮也成功回到 Reader 根卡。重新打开知识卡成功；未执行写入、删除、Zotero 批注修改或 Obsidian 编辑。
- 使用系统“zoom the window”辅助操作后，知识卡扩展到显示区域并保持可读；这只证明原生窗口可被系统放大，不等于拖拽越出 Zotero、布局边界校正或跨屏恢复通过。
- CUA 对子窗标题栏拖拽两次均返回 `AXError.noValue`。实际标题栏移动、缩放手柄/最小尺寸、多屏间移动、排列/找回按钮、20 次几何循环、50 次焦点矩阵均未完成真实宿主验证。不得以调用失败或几何单测替代。
- 最终把 C Reader 留在 P02N01 根卡，卡片状态为“已保存”；所有交互仍限 C 隔离 Zotero。未操作 C Obsidian、日常 profile、Main_Learning 或主队列。

### 本轮验证记录

| 检查                                                        | 结果                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `node --experimental-strip-types scripts/test-c3-c4-ui.mjs` | PASS：新增桌面知识卡 KaTeX MathML 隐藏样式断言          |
| `npm run test:c5-desktop-layout`                            | PASS：屏幕边界、负坐标、安全区、排列与小屏降级          |
| `npm run test:c5-desktop-surface`                           | PASS：跨文档只读镜像、图片 URL 生命周期、关闭清理与回退 |
| `npm run test:c5-desktop-windows`                           | PASS：几何事件、防抖、排列和窗口生命周期模拟            |
| `npm run test:knowledge-note`                               | PASS                                                    |
| `npm run lint:check`                                        | PASS                                                    |
| `npm run build`                                             | PASS：生产包及 TypeScript                               |
| `unzip -t .scaffold/build/zotero-obsidian-bridge.xpi`       | PASS                                                    |
| `git diff --check`                                          | PASS                                                    |

### 阶段状态

| 范围                                       | 状态                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| C5-C.6 屏幕几何/布局实现与模拟测试         | **开发和自动化 PASS；真实拖拽、缩放手柄、最小尺寸、多屏和恢复未验收**                  |
| C5-C.7 跨窗口内容/图片/公式/只读与资源清理 | **图片/正文/只读宿主显示通过；旧候选公式显示失败，新候选已修复但尚未现场安装验证**     |
| C5-C.8 快捷键/关闭/回 Reader 与生命周期    | **本轮 Cmd+W、关闭按钮、根卡保留与重开通过；完整焦点、IME、复制/滚动、压力矩阵未完成** |
| C5-C.1–C5-C.5 与 C5-C 整体验收             | **仍未全部签收**                                                                       |
| C5-D 桌面跨窗口虚线层                      | **未开发**                                                                             |

**结论：** C5-C.6–C5-C.8 的代码、自动化与构建工作已完成；新发现的桌面 KaTeX 重复显示已修复并有回归保护。真实宿主验收仍部分未完成，尤其新修复包安装后的公式复测、真实拖拽/缩放/屏幕边界、多显示器、焦点与压力矩阵。当前不能宣布 C5-C 完整验收通过。

## 2026-11-08 KaTeX 样式修复宿主复验

### 安装与环境核对

- 用户授权后，将候选 SHA-256 `6ef73a8fc35d6956a5ca40b893d1fbb1c4153d5f37ba87b00c3da8212cbdead5` 安装到 `.scaffold/c-profile` 并重启 C 隔离 Zotero。PID `51173` 的启动参数明确使用 `.scaffold/c-profile` 与 `.scaffold/c-data`；隔离 profile 内安装 XPI 的 SHA-256 与授权值一致。
- 本次只在 C 隔离 Zotero 查看既有合成测试卡，没有编辑 Markdown、修改批注、写入队列或操作 Obsidian 主库。

### 真实宿主结果

- Bayes 知识卡：行内与块级公式均正常显示为排版后的 KaTeX，视觉上各出现一次；此前可见的 MathML 文本副本不再重复显示。AX 树仍能读取公式内容。
- Motion 知识卡：行内公式 `F = ma` 和块级匀加速公式均正确排版；嵌入的合成彩色图片实际显示，AX 树可识别图片节点。
- 关闭 Motion 子卡后 Bayes 卡仍保持；再关闭 Bayes 后回到 Reader 根卡 P02N01，正文完整且状态为“已保存”。这验证了本次观察到的子卡逐级关闭和根卡保留场景。
- Reader 根卡在整段检查后仍处于打开状态；没有对其正文进行修改。

### 本轮自动化与构建复核

| 检查                                                        | 结果                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run test:c5-desktop-layout`                            | PASS：屏幕边界、负坐标、安全区、排列与小屏降级               |
| `npm run test:c5-desktop-surface`                           | PASS：只读镜像、动态内容、链接委派、Cmd+W 清理与回退         |
| `npm run test:c5-desktop-windows`                           | PASS：窗口身份、配额、迟到事件、就绪/超时/关闭清理与焦点模拟 |
| `node --experimental-strip-types scripts/test-c3-c4-ui.mjs` | PASS：Markdown 安全渲染、公式样式和相关 UI 回归              |
| `npm run lint:check`                                        | PASS                                                         |
| `npm run build`                                             | PASS：生产构建与 TypeScript                                  |
| `unzip -t .scaffold/build/zotero-obsidian-bridge.xpi`       | PASS                                                         |
| `git diff --check`                                          | PASS                                                         |

生产构建在现场验收后重新运行，当前构建目录产物 SHA-256 为 `a6f595c6204b53c502d3c4248213edecf1a341d8b6d31aa499b89541f89e6e4d`；该次构建产物未安装。C 隔离 profile 仍安装并运行经授权、已完成上述宿主复验的 `6ef73a8f...dead5` 包。任何后续安装都应重新核对并授权其精确哈希。

### 阶段状态更新

| 范围                                                                   | 状态                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| C5-C.7 Bayes/Motion 公式样式、只读正文和合成图片                       | **本次真实宿主复验 PASS**                            |
| C5-C.8 逐级关闭子卡并保留 Reader 根卡/已保存正文                       | **本次场景 PASS；完整快捷键、焦点与输入矩阵未完成**  |
| C5-C.6 真实标题栏拖动、调整大小、最小尺寸、整理/找回、多屏与显示器恢复 | **未完成宿主验收**；几何模型自动化通过不替代真实操作 |
| C5-C.1–C5-C.5、配额压力、50 次焦点往返及完整生命周期矩阵               | **仍有未完成的宿主验收项**                           |
| C5-C 整体                                                              | **未签收**                                           |
| C5-D 跨窗口虚线层                                                      | **未开发**                                           |

**结论：** 本轮关闭了桌面知识卡公式重复/未排版的真实宿主问题，并确认图片及本次关闭路径正常；没有据此扩大 C5-C 的验收范围。C5-C 仍不能整体签收，C5-D 也尚未开始。

## 2026-11-08 用户确认拖动/布局与知识卡收纳调整

### 验收状态更正

- 用户确认已完成真实知识卡拖动与布局测试，并要求登记通过。C5C-01 的实际拖出父窗口/拖回，以及 C5C-04 的真实拖动与布局操作现记为 **用户手动验收 PASS**；此前“尚未完成真实拖动/布局”的状态由本记录更新。
- 用户没有报告多显示器拔接、分辨率/缩放变更、睡眠唤醒或完整焦点/输入矩阵的结果，因此这些仍保持待验，不随拖动/布局项一并推定通过。

### 界面实现

- 桌面知识卡窗口使用浅色内容背景。首次候选把 `activetitlebarcolor` / `inactivetitlebarcolor` 移到 XUL 根后，实机标题栏仍为灰色；进一步核对发现 Gecko 已在 Firefox 61 移除这两个属性（[Mozilla Bug 1335191](https://bugzilla.mozilla.org/show_bug.cgi?id=1335191)），因此“移动到 XUL 根”并不能修复当前 Zotero。新方案仅在 macOS 窗口动态设置仍可用的 `chromemargin="0,-1,-1,-1"`，让白色内容背景延伸到标题栏区域，并为卡片内容保留 28px 安全间距；自动化和构建通过，仍需隔离宿主实测。Zotero 10 当前 Mozilla 平台为 Gecko 140.17.0 ESR（应用 `platform.ini`），参照 [Zotero 10 版本记录](https://www.zotero.org/support/changelog)。
- 将路径/只读时间与 Ready 状态收纳在同一个状态详情区。卡片打开 1 秒后自动折叠；标题栏刷新按钮左侧新增状态切换图标，提供展开/收起操作，并同步更新无障碍标签与 `aria-expanded`。
- 用户手动点击后不再被自动折叠计时器覆盖。发生 stale、not-found、forbidden、unsupported 或 error 时，状态区自动展开，以免隐藏错误原因。桌面子窗口通过既有镜像同步按钮与折叠状态；对应逻辑在 `src/services/knowledge-note-card.ts`、`src/services/note-ui.ts`。

### 检查结果

| 检查                                                  | 结果                                                     |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `npm run test:c5-linked-card-group`                   | PASS：一秒自动折叠、按钮展开/收起、按钮顺序及卡组回归    |
| `npm run test:c5-desktop-surface`                     | PASS：macOS 标题栏绘制开关、子窗口动作委派与状态镜像同步 |
| `npm run lint:check`                                  | PASS                                                     |
| `npm run build`                                       | PASS：生产包和 TypeScript                                |
| `unzip -t .scaffold/build/zotero-obsidian-bridge.xpi` | PASS                                                     |

XPI SHA-256 `f344464dcec2e8a1add07748ea556eaab14cacda560711341a74a13e967895eb` 已按授权安装到 `.scaffold/c-profile`（PID 53670）。真实窗口确认状态区约 1 秒后自动折叠，左侧按钮可展开并再次收起；这两项实机 PASS。其标题栏仍为灰色。候选 SHA-256 `db1a23e2f01a7f07acedbcc456a6cf63068440d1f60c0a782bafceb5c30e2c5d` 虽将颜色属性移至 XUL 根，但实机复测仍为灰色，故该尝试未解决问题。

**剩余 C5-C 验收：** 本次用户确认的拖动/布局项已通过；真实多显示器与显示器恢复、50 次焦点往返、配额上限、快速关闭/迟到响应、完整 IME/复制/撤销矩阵、模式切换/停用/重启回收及真实错误回退仍需按矩阵补测。C5-C 未整体签收，C5-D 未实现。

## 2026-11-08 原生标题栏白色外观跟进

- **根因已确定：** `activetitlebarcolor` 与 `inactivetitlebarcolor` 在 Firefox 61 被移除；当前 Zotero 10.0.8 使用 Gecko 140.17.0 ESR，因此不论属性放在 XHTML 还是 XUL 根上都不会改变原生 macOS 标题栏。
- **候选实现 1 结果：** `chromemargin="0,-1,-1,-1"` 仅在窗口 `load` 回调后设置。用户授权安装 SHA-256 `d62d7d74988aaedcf65174a38606ccd50f589f62b08a8855650d9f7dcfe8ec46` 到 `.scaffold/c-profile`；真实窗口仍呈浅灰标题栏，故此候选未通过白色标题栏验收。真实卡片公式正常，状态区已自动折叠且标题按钮可展开。
- **候选实现 2 结果：** 将 `chromemargin` 与 `tabsintitlebar="true"` 提前至 editor 脚本入口后，用户授权安装 SHA-256 `5a1203cdfc8525842c3abb6ee6a34c562b2b17e3c678c6bbb29ea909058ada61` 至 `.scaffold/c-profile`。真实知识卡标题栏仍为浅灰，未通过白色验收；交通灯未被遮挡，Bayes 公式正确显示，状态区自动折叠通过。说明只在脚本入口设置仍不足。
- **修复假设与候选实现 3：** 使用单独的 macOS XUL 文档，在根节点静态声明 `chromemargin="0,-1,-1,-1"`、`tabsintitlebar="true"` 和初始 28px 控件安全区；Windows 等平台仍走原文档。推测 Gecko 在创建原生窗口时读取这些属性，脚本阶段已晚；这是待宿主验证的假设，不代表根因已最终证实。
- **自动检查：** `npm run test:c5-desktop-surface`、`npm run test:c5-desktop-windows`、`npm run lint:check`、`npm run build`、`npm run verify:package`、XPI ZIP 完整性、两份 XUL/XML 解析与 `git diff --check` 均通过。测试断言平台路由、静态属性及非 macOS 使用原窗口。
- **候选包 3：** `.scaffold/build/zotero-obsidian-bridge.xpi`，SHA-256 `63879a9e495808aad85f1953b815d4682260250005e6a7b011491be52be72d42`。用户授权后已安装到 `.scaffold/c-profile` 并重启隔离 Zotero；启动 PID `57938` 的参数指向 `.scaffold/c-profile` / `.scaffold/c-data`，构建产物与安装包哈希一致。
- **候选包 3 宿主结果：** 实际打开 `Bayes · Zotero Obsidian Bridge` 独立卡片，AX 链接目标确认加载 `desktop-knowledge-card-macos.xhtml`。数学公式正确渲染；macOS 红黄绿窗口控制按钮可见且没有被内容覆盖；状态区默认折叠，按钮标签为 `Show card status`。原生标题栏仍显示浅灰色，**白色标题栏未通过验收**。因此在 XUL 根静态声明 `chromemargin` / `tabsintitlebar` 仍不足以实现目标，候选 3 的标题栏假设被实机否证；本次未改卡片正文或批注。
- **结论：** 状态区自动折叠/手动展开、公式渲染、交通灯无遮挡通过；标题栏纯白仍未解决。需要改用可控的自绘标题栏/窗口外观方案做原型，或明确保留系统原生灰色标题栏；当前实现没有证据支持仅靠这组 XUL 属性继续调色。

## 2026-11-08 详情编辑器链接路由与空白带修复

- 用户决定暂不调整 macOS 原生标题栏外观，只移除知识卡标题栏下方的空白带。该空白来自 `#card-host` 被额外下移 28px；已删除这段 CSS 偏移和不再使用的 overlay 标记，保留原生 XUL 标题栏属性。卡片内容现从原生标题栏下方直接开始。
- 详情编辑器预览已有内部链接拦截和知识卡 `open()` 路由，但回调返回 Promise 时此前未等待；初始化/打开异常可能表现为点击无响应。现在等待路由 Promise、显示“正在打开”状态，并将失败原因显示在状态区。
- 新增导航回归：将 `[[Math/Bayes]]` 渲染为 Markdown 预览并点击链接内嵌元素，验证默认跳转被拦截、目标/来源路径/锚点正确传入、异步完成状态和异常反馈。
- 自动检查：`test:note-navigation`、`test:c5-desktop-surface`、`test:c5-linked-card-group`、`test:card-markdown-preview`、`test:c5-desktop-layout`、`test:c5-desktop-windows`、`lint:check`、`build`（含 TypeScript）及 `verify:package` 均通过。
- 候选生产 XPI：`.scaffold/build/zotero-obsidian-bridge.xpi`，SHA-256 `379b1ad75718665657293bb7d79104d74b818c0da6c058514923edb535f8baba`；包体 ZIP 完整性检查通过。
- 目前只有自动化与生产构建验证；新 XPI 尚未安装到 C 隔离 profile，也没有现场点击独立详情编辑器里的预览链接。需在授权安装精确候选后，确认链接打开独立知识卡、关闭子卡不影响编辑器，以及标题栏下方空白带消失。未操作日常 Zotero、Main_Learning 或主队列。

## 2026-11-08 详情链接宿主错误修复

- **隔离宿主根因：** 安装并检查 `379b1ad7...baba` 后，Reader 弹窗和展开详情编辑器均能打开，预览也正确显示 `bay`、`Mathematics/Bayes`、`Physics/Motion` 等链接；但展开编辑器底部出现 `ReferenceError: Zotero is not defined`。详情编辑器运行环境不提供 Zotero 全局对象，而其初始化却直接读取 `Zotero.Prefs` 决定是否启用桌面知识卡面板，导致知识卡导航初始化中断。
- **修复：** 在 Zotero 侧创建 Markdown editor bridge 时读取 `desktopKnowledgeCardsEnabled`，将布尔值随既有窗口参数传给普通详情编辑器和 pending-card 编辑器。详情页只使用 bridge 提供的值，不再直接访问 Zotero 全局对象。这样预览中的内部链接可交给知识卡管理器打开；Reader 的设置仍由 Zotero 宿主读取。未改动日常 profile 或 Main_Learning。
- **空白带：** 延续前一候选中的修复，移除 macOS 卡片内容区域人为增加的 28px 顶部偏移和已废弃 overlay 标记，保留原生窗口标题栏属性。当前需在新候选上实机确认没有额外空白带。
- **回归：** `test:note-navigation` 增加 bridge 开关传递/详情页不直接访问 Zotero 的检查，并覆盖渲染后的 wiki 链接点击、异步路由状态与失败提示。`test:note-navigation`、`test:c5-desktop-surface`、`test:c5-linked-card-group`、`lint:check`、`build`（含 TypeScript）、`verify:package`、XPI ZIP 完整性与 `git diff --check` 均通过。
- **候选 XPI：** `.scaffold/build/zotero-obsidian-bridge.xpi`，SHA-256 `693a13be1614ddb0d78ff53b30d1a692c13b1ac25ba16069170614a5aee5f7ad`。用户授权后仅安装到 `.scaffold/c-profile` 并重启隔离 Zotero，完成了下述宿主复测；此包现已由新候选替换。

## 2026-11-08 详情链接桌面窗口宿主回归

- 用户授权后将 `693a13be...f5f7ad` 安装到 `.scaffold/c-profile`。运行进程参数确认指向 `.scaffold/c-profile` 与 `.scaffold/c-data`，profile 中 XPI 哈希一致。
- **详情页链接回归：** 打开 C0 合成 Reader 批注 `P02N01` 的展开编辑器，依次点击预览中的 `Mathematics/Bayes` 和 `Physics/Motion`。两条均成功显示对应知识卡正文；关闭每张卡后展开编辑器都保持打开、Markdown 内容状态为 Saved。内容没有被修改。
- **新增宿主问题：** 知识卡虽然可打开，但表现为详情窗口内嵌 fallback 卡，而非 C 隔离偏好所启用的独立桌面卡窗口。查代码发现 surface 初始化会在编辑器窗口执行 `createDesktopKnowledgeCardSurface`，其实现依赖 Zotero 宿主全局（例如 `Zotero.getMainWindow()`）；独立编辑器 realm 没有该全局，因此 surface 会失败并降级。第一轮 `Zotero is not defined`（开关读取）已修复；本次暴露的是同一边界上第二个宿主调用未委托的问题。
- **修复：** 将桌面 surface 的创建工厂作为 `prepareKnowledgeCardSurface` 回调放入既有 Markdown editor bridge，由 Zotero 侧构造，并传给普通及 pending 编辑器。编辑器通过宿主回调创建 surface，不再在其 realm 里直接导入/调用依赖 Zotero 全局的工厂。测试增加检查：详情页只从 bridge 取得 surface factory，宿主正常及 pending bridge 都提供 factory。
- **空白带：** CSS 中已删除自加的 28px 顶部 inset，且 macOS XUL 不再含 overlay spacer；由于本次 `693a13be...` 实机调用时降级为内嵌卡，尚未在真正独立桌面卡窗口上验证顶部空白带是否消失。
- **新候选：** `.scaffold/build/zotero-obsidian-bridge.xpi`，SHA-256 `436b81ff66c3cf7cf10b005bacdbcd67849f497aebaac8ef64d8da9c178f2062`。`test:note-navigation`、`test:c5-desktop-surface`、`test:c5-linked-card-group`、`lint:check`、`build`（含 TypeScript）、`verify:package`、XPI ZIP 完整性和 `git diff --check` 均通过。用户授权后仅安装到 C 隔离 profile，并完成以下真实宿主验收。

## 2026-11-08 详情链接及桌面卡最终宿主验收

- 精确候选 SHA-256 `436b81ff66c3cf7cf10b005bacdbcd67849f497aebaac8ef64d8da9c178f2062` 已运行于 C 隔离 Zotero；验收窗口为 C0 Reader Fixture 的展开编辑器 `P02N01`，没有编辑笔记或批注内容。
- 在详情编辑器预览中点击 `Mathematics/Bayes`，成功打开独立原生知识卡窗口，显示 Bayes 正文和公式；关闭子卡后返回原 Markdown 详情编辑器，编辑器仍打开、内容仍为 Saved。
- 点击 `Physics/Motion` 同样打开独立原生知识卡窗口，显示 Motion 正文、公式、图片及其内部链接；关闭子卡后详情编辑器仍保持打开且 Saved。
- 知识卡窗口原生标题栏下方未见额外空白带，卡片内容紧接自定义标题行。按用户要求，原生标题栏颜色和外观不在本次调整范围。
- **本次验收结论：** 详情页预览链接到独立桌面知识卡、子卡关闭后父详情编辑器保留、标题栏下方空白带移除均为真实宿主 **PASS**。本结论仅覆盖本次三个问题，不代表 C5-C 全阶段或 C5-D 已完成；桌面卡其他生命周期矩阵及 C5-D 跨窗口连线仍按前文状态管理。未操作日常 Zotero、Main_Learning 或主队列。

## 2026-11-09 用户确认关联与焦点压力验收

- 用户确认已完成 C5C-02 关联场景真实测试，并要求标记通过；按该用例范围记录别名/重复/循环/片段关联及卡组隔离为 **用户确认实测 PASS**。
- 用户确认已完成 C5C-03 的 50 次根卡/子窗焦点往返压力测试，记录该焦点压力子项为 **用户确认实测 PASS**。
- 本次确认未提供单独的候选包哈希或运行记录，因此证据类型标记为用户现场确认，不推定为独立采集的日志/录屏。也不据此推定草稿、写入队列及其他子卡保持不变等额外断言已通过。
- C5-C 整体仍未签收：多屏/显示器恢复、最小尺寸与完整几何矩阵、真实配额上限、快速关闭/迟到响应/错误回退、完整生命周期与数据安全核验等仍按上表待验；C5-D 桌面跨窗口虚线层仍未开发。

## 2026-11-09 C5-D.1–D.4 实现与自动化核验

### 代码实现

- **D.1 可行性探针：** 在插件偏好页增加限时 20 秒的桌面叠加测试与手动停止按钮。探针用 `screenForRect` 找到当前显示器，在屏幕逻辑坐标创建临时顶层 XUL panel，绘出虚线、边界和提示；正常到期、手动停止或偏好窗口卸载都会关闭 surface。宿主声明的透明、非激活、层级、系统鼠标穿透、原生拖动跟随能力仍全部为 `false`，不因探针可以显示 SVG 就自动提升为可用。
- **D.2 几何与显示器采样：** 复用 Gecko 顶层/iframe 几何转换，把可见、未裁剪的 DOM 锚点变换为桌面逻辑坐标；保留负屏幕坐标。用 Gecko `nsIScreenManager.screenForRect` 沿全局曲线路径采样显示器，并按显示器矩形裁切同一条曲线。测试覆盖不同屏幕原点、iframe transform、缩放、透视拒绝和拓扑代次。真实屏幕校准未做。
- **D.3 生产根锚点：** `DesktopKnowledgeCardSurface` 已将 `KnowledgeCardSurface` 的 root/edge anchor、语义关系和打开知识卡的原生标题栏矩形接到桌面投影与路由；来源使用独立链接出现序号，知识窗端点使用左右侧边，双向关系去重。元素隐藏、离开裁剪区域或文档不可见时不沿用旧矩形。线层处于能力关闭状态时不会绘制。
- **D.4 共享绘线层：** 已实现每个 Zotero 进程按显示器复用 surface 的 manager；SVG path 使用同一全局三次曲线、每屏局部坐标和端点唯一箭头。组关闭只移除本组，拓扑变化先关旧 surface 再请求重采样；surface 初始化/绘制异常立即 fail-closed。未验证能力时在显示器采样前就拒绝请求，确保暂不开线不会带来逐帧屏幕服务开销。
- 未加入 AppKit helper、权限提升、网络 IPC 或系统级鼠标事件转发。

### 自动验证

| 命令                                                                  | 结果 | 覆盖范围                                                                            |
| --------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `npm run test:c5-desktop-xul-overlay`                                 | PASS | XUL panel 屏幕定位、顶层/无焦点属性、透明/非命中样式、SVG 曲线/箭头、到期与手动回收 |
| `npm run test:c5-desktop-integration`                                 | PASS | 负坐标/跨屏采样、锚点裁切与隐藏、根卡 Bayes/Motion 独立行锚点、双向去重和侧边路由   |
| `npm run test:c5-desktop-runtime`                                     | PASS | 未验证后端在屏幕采样前拦截，不建 surface；runtime 可清理                            |
| `npm run test:c5-desktop-geometry`                                    | PASS | iframe、transform、缩放、负坐标、backing calibration、拓扑代次                      |
| `npm run test:c5-desktop-edges`                                       | PASS | occurrence、隐藏回退、侧边端点、双向去重及关系代次                                  |
| `npm run test:c5-desktop-overlay`                                     | PASS | 假 host 下的门控、多屏共享、组隔离、端点箭头和错误清理                              |
| `npm run test:c5-desktop-surface` / `npm run test:c5-desktop-windows` | PASS | 生产知识窗 surface、链接/资源/快捷键、身份生命周期及窗口清理回归                    |
| `npx tsc --noEmit` / 定向 ESLint                                      | PASS | 类型与本轮桌面模块、设置绑定和测试脚本                                              |

### 宿主验收矩阵

| 指标                               | 状态                  | 说明                                                                                                                                                                                |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D.1 显示与系统级鼠标穿透           | **PARTIAL**           | 旧 XUL 探针透明处一次点击通过；新 AppKit 原型精确 SHA `b5df8643…c4886a` 的虚线覆盖 Finder 可见，用户确认线段与透明空白两处点击均穿透。拖动/滚动仍未测，AppKit 原型未集成进 Zotero。 |
| D.1 非激活、层级、原生拖动期间更新 | **NOT ACCEPTED**      | 透明区点击的底层响应有记录，但未能观察/证明 overlay 在跨应用激活后持续处于正确层级，也未验证原生拖动期间跟随。                                                                      |
| D.2 多屏/混合缩放校准              | **NOT RUN**           | 目前仅有合成屏幕和自动变换断言。                                                                                                                                                    |
| D.3 Reader/展开详情窗端到端线锚点  | **BLOCKED / NOT RUN** | 生产线层保持关闭，尚未在 Reader 真正看见根链接行与子卡侧边线。                                                                                                                      |
| D.4 跨屏绘制、共享、错误关闭       | **AUTOMATED ONLY**    | 假 surface 生命周期回归通过；真实 XUL widget 的系统层级、透明度和失效撤场未测。                                                                                                     |

**本节记录时的结论：** D.1–D.4 的插件代码和自动化开发已完成；真实宿主验收仍未完成。生产 capability gate 仍关闭，因此当前不会绘制跨窗线。精确候选在 C 隔离 Zotero 的透明探针区域通过一次 Finder 点击响应测试；CUA 无法稳定驱动后台窗口的拖动/滚动，故这两项及 D.1 的完整系统能力证据尚缺。下一步应在 C 隔离环境完成虚线命中、拖动、滚动和 overlay 层级观察；若 Gecko XUL panel 不能证明系统级鼠标穿透/非激活/拖动随动，则停止纯插件生产集成，提交能力矩阵并重新评估经用户单独批准的原生路线。D.5–D.8 的后续进展见本报告末尾补充。没有触碰日常 Zotero、Main_Learning 或主队列。

## 2026-11-09 C5-D.1 探针真实宿主补测

- 用户授权精确候选 SHA-256 `0c54e3010871ef5bae5cc984c0d146870f27a4eb87037442c9143f578249afec` 仅安装到 `.scaffold/c-profile`；隔离 Zotero 重启 PID `75556`。安装前校验 profile/data 路径、候选与现有安装哈希；旧包备份在 `.scaffold/c-install-backups/1794160412071-zotero-only`。未操作日常 Zotero、Main_Learning、主 Vault 或主队列。
- 在 Zotero 偏好页运行最长 20 秒的中心屏幕探针。探针显示启动，并在限时后自动关闭；未更改 Reader 注释、文献或 Finder 文件内容。
- 探针时在 Finder 的 `/Applications` 列表视图中，对显示器中央透明探针区域内的 `VBT` 项目坐标执行单击；AX 状态显示 `VBT` 变为 selected，Finder 状态栏显示选择 1 项。记录为 **透明处单击到达底层应用：PASS（一次）**。本次没有点击虚线本身，因此线段 hit target 不判通过。
- CUA 对后台 Finder 拖动/滚动输入返回 `noWindowsAvailable`，未能形成有效手势或结果。拖动/滚动记录为 **NOT RUN**，不据此判定实现失败或通过。Finder 已返回原 iCloud 目录图标视图；仅测试时临时选择状态已清除。
- 系统截图接口按目标窗口取图，未得到可以证明 overlay 在 Finder 前方持续显示的全桌面证据。因此非激活、跨应用 z-order 稳定性、透明空白处与虚线分别命中、拖动/滚动、原生拖动跟随仍 **NOT ACCEPTED**。D.2 多屏混合缩放、D.3 生产 anchor 端到端及 D.4 真实跨屏共享/异常撤场状态不变。
- 本次 UI 仅验证了探针能运行与一个透明区域点击可达。生产 `capabilities` 仍全部为 false，overlay runtime 仍 fail-closed；没有启用生产连线。

## 2026-11-09 C5-D.5–D.8 实现与自动验收

### 实现范围

- **D.5 卡片避障：** 知识卡之间仍使用左右侧边双箭头。路由器先保留无遮挡曲线；发生遮挡时，在有界外侧水平车道集合中采样并选择无冲突的三次曲线。投影层把可见的第三方知识窗完整矩形作为障碍。若任何相关可见卡片的窗口几何未知，则省略该知识卡间连线，不猜测位置；Bridge 正文链接继续使用各自精确链接文字锚点，不使用卡片避障。
- **D.6 层级与可见性：** 线组按 group 隔离显隐；文档转后台会隐藏线组，恢复时请求刷新；一组过期/刷新抛错不会阻断其他可见组。宿主能力仍由 D.1 全量门禁控制，未验证时不会创建生产绘线 surface。
- **D.7 调度与性能：** geometry 更新只由窗口、锚点、内容和拓扑事件触发，并以 `requestAnimationFrame` 合并；不建立静止状态的轮询。加入不含笔记正文的性能快照，保留最多 256 个样本，记录请求合并、帧耗时百分位及最大卡/边数量。
- **D.8 安全与资源上限：** 增加每进程最多 32 组、每组最多 256 条线、总计最多 512 条线、最多 16 个显示器、路由阻挡路径最多 16 项，以及标识/坐标/矩形/路由状态校验。仍不含原生 helper、IPC、额外权限或网络端口；任一 host 能力未知、几何无效或 surface 出错均 fail-closed。

### 自动验收与产物

| 检查                                                                                                        | 结果                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run test:c5-desktop-routing`                                                                           | PASS：直线路由保留、侧边端点、第三卡绕行、不可解降级、未知障碍拒绝及 Bridge 正文链接豁免 |
| `npm run test:c5-desktop-edges` / `npm run test:c5-desktop-integration`                                     | PASS：独立正文行锚点、关系去重、裁切/隐藏、桌面坐标和生产投影回归                        |
| `npm run test:c5-desktop-overlay`                                                                           | PASS：分组显隐、能力变更关闭、几何元数据与组/曲线总量上限、异常清理                      |
| `npm run test:c5-desktop-runtime` / `npm run test:c5-desktop-xul-overlay`                                   | PASS：后台组刷新异常隔离、未验证后端不采样/不建窗、限时探针与回收                        |
| `npm run test:c5-desktop-surface` / `npm run test:c5-desktop-windows` / `npm run test:c5-linked-card-group` | PASS：生产 surface、卡片窗口注册/关闭/焦点与 C5-A/B 关系回归                             |
| `npm run test:c5-desktop-performance`                                                                       | PASS：有界样本、请求合并计数、百分位及无效样本拒绝                                       |
| `npx tsc --noEmit` / 定向 ESLint / 定向 Prettier                                                            | PASS                                                                                     |
| `npm run build` / `npm run verify:package` / `unzip -t` / `git diff --check`                                | PASS；XPI SHA-256：`1c04e6501a4a6a16161fee001748bf33a2baaf71acfd0e1ccf89615f73424125`    |

### 真实桌面验收状态

| 子阶段                               | 状态        | 未完成原因                                                                                                    |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| D.5 绕过卡片并显示两端箭头           | **BLOCKED** | 自动路径几何通过；生产 overlay 的系统级穿透/非激活/层级能力未通过 D.1，生产线层被关闭，无法观察实际卡片画面。 |
| D.6 应用切换、Spaces、全屏与恢复     | **BLOCKED** | runtime 生命周期由模拟 host 覆盖；当前无已验证的系统级绘线窗口。                                              |
| D.7 原生拖动跟随、8 卡 p95、静止 CPU | **NOT RUN** | 这些指标必须在线层真实显示时采集；本轮没有把单元测试耗时冒充真实桌面结果。                                    |
| D.8 故障撤场与发布包安全             | **PARTIAL** | 输入限制、fail-closed 和 XPI 结构/内容审计自动通过；真实宿主线层崩溃撤场不适用/未测，且没有新增原生组件。     |

本轮**未把新候选安装到 C 隔离 Zotero**：先前安装许可绑定旧 SHA `0c54e301…afec`，不覆盖本次产物；而当前能力声明全部为 false，安装后生产线层仍不会显示。没有操作日常 Zotero、Main_Learning 或主队列。D.5–D.8 的代码及自动验收完成；桌面可视验收不能越过 D.1 门槛，故 C5-D 和整个桌面跨屏连线目标仍未通过。继续前需完成 D.1 系统能力验证，或经单独设计/批准引入能满足门槛的原生后端，再对新精确候选做宿主验收。

## 2026-11-09 C5-D.1 macOS AppKit overlay 原型

- 按用户授权新增独立 Swift/AppKit 限时探针 `native/macos/desktop-overlay-probe.swift`，构建脚本为 `scripts/build-c5-native-overlay-probe.mjs`，自动检查为 `npm run test:c5-native-overlay-probe`。探针创建透明、无激活、忽略鼠标的全屏 `NSPanel`，显示合成虚线弧及箭头，默认 20 秒自动退出；支持 stdin `{"op":"stop"}` 提前关闭。不申请辅助功能/屏幕录制权限，不安装登录启动项，不访问 Zotero/Obsidian 数据，也未将该 helper 打入 XPI。
- 被批准并实际运行的精确 arm64 helper SHA-256：`b5df8643ef3ba06b9cd3ce544dbbcd6d621cd3c6443b27f4ce158feb92c4886a`。探针启动输出报告屏幕逻辑尺寸 `2048×1152`、backing scale `2`，panel 配置为透明、non-activating、忽略鼠标、floating level；这只是配置/启动证据，不单独视为功能通过。自动 20 秒到期与 stdin stop 均观察到进程正常退出。
- 用户在 Finder 前台观察并确认：浅蓝虚线跨 Finder 可见；点击虚线覆盖的应用条目与旁边透明空白均穿透到 Finder（用户报告“可见且两处均穿透”）。此项记录为 **AppKit 原型可见性/两个点击点穿透：用户现场确认 PASS**。没有录屏或独立事件计数日志；CUA 当前仅提供 Finder 窗口截图，坐标点击返回 `noWindowsAvailable`，所以不把自动化输入能力误记为桌面测试证据。
- **仍未通过/未测：** overlay 是否在应用激活切换后持续保持所需层级且不抢焦点；透明区域和线条上的拖动、滚动完整事件；Zotero 知识卡原生拖动期间线条坐标更新；多显示器/Spaces/全屏；辅助组件与插件的进程间协议、生命周期、签名/公证、更新和崩溃回收。探针是 standalone prototype，不是生产集成；生产 capability gate 继续全部关闭，不会绘制产品连线。D.1 仅部分验证，D.2–D.8 的既有状态不因本探针改变。

## 2026-11-09 Zotero 与 AppKit 绘线进程 IPC/生命周期集成

### 方案与实现

- Zotero 仍持有桌面锚点、窗口几何和曲线状态；macOS helper 只负责创建每屏透明绘制 panel 并渲染收到的曲线快照，不读取 Vault、Markdown 正文或 Zotero 数据库。
- helper 作为 XPI 内的 universal macOS executable，架构为 `arm64` 与 `x86_64`。Zotero 通过 Gecko `Subprocess.call` 使用参数数组直接启动，不经过 shell；运行时从打包资源读取 helper 和 manifest，验证 SHA-256 后以 `0700` 权限提取至当前 Zotero profile 的插件私有目录。插件退出/宿主 dispose 后删除提取的可执行文件；闲置 2.5 秒则优雅停止进程但保留同版本缓存，供后续快速重开。
- IPC 使用 stdin/stdout 上的 UTF-8 JSON Lines，协议版本为 1。启动时 helper 回报 PID、parent PID、显示器几何及透明、非激活、层级、鼠标穿透、多屏、拖动更新能力；Zotero 只有在版本和全部能力字段通过握手后才启用绘线 surface。
- 每个 sync 快照带单调 generation，包含最多 16 个显示器和最多 512 条曲线；快照要求 ACK。发送中的帧不会重复堆积，未发送的中间状态会被最新快照合并替代。`ping/pong` 用于探活；单帧限 1 MiB，Swift 端按 64 KiB 分块读取并逐帧限长，丢弃超大帧直到下一个换行。
- 正常退出先发 shutdown 并等待 ACK，再关闭 stdin、等待 helper；超时后 kill 并回收。helper 在 stdin EOF 或 parent PID 消失时关闭所有 panel 并退出。协议版本错、哈希错、无效显示器映射、ACK 超时或 helper 崩溃都会 fail-closed，清除已验证能力并关闭线层。插件 shutdown 会等待所有 runtime dispose。
- 发现并修复了两个 IPC 生命周期问题：Node/macOS 自动化环境误将 `navigator.platform` 当作 Zotero 宿主，导致试图 fetch `chrome://`；现在平台判定以 Zotero `Services.appinfo.OS` 为准。另修复 spawn 失败时握手 Promise 未处理拒绝、失败回调同步清理覆盖错误原因，以及失败后无法显式复位重试。

### 自动验收与构建产物

| 检查                                  | 结果                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:c5-native-overlay-ipc`  | PASS：握手/版本错、启动失败与清理竞态、显式重试、快照 generation/ACK、latest-frame 合并、ping、ACK 超时 fail-closed、优雅关闭、超时 kill、profile executable dispose 清理 |
| `npm run test:c5-desktop-runtime`     | PASS：未验证 host 在显示器采样前 fail-closed，runtime dispose 可重复调用                                                                                                  |
| C5 桌面自动回归                       | PASS：surface、布局、linked group、窗口/焦点、几何、多屏投影、overlay、安全门控、集成、路由、性能、runtime 与 IPC 测试均通过                                              |
| `npm run build`                       | PASS：生产 XPI 构建及 `tsc --noEmit`                                                                                                                                      |
| 定向 ESLint / Prettier                | PASS：IPC client、native host、runtime、helper builder、package audit 和 IPC tests                                                                                        |
| `npm run verify:package` / `unzip -t` | PASS：64 个归档条目；helper 与 manifest SHA-256 一致；XPI ZIP 无损坏、无测试数据泄漏                                                                                      |
| Universal helper architecture         | PASS：`lipo` 确认 `arm64 x86_64`；包内 manifest 与 standalone 构建 manifest 的 SHA 均为 `36b10313dd6ec075705f17be848a2282809427353a9257ee7091431b82af9956`                |

- 精确集成候选：`.scaffold/build/zotero-obsidian-bridge.xpi`，版本 `0.1.0`，SHA-256 `ad18d0c1008b58cda4d008c85d7acb694f6c26d86b47d7fc4aa48e6d493e0fce`。
- 此 XPI 尚未安装到任何 Zotero profile。它新增并会启动本地原生 helper；需要对这个精确哈希的 C 隔离 profile 安装/重启另行确认。此前独立短时 AppKit 探针的用户确认只证明 standalone `NSPanel` 的虚线可见及线段/透明区点击穿透，不是此集成 XPI 的宿主证据。

### 集成宿主验收矩阵

| 项目                               | 状态                                | 验收标准/限制                                                                                                          |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Zotero 子进程启动与协议握手        | **待测**                            | 仅在 `.scaffold/c-profile` 启动；确认真实 `Subprocess` API、资源读取、profile 提取、权限、ready/能力握手与至少一帧 ACK |
| 线与透明区点击穿透                 | **standalone 探针通过；集成包待测** | 用集成 XPI 在 Finder 及 C 隔离窗口验证线段/透明区点击到达底层应用，Zotero/helper 不抢焦点                              |
| 拖动及滚动穿透                     | **待测**                            | 对覆盖线段与透明区分别完成真实拖动和滚轮滚动；底层应用收到输入且辅助线不拦截                                           |
| 根卡/知识卡拖动时线条更新          | **待测**                            | Reader 与知识卡原生拖动期间观察连线持续跟随，停止后端点误差收敛；检查 helper ACK/更新不堆积                            |
| 应用焦点、层级与窗口生命周期       | **待测**                            | 切换 Finder/Zotero/C Obsidian、关闭卡组、隐藏/恢复 Reader；panel 不激活、不留孤儿，重新显示能恢复                      |
| helper 正常关闭、崩溃、Zotero 退出 | **自动化通过，真实进程待测**        | 闲置停止、显式 shutdown、EOF、parent 退出、崩溃/超时及 plugin shutdown 后无遗留进程或 profile 临时可执行文件           |
| 多屏与混合缩放                     | **自动化/编译覆盖，实机待测**       | 显示器矩形一一匹配；不匹配时关闭绘线；跨屏曲线、拓扑变化与重连均检查                                                   |

**当前结论：** 通信协议、进程状态机、包内原生资源和自动化生命周期已完成；集成 XPI 还未在 Zotero 运行。D.1 的 standalone 可行性得到用户现场确认，但 D.1 集成通信/穿透/焦点/随动及真实拖动、滚动仍待精确包宿主验收。未把自动测试或旧 standalone 探针结果冒充为集成通过；未操作日常 Zotero、Main_Learning、C Obsidian、主 Vault 或主队列。

## 2026-11-09 C 隔离 Zotero 集成宿主验收

### 环境与产物

- 用户授权的精确 XPI SHA-256 `1909b437bc1e61bc97ba666bc6a9e4fe3302680ba58a9640f874afe1ab45e6d5` 已安装到 `.scaffold/c-profile`。Zotero 进程 PID `15289` 的启动参数确认使用 `.scaffold/c-profile` 与 `.scaffold/c-data`；本次没有操作日常 Zotero、Main_Learning 或主队列。
- C 隔离 Obsidian 进程 PID `3065` 指向 `.scaffold/c-obsidian-profile` / `.scaffold/c-vault`，测试中保持其原状态，没有切换或修改 Vault 内容。
- 活跃卡组期间观察到原生 helper PID `16698`，其父 PID 为隔离 Zotero `15289`，可执行文件位于 `.scaffold/c-profile/zotero-obsidian-bridge/native-overlay/`，启动参数含 `--daemon --parent-pid 15289`。helper 二进制 SHA-256 与包内 manifest 声明一致：`36b10313dd6ec075705f17be848a2282809427353a9257ee7091431b82af9956`。

### 现场结果

| 验收项                           | 结果                     | 证据与边界                                                                                                                                                                                                              |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 精确包安装与隔离                 | **PASS**                 | 已安装 XPI 哈希与授权值一致；进程参数落在 C 隔离 profile/data。                                                                                                                                                         |
| helper 启动与握手路径            | **PASS（宿主行为证据）** | 有效知识卡组活动时观察到 helper 为 Zotero 子进程；产品代码只有在版本化 `ready` 握手及必需 capability 全部通过后才允许 runtime 建立 surface。未保留原始 JSONL `ready` 帧日志，故证据是宿主行为与代码门控，不是协议抓包。 |
| 快照 ACK                         | **PARTIAL**              | IPC 客户端为每个 generation 等待 helper 的 sync ACK，超时会 fail-closed；卡组在现场保持可用且未观察到错误撤场，但没有可读的 ACK 帧/计数日志，不能把它记为直接观测通过。                                                 |
| 独立知识卡与内容                 | **PASS**                 | 从根 Bridge 卡分别打开 Bayes、Motion 独立原生窗口；正文和公式显示正常，Motion 图片也显示。                                                                                                                              |
| 滚动                             | **PASS（卡片内部）**     | 在知识卡正文区域滚动，内容视口改变，窗口和 helper 未崩溃。此项不等同于鼠标穿过系统 overlay 后滚动底层其他应用。                                                                                                         |
| 焦点与 `Cmd+W`                   | **PASS（卡片关闭语义）** | `Cmd+W` 先关闭 Motion 子卡并回到 Bayes；再次按下关闭 Bayes 并回到 Reader 根 Bridge。根卡内容保留、状态为 Saved；点击 Reader 外部再关闭根弹窗。未验证跨应用切换时 helper overlay 不激活/不抢焦点。                       |
| helper 闲置回收与重新启动        | **PASS（正常路径）**     | 关闭根 Bridge 后等待约 4 秒，进程检查只剩 Zotero、无 helper；重新打开知识卡时再次观察到 helper 子进程。未进行 helper 强杀、Zotero 崩溃或宿主异常退出测试。                                                              |
| 集成 overlay 虚线跨应用可见      | **未验证**               | 当前 CUA 画面未能可靠观察到独立 AppKit 绘线层，因此不以 standalone 探针的可见性结果替代集成包结果。                                                                                                                     |
| 线段/透明区域点击穿透            | **未验证（集成包）**     | standalone 探针此前由用户确认线段与透明区均穿透 Finder；这次没有在集成 helper overlay 上复现并确认。                                                                                                                    |
| overlay 上的底层拖动/滚动穿透    | **未验证**               | 卡片内部滚动通过；集成 overlay 覆盖 Finder/Zotero 的真实鼠标拖动与滚轮传递没有取得结果。                                                                                                                                |
| 原生卡片拖动、实时跟线与边缘移动 | **未验证**               | CUA 对窗口标题栏/自定义标题的拖动尝试没有改变窗口位置，输入目标未被可靠命中；因此不判为功能失败，也不能判为通过。卡片移动期间连线更新未能观察。                                                                         |
| 应用切换、层级、多屏/Spaces      | **未验证**               | 没有完成 Finder、C Obsidian、Zotero 间的层级/非激活验收，也未覆盖多显示器、混合缩放、Spaces 或全屏切换。                                                                                                                |

### 结论

本轮真实宿主证实了**精确 XPI 隔离安装、helper 子进程启动/正常闲置回收及重启、知识卡内容、卡片内部滚动与 `Cmd+W` 关闭层级**。协议实现有 ready/ACK 等待与超时 fail-closed，但宿主侧没有原始 ready/ACK 帧记录，故 ACK 只记部分通过。最核心的 C5-D 目标——集成虚线跨应用显示、点击/滚动穿透、卡片原生拖动时连线实时跟随、应用焦点/层级与多屏——仍未完成真实验收。standalone 探针的用户确认仍只适用于 standalone 原型，不能外推为生产集成通过。测试只在 C 隔离环境执行，未修改批注或卡片正文。

## 2026-11-09 原生标题栏纯白 CSS 复验

- 用户授权的候选 XPI SHA-256 `82d8c297aff5adafaddfa852510267c0f6d4a85c999268670e5934632c06eab4` 已仅安装到 `.scaffold/c-profile` 并重启 C 隔离 Zotero。独立 Bayes 知识卡内容与公式正常，但原生标题栏仍呈灰色，纯白验收失败。
- 本候选尝试对 XUL 根窗口设置 `-moz-appearance: none` 与白色背景，并单独覆盖失焦状态；真实宿主没有改变标题栏颜色。该无效 CSS、标记属性和对应断言已从源码移除，避免把内容背景误当作原生标题栏样式。
- **判断：** 当前 XUL `openDialog` 窗口的原生 macOS 标题栏不受插件内容 CSS 控制。实现全白需要改用自绘标题栏/窗口装饰原型，并重新处理窗口拖动、原生交通灯按钮、最小化/缩放/关闭、焦点与 `Cmd+W`。当前版本保留原生标题栏，不宣称纯白已实现。

## 2026-11-09 桌面连线拖动性能优化

### 定位与修复

- 发现 `DesktopEdgeOverlayRuntime.applyGroup()` 每次几何更新都会先调用 `manager.setGroup()`，再无条件调用 `manager.setGroupVisible()`。两个方法各自执行完整的 overlay render、曲线分屏与 surface 更新；可见状态已由 group 保留，因此第二次 render 是冗余工作，现已移除。
- 原生 surface 对同一可见状态重复执行 `show()`，现改为状态变化时才发同步请求；运行时和 native surface 不再逐层复制本帧新建且只读使用的曲线数组。
- 曲线避障与分屏前加入控制点凸包的快速包围盒筛选，不相交时跳过逐点采样；几何/关系算法、曲线锚点和路径输出规则不变。
- 原生窗口位置轮询发现卡片移动后，旧路径还会再排一个动画帧才投影/提交曲线。现在轮询帧直接刷新该帧的几何，并取消同一窗口事件已排队的重复刷新；随后又发现原生 move/resize 事件本身仍走延后调度，现对确实改变的窗口矩形直接刷新连线，轮询保留为兜底且相同矩形不会重复绘制。
- AppKit helper 以前每个快照都使整块显示器绘制视图失效。现在仅将旧/新曲线的保守包围区域标为 dirty，并在 `draw` 时跳过未与 dirty 区域相交的曲线；显示器面板的位置和层级仅在实际需要时更新。
- 拖动期间原先多个诊断路径可能每帧各自执行同步落盘。现在几何快照、IPC 事件环和 rendered ACK 分别限频合并写入（500ms），保留最新 ACK、累计 ACK 数和 `roundTripMs`，以便实际拖动时区分几何耗时与 helper/IPC 往返延迟。

### 自动检查

| 检查                                                                      | 结果                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `scripts/test-c5-desktop-edge-diagnostics.mjs`                            | PASS：60 帧 ACK/IPC trace 合并落盘、保留最新 generation 和往返时间、环形记录有界                                |
| `npm run test:c5-native-overlay-ipc`                                      | PASS：协议、ACK 往返指标、latest-frame 合并与 helper 生命周期；并锁定局部 invalidation/绘制及可见面板不重复置前 |
| `npm run test:c5-desktop-runtime`                                         | PASS：每个几何更新只触发一次 overlay render，运行时清理及显隐行为通过                                           |
| `npm run test:c5-desktop-routing` / `npm run test:c5-desktop-overlay`     | PASS：避障结果、侧边锚点、多显示器箭头与 fail-closed 回归                                                       |
| `npm run test:c5-desktop-integration` / `npm run test:c5-desktop-surface` | PASS                                                                                                            |
| `npm run test:c5-desktop-windows`                                         | PASS：轮询发现窗口移动时在当前 display frame 直接通知绘线，不再安排冗余下一帧                                   |
| `npm run test:c5-desktop-performance`                                     | PASS：既有帧调度/性能指标边界回归                                                                               |
| 定向 ESLint / Prettier / `git diff --check`                               | PASS                                                                                                            |
| `npm run build` / `npm run verify:package` / `unzip -t`                   | PASS：TypeScript、arm64/x86_64 AppKit helper 编译、64 项包审计及 ZIP 完整性                                     |

### 宿主验收状态

- 上一候选 `.scaffold/build/zotero-obsidian-bridge.xpi`（SHA-256 `9cfdeb55056da4eeffe898c681799a6448c6dcff02c65f4d2e690733e7d216a0`）已按用户授权安装到 `.scaffold/c-profile` 并重启隔离 Zotero，PID `75734`。CUA 在 Reader 打开 Bridge 根卡，并成功打开 Bayes 与 Motion 独立知识卡；公式与正文均正常。
- 真实窗口拖动未能由 CUA 完成：它能操作卡片内容区，但对 macOS 原生标题栏拖动无可验证的位置变化。因此不能据此判定拖动跟线或主观流畅度通过。采样期间几何计数为 2,727 次请求、2,143 次合并、583 次实际帧；几何交付 p95 `19 ms`、绘制 p95 `4 ms`，最多 2 卡/3 边。
- 同期 helper 记录 415 个 ACK；可读的最近 8 个 ACK 样本往返 p50 `1 ms`、p95/max `2 ms`。活动曲线时收到 `rendered`、3 曲线 ACK；最终快照为 0 active/visible windows、0 曲线。样本量有限，不足以证明持续拖动吞吐，但说明 helper IPC 往返不是当前主要延迟来源。
- 候选 SHA `85f3585e8ff6b1414ee8a0fc86009ec9abb1c31ec03adb6c63163c588b2c8a0f` 后已获准安装到 `.scaffold/c-profile`，隔离 Zotero PID `78396` 加载该包；用户实测仍感觉拖动卡顿。CUA 无法可靠命中原生标题栏，无法产生受控拖动序列。其后诊断快照显示 helper ACK 往返在 `1–18 ms` 范围，但采样时 overlay 为隐藏、0 条曲线，且没有连续拖动期间的 ACK 时间序列，因此不能把该数据当作拖动帧率，也不能据此认定 helper 已排除。
- 后续检查发现 `move/resize` 事件 handler 仍把已变化的几何排入另一个动画帧，形成可避免的反馈延迟。现已改为事件确认矩形变化后立即重算并提交曲线；逐帧轮询继续兜底，事件与轮询共享上次矩形以避免重复提交。`npm run test:c5-desktop-windows` 新增并通过“move 事件同调用栈刷新”回归；desktop surface、integration、runtime、performance、定向 ESLint/Prettier、生产构建和 `verify:package` 均通过。
- 新候选已按用户授权安装并启动：`.scaffold/c-profile/extensions/zotobsidian-bridge@qianzhouji.xpi`，SHA-256 `8314ccc16bd42e0c745104ba4c6725d3dc0d30e3b434371f894a32e16a3b5f9f`；C 隔离 Zotero PID `81566`，插件状态 active，启动参数指向 `.scaffold/c-profile` / `.scaffold/c-data`。CUA 已核对 C0 Reader 中点击 `P02N01` 高亮可正常打开 Bridge 编辑卡且原有内容在场；自动化不能可靠拖动 macOS 原生标题栏，所以新的手动拖动流畅度及连续拖动帧/ACK 采样仍待用户复测。
- 没有操作日常 Zotero、Main_Learning、主 Vault 或主队列。本轮不改变 C5-D 的真实桌面验收状态。

## 2026-11-10 C5 多屏与线层穿透验收状态同步

- **C5C-04 多屏/显示器项目：用户确认真实测试通过。** 本次确认没有附显示器拓扑、缩放比例、事件记录或候选包哈希；因此仅按用户所述的多屏/显示器测试范围记为 PASS，不擅自扩展为分辨率变化、拔屏/重连、睡眠唤醒及最小尺寸全矩阵均通过。
- **C5D-04 点击/滚动穿透：用户确认真实测试通过。** 用户确认线段/透明区域下层点击及滚动正常。事件次数、底层应用逐项计数和候选哈希未归档；本记录不声称完成原矩阵中每场景 20 次及所有目标应用计数，也不推定拖动穿透通过。
- **C5D-07 多屏/显示器项目：用户确认真实测试通过。** 记录范围限于用户确认的多屏/显示器项目；混合缩放、负坐标、断屏恢复等更细场景如未包含在本次实测中，仍须单独核验。
- **前台显隐：** 用户确认切回 C 隔离 Zotero 前台后连线恢复。此前后台隐藏行为有单独诊断记录；本条不代表 Spaces、全屏、Stage Manager 或睡眠/唤醒完整矩阵通过。
- **阶段结论：** 以上项目现为用户现场确认 PASS，但没有对应的精确候选 SHA-256 与原始计数/录屏，证据等级按“用户确认”保留。C5-C/D 仍未整体签收；配额、最小边界、快速关闭/迟到响应、性能量化、helper 异常退出/重启回收、系统窗口管理、安全回退及同一精确候选整链路验收仍待完成。

## 2026-11-10 C5 自动化收尾复核

### 自动化与构建

本轮在当前工作树执行以下检查，全部通过：

| 范围                                                                                                                                                              | 结果                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| C5-A/B 关系与卡组：`test:c5-visible-relations`、`test:c5-linked-card-group`                                                                                       | PASS：独立锚点、自动可见关系、去重、循环/菱形、组隔离、布局边界及收起             |
| 桌面窗口：`test:c5-desktop-surface`、`test:c5-desktop-layout`、`test:c5-desktop-windows`                                                                          | PASS：只读镜像、Cmd+W/inline 回退、屏幕边界、负坐标、配额、迟到事件、焦点和清理   |
| 桌面线层：`test:c5-desktop-capabilities`、`test:c5-desktop-geometry`、`test:c5-desktop-edges`、`test:c5-desktop-overlay`、`test:c5-desktop-xul-overlay`           | PASS：能力门控、几何/端点、显隐、失败关闭及清理                                   |
| 原生 IPC 与整合：`test:c5-native-overlay-ipc`、`test:c5-desktop-integration`、`test:c5-desktop-routing`、`test:c5-desktop-performance`、`test:c5-desktop-runtime` | PASS：握手/ACK、显示器投影、避障、性能样本边界及 runtime 清理                     |
| `test:c5-native-overlay-probe`                                                                                                                                    | PASS：本机探针可构建且 guard/self-test 通过；这是构建自检，不是再次显示桌面探针   |
| `npm run lint:check`、`npm run build`、`npm run verify:package`、`unzip -t`、`git diff --check`                                                                   | PASS：Prettier/ESLint、生产构建/TypeScript、64 项包审计、helper 哈希与 ZIP 完整性 |

Lint 复核中发现两个探针脚本依赖未显式导入的 Node `process` 全局，已分别增加 `node:process` 导入；随后全量 lint 通过。当前目录存在用户已有的广泛未提交改动，本轮没有清理或回退它们。

### 当前隔离宿主与候选

- 用户授权后，候选 `.scaffold/build/zotero-obsidian-bridge.xpi` SHA-256 `e5532ba6ace19f9cac87969cf644303e57b6a424f2ae1b52b5ff2ab520b74746` 已仅安装到 `.scaffold/c-profile/extensions/zotobsidian-bridge@qianzhouji.xpi`；安装包与构建产物哈希相同，`unzip -t` 通过。旧安装包已备份至 `.scaffold/c-install-backups/2026-11-10-c5-closeout/previous-zotobsidian-bridge.xpi`。
- 隔离 Zotero PID `63356` 的启动参数明确指向 `.scaffold/c-profile` 与 `.scaffold/c-data`。C Reader 根卡 `P02N01` 重启后仍显示，状态为“已保存”。
- 当前精确候选的宿主结果：从根卡打开 Bayes 后，独立窗口显示正确路径、正文和数学公式；由 Bayes 的 `Motion model` 链接打开的独立卡显示 `Physics/Motion.md`、正文、公式与合成图片。关闭 Motion 子卡返回 Reader 后，根卡仍在且 Saved；在 Bayes 窗口按 `Cmd+W` 后也返回 Reader，根卡和 Saved 状态保留。随后从根卡重新打开 Motion，独立卡显示正确标题/路径并处于 Ready。未修改或新建夹具正文、批注。
- 活跃知识卡期间观察到 helper PID `63537`，父进程为隔离 Zotero `63356`；二进制路径位于 C profile 插件私有目录，SHA-256 `aa162c831b37920c82802153fec07c69091c72008e0dae7668384215505ba974`，与 XPI 内 manifest 一致。所有独立卡关闭后 helper 进程退出；诊断文件记录 ACK generation `683`、`status=cleared`、`activeWindows=0`、`visibleWindows=0`、`curveCount=0`、往返 `12 ms`。这支持正常清理路径通过，但不覆盖崩溃/强杀。
- 活跃卡时诊断快照出现非原子/不一致状态：投影记录一条曲线且 overlay `renderResult=visible`，同一时段 helper ACK 却报告 `status=cleared`、`visibleWindows=0`、`curveCount=0`。因此本轮不能仅凭该文件确认系统层实际绘出该线，也不能据此计算线更新性能。Computer Use 截取的是知识卡窗口，未取得包含系统 overlay 的桌面级画面；本轮未重新实测卡片拖动、跨应用穿透或 Spaces/全屏。

### 仍需真实宿主验收

1. 补齐 Reader 根卡与展开编辑器两种入口分别开卡/拖出宿主窗的记录，并反复缩放验证最小尺寸边界。窗口配额已由用户另行报告完成验证，不再列为未测。
2. 完成快速关闭/重开、关闭中间卡、切来源/Native、关闭根卡、停用/重启/卸载矩阵；确认迟到响应不复活窗口、不残留连线，根卡草稿/队列不变，资源回到基线。本轮只验证了子卡 `Cmd+W`/关闭后的根卡保留和正常 helper 闲置回收。
3. 在 C 隔离宿主验证 helper 不可用/崩溃、配对或读取权限失效时的真实回退与安全边界，并记录 Vault 文件哈希及 companion 写请求计数。自动化 fallback 不替代现场失败注入。
4. 补完 macOS Spaces、全屏/Stage Manager、睡眠唤醒与显示器断开/重连恢复矩阵。用户已确认多屏/显示器项目通过，但没有据此推定上述细分场景都通过。
5. 补采真实拖动/缩放期间的连续帧和 helper ACK 数据。用户已确认连线行为测试完成；但本轮诊断快照存在状态不一致，不能据此证明路线图量化阈值：最多 8 张子卡时绘线帧耗时 p95 ≤ 32 ms、位置到可见线更新 p95 ≤ 50 ms、静止端点误差 ≤ 4 个逻辑像素。
6. 对快速关闭、故障回退和系统恢复等剩余场景记录结果。连线和窗口配额按用户报告完成并记录为 PASS；用户未提供单项截图/计数或测试时哈希，故证据等级为用户确认，不要求重复功能测试，但量化/日志材料仍缺。

## 2026-11-10 用户确认：连线与窗口配额补测

- 用户报告已完成独立知识卡连线和窗口配额的验证测试；按用户确认记录为 **PASS**，不再把这两项作为未完成的功能验收。
- 此确认发生在候选 `e5532ba6ace19f9cac87969cf644303e57b6a424f2ae1b52b5ff2ab520b74746` 已安装到 C 隔离 profile 之后；据此暂归档至该隔离测试轮次。测试期间的安装哈希未由用户或系统再次读取，故标记为“推定对应当前候选”，不声称独立校验。
- 用户未提供具体卡片数量、配额触发/拒绝/释放步骤、拖动录屏或 ACK 计数。功能结果按 PASS 记录；帧耗时 p95、位置到可见线更新 p95、端点误差等性能阈值仍未量化验收。
- 本项用户确认不改变快速关闭/迟到响应、最小尺寸边界、故障回退、完整生命周期、Spaces/全屏/睡眠与断屏恢复等剩余项目的状态。

## 2026-11-10 C5 剩余验收复核

### 当前隔离状态与自动检查

- 隔离 Zotero PID `63356` 仍以 `-profile .scaffold/c-profile` 和 `--dataDir .scaffold/c-data` 运行；profile 的 `extensions.json` 显示 `zotobsidian-bridge@qianzhouji` 为 active。已安装 XPI SHA-256 为 `e5532ba6ace19f9cac87969cf644303e57b6a424f2ae1b52b5ff2ab520b74746`。C Obsidian PID `2582` 指向 `.scaffold/c-vault`。
- 本轮重新运行 15 项 C5 回归：`test:c5-desktop-surface`、`layout`、`windows`、`capabilities`、`geometry`、`edges`、`overlay`、`xul-overlay`、`native-overlay-ipc`、`integration`、`routing`、`performance`、`runtime`、`visible-relations`、`linked-card-group`，全部 PASS。
- `npm run lint:check`、`npm run build`（含 TypeScript）、`npm run verify:package`、`unzip -t` 和 `git diff --check` 全部 PASS。当前构建 XPI SHA-256 为 `d401e90b2f317652b288737c934a142a9d3926bc7c39c2fa02cd7b913701fa04`；与已安装 XPI 的 64 个归档条目逐项比对，内容相同，唯一差异是 `content/preferences.xhtml` 中生成的构建时间。主 bundle SHA-256 均为 `53324658cda05cd2d1a8fb4313e8fde2a2e0b2044204245a76a67425cd443cdc`，helper SHA-256 均为 `aa162c831b37920c82802153fec07c69091c72008e0dae7668384215505ba974`。本轮未重装 XPI。
- C companion 当前只声明 `search-notes`、`resolve-link`、`read-note`、`read-note-resource` 只读操作；`.scaffold/c-queue` 没有待处理请求文件。当前 C Vault（排除 `.obsidian`，包含现存 recovery 备份）216 个文件的树哈希为 `8d5633b7321c0b9d83da831454f698bbdcf5b48bcefaed105c6cefc2f12f99cb`。这是本轮只读检查的基线，不是安装前后差分，也不是 companion 写请求计数。
- `desktop-edge-diagnostics.json` 最近快照时间为 `2026-11-10T07:59:15.530Z`：0 条边、0 张知识卡、helper ACK 为 `cleared`，没有活动拖动样本。该快照里的 `p95FrameIntervalMs=1670`、`p95DeliveryMs=97`、`p95PaintMs=3` 不代表实际拖动性能，不能用于量化验收。
- Computer Use 能读取 C Reader，但两次鼠标操作均返回 `noWindowsAvailable`；本轮没有打开/关闭卡片、改变设置或修改 C Vault/Zotero 数据，也没有新增真实宿主 PASS。

### 更新后的剩余真实宿主项

1. **尺寸边界：** 用户已确认普通拖动与布局通过；仍需验证最小宽高、连续缩放/缩放回界、窗口贴屏边缘及小可用区降级，确认窗口可找回且标题/内容不裁切。
2. **完整生命周期：** 快速开关/重开、关闭中间子卡、切换 Bridge/Native、关闭 Reader 根卡、停用/重启/卸载与迟到响应；逐项检查根草稿、队列、其他子卡不丢失且没有孤儿窗口/残留连线。既有嵌套关闭、`Cmd+W` 和正常 helper 闲置回收已通过，但不是完整矩阵。
3. **宿主故障回退与安全：** 在 C 隔离环境实际验证 helper 不可用/崩溃、pairing/read 权限失效后的提示、fail-closed 与恢复；记录同一操作前后的 Vault 哈希及 companion 写请求数。当前自动故障注入通过，现场故障注入仍未完成。
4. **系统生命周期：** Spaces、全屏、Stage Manager、睡眠/唤醒及显示器断开/重连后的线层显隐、重建与窗口找回。用户确认的多屏、点击/滚动穿透及前台显示 PASS 保持有效，但不外推为上述全矩阵通过。
5. **量化拖动性能：** 在确有活动连线的连续拖动中采集帧、ACK 与位置误差；功能性连线已由用户确认通过，仍未以有效活动样本验证路线图中的 p95 和 4 逻辑像素目标。

本轮 C5 自动化与构建检查已收尾；真实宿主剩余项受当前 Computer Use 鼠标层不可用阻塞，不能由自动测试代替。C5-C/D 的整体验收因此仍保持 **未关闭**，已由用户确认通过的连线、配额、多屏及穿透项目不要求重复测试。
