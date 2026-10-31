# 视频生成平台

以 AI 视频生成为核心，连接分镜脚本、素材管理、配音、剪辑、导出、作品与逐账号发布，服务个人创作者、内容团队和品牌制作。

源码基线：v1.1.0。核验：2026-11-01。读者：项目使用者与维护者。责任：仓库维护者。每次发布复核；运行版本、部署是否完成及经营接入条件以[当前状态](docs/CURRENT_STATE.md)和[生产基线](docs/releases/PRODUCTION_BASELINE.md)为准。

| 区域 | 当前实现 |
| --- | --- |
| 前端 | React18 / TypeScript / Vite；48页面、13业务域、220源码模块 |
| 服务平台 | Auth / PostgreSQL / RLS / Storage / Realtime；43生产Edge入口、68迁移文件、66生产迁移 |
| 媒体与调度 | Python / FFmpeg；持久任务、后台配音、剪辑、多镜头合成；00068 / probe24 / render4 / edit2 |
| 设置与开放平台 | 16模型接口槽、4第三方集成槽；59个MCP工具、19项权限 |
| 财务与运营 | 幂等积分、支付权益与退款、按范围工单/风险/租户操作、供应商现金账、告警与加密恢复 |

v1.1.0统一一级页面标题与起始位置、右侧操作区、模型接口与第三方集成布局，改造商品管理，并校验分镜草稿后才提示恢复。一次性提醒采用浮层弹窗，不挤占页面正文。完整标准见[页面规范](docs/development/UI_STANDARDS.md)。

## 开发入口

在本仓库执行以下命令；固定Docker开发环境无需宿主安装Node：

```sh
python3 scripts/dev_environment.py run
python3 scripts/dev_environment.py status
python3 scripts/dev_environment.py restart
python3 scripts/dev_environment.py stop
```

入口为 http://127.0.0.1:5173。固定Node22.23.4 / pnpm10.34.5、命名依赖卷和根目录锁文件。公开参数来自源码外的 .env.local；秘密只进入服务端受控配置。宿主使用匹配工具链时可执行 pnpm install --frozen-lockfile 和 pnpm dev。详见[开发指南](docs/development/DEVELOPMENT_GUIDE.md)。

## 生产目录

```text
apps/web/              前端src、public与HTML
services/media-worker/ Python/FFmpeg执行器及模型资产
services/mcp/          同业务API的HTTP/stdio工具服务
supabase/              functions、migrations、ops及平台约定配置
infra/                 开发、自托管、生产、调度、备份与平台部署配置
scripts/               构建、检查、发布、调度、恢复和测量
tests/                 协议、数据库、媒体、身份与浏览器验证
docs/                  当前生命周期文档及标明时点的archive
```

[文档中心](docs/README.md)按职责提供[需求](docs/prd/PRD.md)、[架构](docs/architecture/TECHNICAL_ARCHITECTURE.md)、[API](docs/development/API_AND_DATA.md)、[测试](docs/testing/TEST_PLAN.md)、[运营](docs/operations/OPERATIONS_GUIDE.md)、[升级恢复](docs/deployment/SELF_HOSTED_ECS_RUNBOOK.md)、[版本保留](docs/releases/VERSION_MANAGEMENT.md)和[MCP](services/mcp/mcp.md)入口。

每次修改执行受影响门禁；基础为 pnpm check:structure、pnpm typecheck、pnpm lint、pnpm build 和 pnpm test:release。完整依赖与证据要求见[测试计划](docs/testing/TEST_PLAN.md)。源码回归、实际部署与经营供应商验收分别记录。

生产状态、私有配置、素材、数据库与加密快照位于源码外，升级保持原账号、余额、素材、历史密钥及任务。当前版本加最多两份历史交付；清理须在新版本验收后核对挂载。远端主线已完成凭据历史清理，本地后续提交必须基于清理后的历史，见[清理说明](docs/CREDENTIAL_HISTORY_CLEANUP.md)。

真实模型质量/权限、收款、SMS/邮件、平台授权、正式域名证书与外部值班/异地备份需经营方配置和实测。当前单机部署不承诺多机高可用或未经测量的SLA。MIT License，见[LICENSE](LICENSE)。
