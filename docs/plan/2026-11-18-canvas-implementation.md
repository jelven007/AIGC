# 画布功能 Implementation Plan

> 用户已于2026-11-18确认设计并授权编码，随后明确授权“应用 00070 迁移并发布前端”。实现与三环境发布接受已完成，见[发布回执](../releases/CANVAS_RELEASE_20261118.md)。Git提交未授权，未执行。

**Goal:** 新增可保存、可恢复、可生成图片的节点式无限画布。

**Architecture:** React Flow 负责视区和节点交互；纯数据模块负责连线、分组、工程导入与历史。独立画布表、版本比较保存和账号隔离回执负责恢复，图片任务继续调用现有服务。

**Tech Stack:** React 18、TypeScript、@xyflow/react、Supabase/PostgreSQL、Node test、Playwright。

## 1. 文档与依赖

- [x] 使用开发容器的 Node 22.23.4 / pnpm 10.34.5 安装 `@xyflow/react`，更新 `package.json` 与锁文件。
- [x] 确认设计状态为已批准；保留已有未提交修改。

```sh
docker exec aigc-web pnpm add @xyflow/react --store-dir /pnpm/store
```

## 2. 数据模型与编辑行为

创建 `apps/web/src/types/canvas.ts`、`lib/canvasDocument.ts`、`lib/canvasHistory.ts` 和 `hooks/useCanvasHistory.ts`；测试为 `tests/canvas_document.test.mjs`。

- [x] 先验证无模块时的失败，再实现真实数据函数，测试通过后继续。
- [x] 验证重复/循环连线、参考输入解析、删除连线、复制不携带任务、分组坐标、撤销手势和导入验证。

```js
assert.equal(connectionError(document, { source: 'text', target: 'image' }), '');
assert.throws(() => importCanvasDocument({ schemaVersion: 99 }), /版本/);
```

```sh
docker exec aigc-web node --test tests/canvas_document.test.mjs
```

## 3. 云端项目与恢复

创建 `supabase/migrations/00070_canvas_projects.sql`、`api/canvasProjects.ts`、`lib/canvasPersistence.ts`、`hooks/useCanvasPersistence.ts`；测试为 `tests/canvas_persistence.test.mjs` 与 `tests/test_canvas_projects.py`。

- [x] 先测试跨账号拒绝、创建幂等、版本冲突、保存响应丢失后的同版本内容核对和失败队列恢复。
- [x] 表使用 RLS、媒体引用触发器；更新服务以预期 revision 作为比较条件，成功后加一。
- [x] 本地恢复副本保留云端基线和内容，800ms 串行保存；冲突提供重载或另存，失败提供导出。

```js
await assert.rejects(saveCanvasProject(owner, id, 1, '旧版本', document), /冲突/);
```

```sh
docker exec aigc-web node --test tests/canvas_persistence.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 tests/test_canvas_projects.py
```

## 4. 图片任务

创建 `lib/canvasImageTask.ts`、`hooks/useCanvasImageJob.ts`；测试为 `tests/canvas_image_task.test.mjs`。

- [x] 先验证任务同 UUID 恢复、已明确拒绝与待确认错误区分、错误账号拒绝，以及重复回执不会创建新任务。
- [x] 回执按账号、画布、节点隔离，生成使用连接输入快照和现有模型能力/积分。
- [x] 一个画布只保留一个未终结图片任务；节点删除或工程切换不复活节点。

```js
assert.equal(recovered.request_key, receipt.request_key);
assert.equal(calls.filter(call => call.action === 'create').length, 1);
```

## 5. 界面与入口

创建 `pages/production/CanvasPage.tsx`、`components/canvas/CanvasEditor.tsx`、`CanvasNode.tsx`、`CanvasInspector.tsx`、`CanvasMaterials.tsx`、`CanvasProjects.tsx`、`canvas.css`；修改 `App.tsx`、`MainLayout.tsx`、`HomePage.tsx`。

- [x] 项目列表、新建、重新打开、另存、删除、JSON 导入导出。
- [x] 五类节点、选择与平移、框选、多选、快捷键、分组、缩略导航、撤销重做。
- [x] 手机属性与素材抽屉、媒体上传与使用权、加载失败反馈、真实图片任务 API 接入。
- [x] 图片/视频“用于视频创作”携带当前账号和稳定素材引用，由工作台重新检查。

视觉方向：深色点阵视区为主体，细边框媒体节点、暖橙选中状态，工具集中于左侧，属性在右侧。节点出现与选中使用短过渡，视区移动直接跟随输入，减少装饰动画。

## 6. 验证与交付

- [x] `tests/browser_canvas.mjs` 在隔离浏览器后端执行真实拖动、编辑、刷新、图片任务适配、冲突和手机抽屉。
- [x] 类型检查、构建、目录检查、标题检查、已有图片编辑及剪辑状态回归。
- [x] 浏览器插件核对5173入口、真实创建/文字编辑、属性抽屉和临时画布删除；隔离与三环境真实Playwright分别核对交互/尺寸，macOS Chrome核对中文像素。
- [x] 新增分组避让浏览器回归，旧实现失败、最小修复后全部8项交互通过。
- [x] 应用本地与ECS的00070，迁移文件与事务账本摘要一致。
- [x] 发布v1.2.2，实际验收发现分组遮挡后另发v1.2.3，保留两版身份和回退副本。
- [x] 三环境分别取得1440px/390px真实保存与刷新回执；两处HTTPS前端205文件摘要及目标公开配置通过。
- [x] 两处真实API幂等、版本冲突与归属验证通过，四个临时账号/所属画布和插件临时画布清理完成。
- [x] 更新 `docs/development/CANVAS.md`、发布记录与当前环境基线。

```sh
docker exec aigc-web pnpm run typecheck
docker exec aigc-web node scripts/build_frontend.mjs --outDir /tmp/aigc-canvas-build
docker exec aigc-web pnpm run check:structure
docker exec aigc-web node tests/page_heading_conventions.test.mjs
```

实际实现使用React Flow 13的changeset API与`forceColorMode`，画布依赖按懒加载入口打包。最终前端v1.2.3；后端执行镜像和43函数仍为v1.2.1。源码按实际内容冻结，`worktree_changes=true`，未执行Git提交。真实图片供应商未调用；线上保存/恢复及迁移已接受，模型质量和成本不在本次验收范围。
