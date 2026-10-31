# 视频生成平台

以 AI 视频生成为核心，连接分镜脚本、素材管理、配音、剪辑、导出与作品发布，服务于个人创作者、内容团队和品牌制作。更新：2026-10-31。当前生产基线整理与环境升级以[发布记录](docs/releases/PRODUCTION_BASELINE.md)为准，目录见[生产目录规范](docs/development/PROJECT_STRUCTURE.md)，全生命周期文档由[生命周期登记](docs/lifecycle.json)关联实际源码。

支持真实商品资料/私有素材/知识检索、七视频协议、图片扩图与矩形重绘、后台语音/声纹/口播/口型、FFmpeg剪辑/音频效果、多镜头配音字幕合成、多规格导出、抖音/TikTok逐账号发布、正式情报和签名观测实验。支撑链包括本人权威积分、注册/验证奖励、短信独立回执、账号隔离、团队共享与预算、可信运营/工单/风险、两渠道退款/人工供应商现金、持久告警与加密隔离恢复。

当前版本`v1.0.1`已在本地与火山ECS升级，包含紧凑导航、私有管理员初始化与服务端用户名登录。本文部署地址使用`https://ecs.example.com`示例，实际入口与初始化信息从受控私有配置获取。源码契约00068/probe24/render4/edit2、20模型槽、MCP59工具/19权限、66生产迁移和43入口均已自托管运行；公网页面、权限、商品、实时消息、真实FFmpeg成片及重启/加密恢复通过。当前IP使用30天自签证书，浏览器首次访问会提示；模型/支付/SMS/平台需要实际经营凭据。详见[ECS运行手册](docs/deployment/SELF_HOSTED_ECS_RUNBOOK.md)和[实际验收](docs/testing/SELF_HOSTED_ACCEPTANCE_20261031.md)。原官方Supabase环境独立保留。

- [文档中心](docs/README.md)
- [需求与接受条件](docs/prd/PRD.md)、[技术架构](docs/architecture/TECHNICAL_ARCHITECTURE.md)、[接口](docs/development/API_AND_DATA.md)
- [当前状态与部署差距](docs/CURRENT_STATE.md)、[待办](docs/PENDING_CHANGES.md)
- [测试计划](docs/testing/TEST_PLAN.md)、[2026-10-27实施与验证](docs/archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)
- [模型设置](docs/development/MODEL_SETTINGS.md)、[MCP接入](mcp/mcp.md)
- [运营](docs/operations/OPERATIONS_GUIDE.md)、[支付](docs/plan/支付.md)、[运维](docs/operations/RUNBOOK.md)
- [调度](docs/operations/VIDEO_SCHEDULER.md)、[备份恢复](docs/operations/BACKUP_RECOVERY.md)、[火山部署](docs/releases/VOLCENGINE_DEPLOYMENT.md)
- [全部提交追踪](docs/CHANGE_TRACEABILITY.md)、[GitHub发布与仅保留当前版本](docs/releases/VERSION_MANAGEMENT.md)

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

推荐使用已保存的TRAE Run入口，或在项目目录执行：

```sh
python3 scripts/dev_environment.py run
# 查看/重启/停止：
python3 scripts/dev_environment.py status
python3 scripts/dev_environment.py restart
python3 scripts/dev_environment.py stop
```

依赖Docker；固定Node镜像digest、pnpm10.34.5及命名依赖卷，监听`http://127.0.0.1:5173`。公开配置只从`.env.local`注入，启动前验证原后端Auth；不需要宿主安装Node，也不使用临时代理。详见[环境矩阵](docs/development/DEVELOPMENT_GUIDE.md#固定开发入口与环境矩阵)。

宿主已安装匹配工具链时也可直接运行：

```sh
node --version # 22.23.4，见 .node-version
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
test -f .env.local || cp .env.example .env.local
pnpm dev
```

前端公开配置URL/anon key，注册需要正式`VITE_TERMS_URL/VITE_PRIVACY_URL`。模型/支付/Worker/service_role/加密主密钥只进服务端，模型在`/settings/models`由真实管理员配置。详见 [开发指南](docs/development/DEVELOPMENT_GUIDE.md)；启动前端不证明旧云端具备新API。

当前固定开发Compose经仅本机网关连接ECS自托管后端，严格校验上游TLS；真实登录及响应式页面已验收。初始化凭据在源码外0600文件中保存，当前发布不公开账号、密码或真实邮箱。完整Git历史的脱敏需另行执行历史重写，见[当前状态](docs/CURRENT_STATE.md)。

## 验证

按受影响能力执行`package.json`中的测试，数据库/FFmpeg/MCP/备份专项依赖Docker隔离镜像；UI分别验证开发与独立压缩页面。基本检查：

```sh
pnpm check:structure
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

功能证据按迭代报告和本轮实施台账保留；CI入口在`.github/workflows/ci.yml`，远端尚未运行。完整发布使用[冻结依赖与全栈回执](docs/releases/REPRODUCIBLE_RELEASE.md)，普通prepare同时生成前端发布身份与归档摘要。协议/身份夹具不替代真实目标权限、质量/成本、历史账、容量、RPO/RTO或商业效果验收。

## 目录

```text
src/pages/              47页面按13业务域归组，路由URL保持
src/                    领域组件/Hook/API、账号与共享类型
supabase/functions/     Deno入口与共享协议/身份/计费
supabase/migrations/    68迁移文件，生产排除演示18/19
worker/                 独立媒体执行与FFmpeg
scripts/                发布接受、调度/维护/告警、加密归档恢复、容量测量
deploy/                 生产清单及FFmpeg/调度/备份容器
mcp/                    59工具/19权限、同业务API
tests/                  真实PG/媒体、协议/SDK和浏览器验证
docs/                   当前方案/开发/测试/运维/发布与历史归档
tools/                  辅助技能、旧文档工具和一次性迁移
```

企业统一付款账套/自动发票、商业资源交易、更多平台、自由画笔/多图界面、专业声纹/全身训练和自动学习投放仍待开发。正式身份/法律资源、模型/商户/平台、存量迁移、真实告警与异地备份调度、容量待目标验收。

MIT License，见 [LICENSE](LICENSE)。
