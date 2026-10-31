# v1.1.0 生产目录迁移回执

读者：开发、测试与发布维护者。责任：仓库维护者。类型：reference。源码核对：2026-11-01。每次目录、构建或发布闭包变化时复核；路径变化未同步本文即标记过期。版本发布和运行环境状态由发布回执接管，本文记录源码迁移事实。

| 原位置 | 当前位置 | 已核对范围 |
| --- | --- | --- |
| src | apps/web/src | 220 个 TypeScript/TSX 模块，48 个页面；共享纯契约仍在 supabase/functions/_shared |
| public、index.html | apps/web/public、apps/web/index.html | 静态资源、运行时公开配置、首页和 Vite 根目录 |
| worker | services/media-worker | Python/FFmpeg、人物模型资产、依赖锁及容器构建上下文 |
| mcp | services/mcp | 59 个实际 SDK 工具、19 个权限、HTTP/stdio 与固定业务入口 |
| deploy | infra | 开发、单机自托管、调度、媒体、备份、生产与平台发布配置 |
| clipforge | 从生产源码移出 | 空历史 gitlink，无运行依赖，原目录保存在私有恢复区 |

根目录继续承担统一工具链和自动化入口，pnpm 锁文件保持单一权威。数据库历史迁移未改写：68 个文件，生产排除演示迁移 18/19 后应用 66 个；43 个 Edge 入口。运行协议保持 00068 / probe24 / render4 / edit2。

迁移前已保存 895 个源码与文档文件的摘要快照并逐项验证可恢复。采用副本迁移，前端类型检查、构建和契约通过后，把 331 个已核对旧目录文件移入源码外私有恢复区；本步骤删除文件数为零。原目录、快照和迁移前后摘要在工作区的私有发布工作区保留，发布结束后按恢复材料策略封存。

Vite 的根目录为 apps/web，构建输出仍为仓库根 dist，构建命令的 outDir 相对执行目录解析。Vite 产物清单键仍相对应用根，例如 apps/web/src/pages/marketing/LandingPage.tsx；它们与 Git 中的完整路径 apps/web/src/pages/marketing/LandingPage.tsx 不同。构建指纹覆盖新源码目录、静态文件、依赖锁、基础设施和自动化脚本。

浏览器门禁使用 vite.config.ui-tests.mjs。它只开放两个命名测试夹具，并执行 Vite HTML 预处理；实际开发和生产配置使用 vite.config.mjs / vite.config.dev.ts。夹具不进入正式前端产物。

源码阶段验收：58 组 Node 契约通过；320 项宿主 Python/数据库回归通过；52 项媒体回归中 51 项首次通过，唯一公开样本下载失败项经固定 SHA-256 样本核验后复验通过；MCP 业务测试与工具目录核验通过；11 组浏览器流程通过，覆盖 320、390、1024、1440px、商品管理、模型/集成、页头控件、草稿浮层和编辑器。43 个 Edge 入口完成离线打包，远程模块数为零。公开源码敏感内容检查通过。

目录门禁由 tests/test_production_layout.py 执行，并纳入 pnpm test:release。文档链接、生命周期与依赖方向由 pnpm check:structure 执行。本文验收属于源码阶段；本地和线上升级必须分别生成当前版本的载荷与业务数据验收证据。
