# Shopro AI

面向商家的商品脚本与 AI 短视频创作工具。当前实际连接官方 Supabase，仍依赖 Supabase Auth、数据库、Storage 与 Edge Functions。火山引擎 BaaS、Pages、ECS 和方舟已有适配与部署方案，尚未切换运行环境。

- [文档中心：需求、方案、开发、测试、运营、运维](docs/README.md)
- [当前代码与云端部署差距](docs/CURRENT_STATE.md)
- [最新技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [改造前后对比与遗漏检查](docs/ARCHITECTURE_REVIEW_20261021.md)
- [统一模型接口设置](docs/MODEL_SETTINGS.md)
- [火山引擎部署指南](docs/VOLCENGINE_DEPLOYMENT.md)
- [视频任务与积分结算](docs/API_AND_DATA.md)
- [后台调度](docs/VIDEO_SCHEDULER.md)

最新已提交源码基线为 `ce90bfe`。2026-10-21 只读核验：官方环境只有迁移到 00031 和三个已部署函数；最新 00032–00034、统一模型配置与图片/音频函数尚未上线。当前前端不能单独代表最新全栈版本可用。未提交的私有媒体/生产任务/渲染/平台发布开发见 [待验收变更](docs/PENDING_CHANGES.md)，不计入本轮通过结果。

## 技术栈

| 层级 | 组成 |
|---|---|
| 商家前端 | React 18、TypeScript、Vite、Tailwind、Radix、React Query |
| 后端 | Supabase 协议的 Auth、Deno Edge Functions、PostgreSQL/RLS/RPC；当前为官方托管 |
| 视频执行 | 数据库队列、租约、有限时长 Worker；当前官方 Cron，火山方案用 ECS Docker |
| 模型 | 统一设置页管理文本主备、七类视频、图片、TTS/ASR、网页 Reader；方舟优先 |
| 素材 | Storage，成片固定路径转存，当前桶公开 |
| 支付 | 支付宝/微信回调验签与原子订单权益入账 |
| MCP | FastMCP，用户 JWT 复用业务 API、视频幂等提交 |

视频任务在一个事务中创建作品、预占积分和流水。成功转存后结算，确定失败按原流水退积分；未知提交结果进入核对流程。页面关闭后的处理依赖常驻后台调度。

## 本地开发

```sh
pnpm install --frozen-lockfile
test -f .env.local || cp .env.example .env.local
# 填当前目标环境的 URL 与 anon/publishable key
pnpm dev
```

前端仅允许公开后端 URL 与 anon key。模型在 `/settings/models` 统一配置；加密主密钥、支付、Worker 和 service_role 密钥配置到服务端，构建拒绝敏感 `VITE_*` 变量。设置页需要匹配的 00034 迁移和函数，首次管理员授权见模型配置指南。本地启动与无 Node 时的容器方式见 [开发指南](docs/DEVELOPMENT_GUIDE.md)。

## 验证

```sh
pnpm typecheck
pnpm test:video
pnpm test:models
pnpm test:payments
pnpm test:volcengine
pnpm test:finance
pnpm test:scheduler
pnpm build
```

数据库测试需要 Docker，使用隔离 PostgreSQL 与平台替身；模型协议测试不产生实际供应商用量。

## 目录

```text
src/                         商家端与业务 API 客户端
supabase/functions/          Deno 业务函数与 Provider 适配
supabase/migrations/         数据库增量变更
scripts/deploy_volcengine.py 火山部署准备、迁移、函数与 Pages
deploy/volcengine/           生产部署清单与 Secrets 模板
deploy/video-scheduler/      ECS Docker 后台调度
mcp/                        用户 JWT 的 MCP 服务
tests/                      资金、支付、视频与部署回归
docs/                       技术架构和操作指南
backend/                    历史运营后台规格，核心源码尚缺失
```

已提交基线素材桶公开，私有视频授权与生产任务处于后续开发。批量生成、完整剪辑渲染、真实跨平台发布和部分数据分析仍待验收；历史模拟功能不代表可生产交付。应用积分和供应商用量分开核算，收费范围见 [运营手册](docs/OPERATIONS_GUIDE.md)。

MIT License，见 [LICENSE](LICENSE)。
