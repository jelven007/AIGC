# 视频生成平台技术架构

核验：2026-10-31。责任：技术维护者。事实来源：`src/App.tsx`、`supabase/functions`、`scripts/runtime-contract.json`、`deploy/self-hosted/compose.yaml`、`mcp/tools.json`。每次协议或运行边界变化同步本文。发布结果见[生产基线](../releases/PRODUCTION_BASELINE.md)。

## 运行边界与数据流

浏览器→HTTPS入口→Auth/REST/43个Edge业务入口→PostgreSQL事务与私有Storage；调度器以独立凭据领取持久任务→媒体执行器或供应商接口→原UUID结果/用量/素材归档→本人作品与通知。MCP网关经同一业务API执行59个工具、19项权限，没有独立计费或数据写入旁路。

v1.0.1自托管用户名登录由网关固定路由→主服务读取仅含用户名/邮箱的私有映射→真实Auth密码令牌入口完成。网关按来源限流、请求体限制4KiB；错误不回显账号、邮箱、密码。登录映射文件与初始化密码文件分别挂载，主服务不读取初始化密码。公开运行配置只暴露`usernameLogin`能力标志。该基础设施路由不计入43个业务函数，不改变业务授权、账务或任务协议。

| 组件 | 源码 | 责任与约束 |
| --- | --- | --- |
| 前端 | `src/`，48页面/13领域 | 账号缓存与取消边界、原请求恢复、明确失败/空状态、实际媒体预览、浅/深主题及响应式 |
| 业务服务 | `supabase/functions/` | 身份/权限、输入与价格校验、不可变模型配置、原结果证据、可信HTTPS出口 |
| 数据库 | `supabase/migrations/`、`supabase/ops/` | 68迁移文件/66生产迁移，最新00068；账务/租约/范围/RLS/幂等事务与历史摘要 |
| 媒体执行 | `worker/` | FFmpeg、音频分析/字幕/蒙版、磁盘与下载边界；render4/edit2 |
| 调度/维护 | `scripts/run_video_worker.py`、`deploy/video-scheduler/` | probe24、持久公平预算、未知请求核对、独立后台维护与告警spool |
| 开放平台 | `mcp/` | 按请求身份隔离、Host白名单、同API权限、全局/凭据并发预算、非root与有界正文 |
| 部署/恢复 | `deploy/self-hosted/`、`scripts/self_hosted*.py` | 镜像摘要、资源与挂载、冻结Edge、加密冷快照、新项目恢复和保配置升级 |

## 持久状态

数据库、Storage、媒体工作卷、告警spool、TLS、密钥目录、备份和运行回执独立于源码。代码发布只切换源码和镜像、前端/Edge产物，保留Compose项目、原数据卷、JWT/模型历史密钥、账号、资金流水、原任务和私有素材。

模型在任务创建时绑定配置版本与价格。未知供应商POST保留原请求核对，不能重发或盲退；确定失败或未启动取消才按原流水返还。应用积分与供应商现金按不同账本核算。媒体删除以引用/墓碑/outbox保护，历史回执不因UI刷新重新创建。

## 环境与容量

当前自托管ECS为`https://ecs.example.com`，11类服务/26个常驻容器，16个媒体执行器。100人配置固定51CPU预算、DB240连接、Auth池20、REST池48、Edge8CPU/16GiB、MCP全局128/凭据4。真实100账号、API/媒体/MCP/Realtime及恢复证据见[容量验收](../testing/SELF_HOSTED_CAPACITY_100_20261031.md)。

本地自托管11个服务，采用本机架构镜像与同一前端/Edge产物；开发入口5173由固定开发Compose管理。原官方托管环境保持独立，历史00031/三函数与管理401不能作为ECS或新版本状态。

当前为单机故障域；冷快照和恢复演练提供恢复路径，不提供跨机自动故障转移。公网IP使用自签证书，正式域名证书和外部告警/备份调度为经营接入条件。真实模型、支付、短信、邮件与平台授权需独立验收。

## 变更与运行门禁

前端共享层不能反向依赖页面，数据/工具层不能依赖UI；八个跨Node/Deno纯契约显式白名单，保持无环境/网络能力。App逐页动态加载。生产源码、静态资源、依赖锁、运行协议均进入摘要；源码/锁/镜像/公开版本身份漂移阻止晋级。

参考：[需求](../prd/PRD.md)、[目录规范](../development/PROJECT_STRUCTURE.md)、[API与数据](../development/API_AND_DATA.md)、[测试计划](../testing/TEST_PLAN.md)、[升级恢复](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)。[旧架构演进](ARCHITECTURE_EVOLUTION_BEFORE_1_0_0.md)仅作历史，不用于当前操作。
