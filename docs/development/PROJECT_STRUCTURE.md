# 生产工程目录规范

类型：explanation。读者：开发与发布维护者。责任：技术维护者。核验：2026-11-01。来源：Vite/TypeScript配置、scripts/check_project_layout.mjs、tests/test_production_layout.py和交付白名单。每次路径或职责变化复核，配置与实际目录不同即过期。

```text
shoproai/
├── apps/web/
│   ├── src/           pages按13领域归组；components/hooks/api/lib/types/contexts/db
│   ├── public/        正式静态资源与公开运行配置
│   └── index.html     应用HTML入口
├── services/
│   ├── media-worker/  Python/FFmpeg、requirements锁、model-assets
│   └── mcp/           Python工具服务、59工具目录、requirements锁
├── supabase/
│   ├── functions/     43生产入口与_shared纯契约/执行模块
│   ├── migrations/    历史固定，新增变化追加迁移
│   └── ops/           运维SQL
├── infra/             development/self-hosted/production及各组件部署配置
├── scripts/           支持的开发、构建、测试、发布、调度、恢复与测量入口
├── tests/             Node/PG/Python/媒体/MCP/浏览器
├── docs/              当前阶段入口、专项与archive
└── 根工具配置         package.json、pnpm-lock.yaml、Vite/TS/规则/CI
```

Vite root=apps/web，envDir=仓库根；@/指向apps/web/src，构建到仓库dist。Vite产物清单键相对应用根，仍为src/pages/...；测试源码读取必须使用apps/web/src/...。supabase目录保持平台约定，避免破坏CLI与迁移发现。

原src/public/index.html、worker、mcp和deploy已迁移；空历史clipforge gitlink无运行依赖，退出生产源码。331个旧目录文件先副本验收再移入源码外恢复区，无直接删除。迁移映射、快照与门禁见[目录迁移回执](DIRECTORY_MIGRATION_V1_1_0.md)。

源码、公开产物、状态、备份和临时材料有独立生命周期。releases只放封存交付；数据库/素材/密钥放受控状态目录。开发依赖卷、仍用二进制和恢复材料不可当作临时文件清理。

规则由pnpm check:structure检查本地链接、生命周期来源、零循环/反向依赖和八个纯契约。pnpm test:release检查目录、Docker上下文、静态资源/脚本指纹与交付闭包。
