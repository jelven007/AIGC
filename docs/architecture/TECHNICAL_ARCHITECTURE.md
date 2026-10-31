# 视频生成平台技术架构

类型：explanation，architectural。读者：技术与运维维护者。责任：技术维护者。核验：2026-11-01。来源：apps/web/src/App.tsx、supabase/functions、scripts/runtime-contract.json、infra/self-hosted/compose.yaml、services/mcp/tools.json。每次协议或运行边界变更复核；实际边界漂移即过期。

## 运行边界

浏览器→HTTPS网关→Auth/REST/43个业务Edge入口→PostgreSQL事务与私有Storage。调度器以独立凭据领取持久任务，调用媒体执行器或供应商接口，结果按原UUID/配置/用量归档，再由本人作品与通知读取。MCP的59工具/19权限调用同一业务API，不提供绕过授权或计费的写入通道。

| 组件 | 源码 | 职责 |
| --- | --- | --- |
| 前端 | apps/web/src、apps/web/public | 48页面/13领域；原账号缓存/请求恢复、真实预览、统一页头与操作区 |
| 业务平台 | supabase/functions、supabase/migrations、supabase/ops | 43生产入口、68文件/66生产迁移；RLS、幂等账务、租约、范围和模型配置 |
| 媒体 | services/media-worker | Python/FFmpeg、字幕/音频/人物蒙版、可信下载、磁盘边界；render4/edit2 |
| 调度与维护 | scripts/run_video_worker.py、infra/video-scheduler | probe24、持久公平预算、原未知请求核对、独立维护与告警spool |
| 工具网关 | services/mcp | 按请求身份隔离、Host白名单、同API权限、并发/正文/超时预算 |
| 基础设施 | infra、scripts/self_hosted*.py | 镜像身份、资源与挂载、离线Edge、加密快照、保配置升级与新卷恢复 |

自托管用户名登录由固定网关路由转主服务的私有用户名/邮箱映射，再交真实Auth校验密码。限流与4KiB正文限制保持，公开配置只提供usernameLogin能力标志；该基础设施路由不计入43个业务入口。

## 依赖与契约

前端共享层不依赖pages，API/lib/db/types不依赖UI；八个Node/Deno纯契约位于supabase/functions/_shared，显式白名单、无环境/网络能力。页面动态加载，Vite应用根为apps/web，仓库输出为dist。根pnpm锁与工具配置保持单一来源。

运行契约00068/probe24/render4/edit2不变；迁移18/19为演示数据并排除生产，历史SQL不改写。任务绑定原配置与价格，确定失败原流水返还，未知受理不得重提或盲退；积分与现金账分别记录。

## 持久状态与部署

数据库、Storage、媒体卷、告警spool、TLS、JWT与模型历史密钥、私有配置和加密备份独立于源码。升级切换固定源码、前端/Edge和架构对应镜像，保留项目身份、数据卷、原账号/账务/任务及容量配置。

本地为11个服务、linux/arm64；ECS为26个常驻容器含16媒体执行器、linux/amd64。同一前端/Edge载荷跨环境晋级，执行镜像按架构核对实际源码摘要。开发5173使用固定Docker环境和仅本机网关。原官方托管环境独立保留。

100人容量配置保持DB240连接、Auth池20、REST池48、Edge8CPU/16GiB、16渲染器和MCP全局128/凭据4。历史压测只证明原时点容量，本轮核对配置和运行健康，不冒充重测。单机没有自动跨机故障转移，恢复须兼容镜像/协议及新项目/新卷。

生产包记录版本、Git SHA、源码SHA-256、完整文件清单、镜像ID/架构及公开身份；任何漂移阻止晋级。正式经营供应商和证书等边界见[需求](../prd/PRD.md)。关联：[目录](../development/PROJECT_STRUCTURE.md)、[API](../development/API_AND_DATA.md)、[升级恢复](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)。
