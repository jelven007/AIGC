历史归档：正文保留原核验时点，不是v1.1.0运行或操作依据。当前入口见[文档中心](../../../../README.md)。

# 项目目录规范与迁移说明

核验：2026-10-31。项目根为 `AIGCP/shoproai`，与外层独立Git仓库区分。当前48页面/13领域；生产基线与数据迁移见[发布记录](../../../../releases/PRODUCTION_BASELINE.md)。

## 目录职责

```text
shoproai/
├── apps/web/src/
│   ├── pages/            按13业务域归组的路由页面
│   ├── components/       领域视图、布局、UI基础组件
│   ├── hooks/            账号/任务/编辑生命周期
│   ├── api/              领域客户端与原账号请求
│   ├── lib/              数据处理、存储/媒体/状态工具
│   ├── types/            共享类型，含editor.ts
│   ├── contexts/         Auth和账号范围
│   └── db/               Supabase客户端
├── supabase/
│   ├── functions/        Deno入口及_shared契约/执行模块
│   ├── migrations/       历史迁移固定；新增变化追加迁移
│   └── ops/              数据库运维SQL
├── services/media-worker/               独立Python/FFmpeg媒体进程
├── services/mcp/                  同业务API的Agent工具与协议
├── scripts/              支持的构建、发布、调度、备份、测量和检查命令
├── infra/               各运行组件的生产清单/容器配置
├── tests/                现有协议、PG、媒体、身份及浏览器测试
├── public/               当前前端公开静态资源
├── docs/
│   ├── architecture/     当前架构、方案、decisions/ADR
│   ├── development/      开发/接口/模型/目录规范
│   ├── testing/          测试计划与本轮验证
│   ├── operations/       运营、运行、密钥、调度、资源、恢复与容量
│   ├── releases/         发布与平台接受
│   ├── archive/          iterations、reviews、early-research、presentations
│   └── ai/prd/plan/ppt/   原产品/模型/经营/演示资料的稳定分类
├── tools/                文档与一次性迁移辅助工具，非运行组件
└── clipforge             原有独立gitlink，保持原位置
```

`docs/README.md`、`CURRENT_STATE.md`、`PENDING_CHANGES.md`和`CHANGE_TRACEABILITY.md`保留在文档根，作为稳定阅读入口。`docs/ai/evaluation-v1.json`位置不变，它是全栈发布指纹的一部分。

## 页面领域

| 子目录 | 职责 |
| --- | --- |
| auth / marketing / system | 认证、公开介绍、无匹配页 |
| workspace | 工作台、个性化、通知及工具入口 |
| catalog | 商品管理与选品 |
| production | 脚本、视频/图片/音频/数字人、素材/作品、剪辑、任务、批次、导出与发布 |
| intelligence / analytics / knowledge | 情报、指标与实验、知识与缓存 |
| account / billing | 资料、团队、邀请/活动；权益、收银回跳和订单 |
| operations / settings | 运营/客服；模型接口、第三方集成与开放平台 |

路由URL保留原值。App继续逐页动态import，不增加会把页面打进首屏的聚合barrel。已有首页向导与邀请嵌入将在后续阶段抽为领域组件。

## 依赖与新增文件规则

页面依赖组件/Hook/API/纯类型；共享组件、Hook和Context不能import页面。api/lib/db/types/services不import界面层。

八个跨运行时纯契约通过 `scripts/check_project_layout.mjs` 显式声明，包含仅处理历史内置模板显示的video-branding.ts。其他Edge共享模块不能进入前端依赖闭包。保持同一协议来源，后续建立独立package前需验证Node/Deno边界。

配置、框架入口、SQL迁移、部署目录与现有测试发现方式保持稳定。本轮未移动tests，避免改变CI `tests/*.test.mjs`和现有Python/浏览器命令。

旧后台、API、实验和重复通用技能工具已清出当前源码；完整Git祖先可以查阅原实现。`tools`不进入运行或发布依赖闭包。

## 迁移与恢复

本轮清单：[directory-migration-20261030.json](directory-migration-20261030.json)。记录181份受控文件的旧路径、新路径、移动前摘要、迁移时摘要及文档链接重算清单。后续源码修复可能改变迁移时after摘要，应以Git diff和本轮验证记录审阅。

一次性迁移工具位于 `tools/migrations/reorganize_20261030.py`。仅对完整基线清单与指定HEAD运行；当前工作区已迁移，不应再次执行。它不是日常开发或发布命令。

恢复时按清单逐项反向移动，重新计算相对链接/import、配置和测量脚本引用，再运行全部受影响检查。保留恢复前工作区，不能用强制reset/clean丢弃其他改动。历史SQL和密钥目录无需转换。

运行数据、发布产物、临时日志与测试实例退出源码目录；受控回执位于工作区`.local/shopro-production/evidence`，状态/备份/版本分别管理。清理前检查活动挂载，原运行数据先备份再迁移，不能按目录名称判断可删。

## 日常检查

```sh
pnpm check:structure
pnpm lint
pnpm build
node scripts/measure_frontend_bundle.mjs dist
pnpm test:release
```

结构检查验证实际AST中的静态/动态import、循环、方向、八个纯契约、历史目录位置、Node/shadcn配置目标和Markdown本地文件链接。它不验证远端URL、Markdown锚点或实际模型效果，这些需对应专项接受。
