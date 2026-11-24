# 创作画布维护说明

类型：reference。读者：前端、数据与发布维护者。责任：画布功能维护者。核验日期：2026-11-18。来源：画布源码、`00070_canvas_projects.sql`、隔离测试与[发布回执](../releases/CANVAS_RELEASE_20261118.md)。保存格式、图片任务或部署环境变化时复核。

## 入口与能力

侧栏“创作画布”进入 `/canvas`；项目编辑地址为 `/canvas/:canvasId`。支持文字、图片、视频、音频、分组，节点拖动、连线、框选、复制、分组、删除、50步历史和视区缩放。文字或图片可连接到图片节点；每种输入最多一个来源，拒绝循环与自连接。

图片生成使用现有 `image.primary` 模型、积分查询与 `production-jobs` 接口。每个画布只允许一个未确认图片请求。图片/视频“用于视频创作”携带原账号和稳定媒体引用；工作台重新验证账号和 Storage 访问权，再填入参考素材，不自动提交视频任务。

手机属性和素材使用抽屉/弹窗。320px至1440px已检查无横向溢出；手机工具与操作使用44px目标。新增节点偏移排列，避开已有分组的完整区域；避让后视区跟随新节点，防止分组内文字遮挡新节点。

## 模块

| 模块 | 职责 |
| --- | --- |
| `pages/production/CanvasPage.tsx` | 按账号/项目加载，比较本地副本与云端 |
| `components/canvas/` | 项目列表、React Flow、节点、属性、素材与样式 |
| `lib/canvasDocument.ts` | 文档清理/校验、连线、分组、复制、导入、稳定 JSON 比较 |
| `lib/canvasHistory.ts`、`hooks/useCanvasHistory.ts` | 拖动作为一次历史，视区不进入撤销 |
| `api/canvasProjects.ts` | 原账号会话、创建/保存回执、私有媒体与版本比较 |
| `lib/canvasPersistence.ts`、`hooks/useCanvasPersistence.ts` | 本地副本、800ms自动保存与串行队列 |
| `lib/canvasImageTask.ts`、`hooks/useCanvasImageJob.ts` | 图片请求 UUID、输入快照与查询恢复 |

React Flow 13使用 `changes.applyTo()`、`changes.toArray()` 和 `forceColorMode`，不要直接套用旧版 `applyNodeChanges` 示例。`vite.config.mjs` 对 React 包匹配限定到准确的 `node_modules` 路径，防止 `@xyflow/react` 误进入首屏 React 核心包。

## 保存与恢复

文档 `schemaVersion=1`，最多200节点、400连线、2MB，正文和提示词最多8000字。JSON工程导出包含稳定媒体引用，不包含媒体文件；导入重新分配节点ID并丢弃任务回执，逐项校验当前账号媒体权限。

新增独立 `canvas_projects` 表。客户端只调用 `create_canvas_project` 与 `save_canvas_project` RPC；authenticated 只有自己的 SELECT/DELETE 权限，不能绕过版本比较直接更新。保存按 `revision` 比较，相同已保存内容可幂等恢复；冲突保留本地内容并提供重载/另存。

数据库JSONB不保留键序，未知保存响应按稳定键序比较完整内容。若关页前服务器已保存而本地基础版本尚未更新，重新加载会在完整内容与标题一致时对齐云端版本。内容不同仍进入冲突，不静默覆盖。

| 本地键 | 内容 |
| --- | --- |
| `aigc:canvas-create:<userId>` | 未确认的新建 UUID、标题和初始文档 |
| `aigc:canvas-draft:<userId>:<canvasId>` | 当前文档、标题和基础云端版本 |
| `aigc:canvas-image:<userId>:<canvasId>` | 节点ID、原请求 UUID、完整输入和任务ID |

写后读回检查失败会明确报错。退出/切换账号取消请求并销毁界面；原账号副本留给原账号恢复。生成完成只有原节点仍存在才更新；终态写入原画布并取得保存回执后清理任务回执。原节点已删除时不会复活，原任务仍可在任务中心查询。另存画布和复制节点不复制任务恢复请求。

## 验证范围

`test:canvas` 覆盖12项纯数据/API/回执测试；`tests/test_canvas_projects.py` 使用独立PG实例加载迁移，3项验证创建幂等、跨账号RLS、并发版本比较、媒体引用保护。数据库实例测试后清理，不写线上数据。

`test:canvas-ui` 使用隔离HTTP回执和真实Chromium，8项覆盖拖动、单步撤销、分组、分组避让、刷新、保存失败、两个标签页冲突、导出/另存、原UUID任务恢复、拖拽端口、任务中删除节点、账号切换、320/390/1024/1440尺寸、素材类型和视频工作台接入。分组避让回归先在旧实现失败，再在修复后通过。图片回执在测试中模拟，未调用真实供应商。

此外执行类型检查、构建、目录/来源/标题检查，既有剪辑状态11项、剪辑浏览器9项，以及图片编辑和图片生产协议/浏览器回归。macOS浏览器核对中文字体与页面像素；临时截图与构建放在 `/tmp`。

```sh
pnpm run test:canvas
PYTHONDONTWRITEBYTECODE=1 python3 tests/test_canvas_projects.py
pnpm run typecheck
pnpm run check:structure
pnpm run test:heading-style
```

UI测试需独立Vite或构建预览，公开配置 `VITE_SUPABASE_URL=https://ui-fixture.example`、`VITE_SUPABASE_ANON_KEY=fixture`。然后以 `UI_TEST_URL` 指定该入口运行 `pnpm run test:canvas-ui`。可以用 `CHROMIUM_PATH` 指定已安装浏览器，或使用 Playwright 安装的匹配浏览器。不要把该夹具配置写入生产环境。

## 当前环境与发布记录

2026-11-18用户明确授权“应用 00070 迁移并发布前端”。本地自托管与ECS均已应用00070，账本68项、最新00070，摘要为 `b409eb053b5d96d822f0374de13c9bae1e22eb8e444521b8b6b8ce22bdc1013c`。5173的54329网关实际转发ECS，缺表错误已消失。

最终前端为v1.2.3，源码摘要 `5e5cf2173ed1432a0fa49a85a943a280faf5de4801786958232c1e5a41300749`。v1.2.2先上线，真实验收发现分组遮挡新节点；修复按版本规则另发v1.2.3，旧版本身份保留。两处各205个静态文件的HTTPS字节与发布包一致，另独立核对目标运行配置。构建使用真实公开配置、固定开发镜像和禁网依赖卷；夹具包未发布。

开发、本地部署、ECS分别通过1440px/390px真实账号新建、保存、刷新恢复、四类节点和导出；桌面通过拖动、撤销/重做、分组、文字连线，手机通过属性抽屉及44px目标。六项页面流程共取得30次成功保存回执，零页面错误、零失败响应。两处真实API验证创建/保存幂等、revision递增、409冲突、跨账号读取隐藏与写入拒绝、匿名拒绝。四个临时账号和所属画布已清理；浏览器插件额外创建的临时画布也已删除。

本轮仅发布前端及迁移，后端43入口和执行镜像继续使用v1.2.1/probe24/render4/edit2，`SOURCE_DIR`与全栈`current`保留原基线。发布身份明确 `worktree_changes=true`；没有Git提交、推送或GitHub标签发布。两处前端回退副本及迁移前schema快照保留。真实供应商图片质量、成本和生产私有素材上传未在本次线上验收中测试；相关权限/引用和图片任务恢复仍以隔离PG/浏览器证据为准。删除画布仅释放工程引用，保留原素材和已提交任务。

方案与实施记录：[设计](../plan/2026-11-18-canvas-design.md)、[实施计划](../plan/2026-11-18-canvas-implementation.md)。
