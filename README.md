# Shopro AI

面向商家的商品脚本与 AI 短视频创作工具。部署目标为火山引擎 AI 原生 BaaS Supabase 版、火山 Pages、ECS 后台调度和火山方舟模型服务，无需 supabase.com 或 Vercel。

- [最新技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [火山引擎部署指南](docs/VOLCENGINE_DEPLOYMENT.md)
- [视频任务与积分结算](docs/ITERATION_03_VIDEO_JOBS.md)
- [后台调度](docs/VIDEO_SCHEDULER.md)

当前代码已进行火山适配，本轮未登录火山账号、创建资源或完成火山云端验收。历史其他平台部署记录不能视为本轮火山上线结果。

## 技术栈

| 层级 | 组成 |
|---|---|
| 商家前端 | React 18、TypeScript、Vite、Tailwind、Radix、React Query |
| 后端 | 火山 BaaS Auth、Deno Edge Functions、PostgreSQL/RLS/RPC |
| 视频执行 | 持久化数据库队列、租约领取、有限时长 Worker、ECS Docker 调度 |
| 模型 | 火山方舟文本与 Seedance，其他供应商可选 |
| 素材 | BaaS Storage，成片固定路径转存 |
| 支付 | 支付宝/微信回调验签与原子订单权益入账 |
| MCP | FastMCP，用户 JWT 复用业务 API、视频幂等提交 |

视频任务在一个事务中创建作品、预占积分和流水。成功转存后结算，确定失败按原流水退积分；未知提交结果进入核对流程。页面关闭后的处理依赖常驻后台调度。

## 本地开发

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# 填自己的火山 BaaS URL 与 anon key
pnpm dev
```

前端仅允许公开后端 URL 与 anon key。模型、支付、Worker 和 service_role 密钥配置到服务端；构建拒绝敏感 `VITE_*` 变量。

## 验证

```sh
pnpm typecheck
pnpm test:video
pnpm test:payments
pnpm test:volcengine
pnpm test:finance
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

当前素材桶公开，未实现私有视频授权。批量生成、完整剪辑渲染、真实跨平台发布和部分数据分析仍待接入；历史模拟功能不代表可生产交付。

MIT License，见 [LICENSE](LICENSE)。
