# Shopro AI

面向商家的商品脚本与AI短视频生产工具。更新：2026-10-27；在迭代01–34基础上完成本轮本地优化，包含审核与原请求恢复、同步模型尝试台账、共享查询、剪辑状态拆分、持久公平调度、媒体资源治理、版本化密钥、告警投递及异地恢复工具。变更与验证见 [实施记录](docs/OPTIMIZATION_IMPLEMENTATION_20261027.md)。

支持真实商品资料/私有素材/知识检索、七视频协议、图片扩图与矩形重绘、后台语音/声纹/口播/口型、FFmpeg剪辑/音频效果、多镜头配音字幕合成、多规格导出、抖音/TikTok逐账号发布、正式情报和签名观测实验。支撑链包括本人权威积分、注册/验证奖励、短信独立回执、账号隔离、团队共享与预算、可信运营/工单/风险、两渠道退款/人工供应商现金、持久告警与加密隔离恢复。

源码契约为00068/probe24/render4/edit2、20模型槽、MCP59工具/19权限，68迁移文件中66份用于生产。官方Supabase最近已记录的成功证据仍00031/三个旧函数，2026-10-22管理访问401，本轮未重新访问云端；最新全栈尚未部署。火山BaaS/Pages/ECS方案及本地发布工具已适配，真实资源、迁移和运行验收见 [发布接受](docs/RELEASE_ACCEPTANCE.md)。

- [文档中心](docs/README.md)
- [需求与接受条件](docs/prd/PRD.md)、[技术架构](docs/TECHNICAL_ARCHITECTURE.md)、[接口](docs/API_AND_DATA.md)
- [当前状态与部署差距](docs/CURRENT_STATE.md)、[待办](docs/PENDING_CHANGES.md)
- [测试计划](docs/TEST_PLAN.md)、[2026-10-27实施与验证](docs/OPTIMIZATION_IMPLEMENTATION_20261027.md)
- [模型设置](docs/MODEL_SETTINGS.md)、[MCP接入](mcp/mcp.md)
- [运营](docs/OPERATIONS_GUIDE.md)、[支付](docs/plan/支付.md)、[运维](docs/RUNBOOK.md)
- [调度](docs/VIDEO_SCHEDULER.md)、[备份恢复](docs/BACKUP_RECOVERY.md)、[火山部署](docs/VOLCENGINE_DEPLOYMENT.md)
- [全部提交追踪](docs/CHANGE_TRACEABILITY.md)、[GitHub合并与两个历史版本](docs/VERSION_MANAGEMENT.md)

## 技术栈

| 层级 | 组成 |
| --- | --- |
| 前端 | React18/TypeScript/Vite、Tailwind/Radix、账号QueryClient/懒加载业务布局 |
| 后端 | Supabase Auth、PostgreSQL/RLS/受限RPC、Deno；manifest43生产入口 |
| 模型与任务 | 20槽不可变版本、用途绑定密钥目录、原UUID/尝试/现金用量、持久公平预算与独立维护 |
| 媒体 | 私有Storage、可信HTTPS出口、Python/FFmpeg、任务去重/磁盘预算/停止恢复 |
| 发布/数据 | 抖音/TikTok OAuth/发布组、YouTube/eBay/授权网关、签名观测/实验 |
| 财务/运营 | 两渠道验签/权益/原路退款、可信客户范围/工单/风险/预算/现金成本 |
| MCP/运维 | 有界FastMCP/HTTPX、独立monitor/告警回执、认证归档上传拉回、全栈源码身份 |

创建任务固定原UUID与完整输入、配置版本和原流水；确定失败返还积分，供应商受理未知保留证据而不重提。关页后台继续需要目标常驻调度及独立FFmpeg。

## 本地开发

```sh
node --version # 22.23.4，见 .node-version
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
test -f .env.local || cp .env.example .env.local
pnpm dev
```

前端公开配置URL/anon key，注册需要正式`VITE_TERMS_URL/VITE_PRIVACY_URL`。模型/支付/Worker/service_role/加密主密钥只进服务端，模型在`/settings/models`由真实管理员配置。详见 [开发指南](docs/DEVELOPMENT_GUIDE.md)；启动前端不证明旧云端具备新API。

## 验证

按受影响能力执行`package.json`中的测试，数据库/FFmpeg/MCP/备份专项依赖Docker隔离镜像；UI分别验证开发与独立压缩页面。基本检查：

```sh
pnpm typecheck
pnpm lint
pnpm test:image-editing
pnpm test:finance
pnpm test:scheduler
pnpm test:volcengine
pnpm test:acceptance
pnpm test:alert-delivery
pnpm test:backup
deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts
pnpm build
```

功能证据按迭代报告和本轮实施台账保留；CI入口在`.github/workflows/ci.yml`，远端尚未运行。完整发布使用[冻结依赖与全栈回执](docs/REPRODUCIBLE_RELEASE.md)，普通prepare同时生成前端发布身份与归档摘要。协议/身份夹具不替代真实目标权限、质量/成本、历史账、容量、RPO/RTO或商业效果验收。

## 目录

```text
src/                    商家/运营前端、账号与业务API
supabase/functions/     Deno入口与共享协议/身份/计费
supabase/migrations/    68迁移文件，生产排除演示18/19
scripts/                发布接受、调度/维护/告警、加密归档恢复、容量测量
deploy/                 生产清单及FFmpeg/调度/备份容器
mcp/                    59工具/19权限、同业务API
tests/                  真实PG/媒体、协议/SDK和浏览器验证
docs/                   需求至运维及版本追踪
backend/                历史后台规格，非当前运行服务
```

企业统一付款账套/自动发票、商业资源交易、更多平台、自由画笔/多图界面、专业声纹/全身训练和自动学习投放仍待开发。正式身份/法律资源、模型/商户/平台、存量迁移、真实告警与异地备份调度、容量待目标验收。

MIT License，见 [LICENSE](LICENSE)。
