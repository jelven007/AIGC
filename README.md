# Shopro AI

面向商家的商品脚本与AI短视频生产工具。当前本地功能基线`d7e3d38`（2026-10-22，迭代34），需求、方案、开发、测试、运营和运维已按迭代01–34统一，见 [全生命周期发布基线](docs/RELEASE_BASELINE_20261022.md)。

支持真实商品资料/私有素材/知识检索、七视频协议、图片扩图与矩形重绘、后台语音/声纹/口播/口型、FFmpeg剪辑/音频效果、多镜头配音字幕合成、多规格导出、抖音/TikTok逐账号发布、正式情报和签名观测实验。支撑链包括本人权威积分、注册/验证奖励、短信独立回执、账号隔离、团队共享与预算、可信运营/工单/风险、两渠道退款/人工供应商现金、持久告警与加密隔离恢复。

源码已到00062/probe22/render4/edit2、20模型槽、MCP59工具/19权限。官方Supabase最近成功部署证据仍00031/三个旧函数，管理最近401；最新全栈尚未部署。火山BaaS/Pages/ECS为已适配的独立方案，资源/迁移/运行未验收。仓库同步不等于云端上线。

- [文档中心](docs/README.md)
- [需求与接受条件](docs/prd/PRD.md)、[技术架构](docs/TECHNICAL_ARCHITECTURE.md)、[接口](docs/API_AND_DATA.md)
- [当前状态与部署差距](docs/CURRENT_STATE.md)、[待办](docs/PENDING_CHANGES.md)
- [测试计划](docs/TEST_PLAN.md)、[2026-10-22验证报告](docs/TEST_REPORT_20261022.md)
- [模型设置](docs/MODEL_SETTINGS.md)、[MCP接入](mcp/mcp.md)
- [运营](docs/OPERATIONS_GUIDE.md)、[支付](docs/plan/支付.md)、[运维](docs/RUNBOOK.md)
- [调度](docs/VIDEO_SCHEDULER.md)、[备份恢复](docs/BACKUP_RECOVERY.md)、[火山部署](docs/VOLCENGINE_DEPLOYMENT.md)
- [全部提交追踪](docs/CHANGE_TRACEABILITY.md)、[GitHub合并与两个历史版本](docs/VERSION_MANAGEMENT.md)

## 技术栈

| 层级 | 组成 |
| --- | --- |
| 前端 | React18/TypeScript/Vite、Tailwind/Radix、账号QueryClient/懒加载业务布局 |
| 后端 | Supabase Auth、PostgreSQL/RLS/受限RPC、Deno；manifest43生产入口 |
| 模型与任务 | 20槽加密不可变版本、原UUID/价格/流水、租约/checkpoint/unknown核对 |
| 媒体 | 私有Storage/授权签名、Python/FFmpeg、固定人物模型、真实PCM/时间段 |
| 发布/数据 | 抖音/TikTok OAuth/发布组、YouTube/eBay/授权网关、签名观测/实验 |
| 财务/运营 | 两渠道验签/权益/原路退款、可信客户范围/工单/风险/预算/现金成本 |
| MCP/运维 | FastMCP/HTTPX、生产调度/持久monitor、加密DB/实物/历史密钥恢复 |

创建任务固定原UUID与完整输入、配置版本和原流水；确定失败返还积分，供应商受理未知保留证据而不重提。关页后台继续需要目标常驻调度及独立FFmpeg。

## 本地开发

```sh
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
pnpm build
```

功能证据按迭代报告保留，本轮纯文档校准做链接/锚点、命令/源码事实、凭据与差异检查。协议/身份夹具不产生真实模型/商户/SMS用量，不替代真实目标权限、质量/成本、历史账、容量、RPO/RTO或商业效果验收。

## 目录

```text
src/                    商家/运营前端、账号与业务API
supabase/functions/     Deno入口与共享协议/身份/计费
supabase/migrations/    62迁移文件，生产排除演示18/19
scripts/                部署、生产调度、备份恢复
deploy/                 生产清单及FFmpeg/调度/备份容器
mcp/                    59工具/19权限、同业务API
tests/                  真实PG/媒体、协议/SDK和浏览器验证
docs/                   需求至运维及版本追踪
backend/                历史后台规格，非当前运行服务
```

企业统一付款账套/自动发票、商业资源交易、更多平台、自由画笔/多图界面、专业声纹/全身训练和自动学习投放仍待开发。正式身份/法律资源、模型/商户/平台、存量迁移、外部告警/备份调度和容量待实际验收。

MIT License，见 [LICENSE](LICENSE)。
