# 视频任务后台调度

更新：2026-10-27。当前production模式严格probe24/00068/render4/edit2，生产/维护两个独立进程共享持久预算；旧video-job-worker模式probe1仅覆盖视频。[执行与能力契约](WORKER_SCHEDULING.md)、[告警投递](ALERT_DELIVERY.md)为当前操作入口，以下旧探针为历史。

## 历史调度增量

最新 [迭代33](ITERATION_33_CREDITS_SMS.md)：production严格probe21/00061/render4/edit2，新增本人权威积分RPC权限预检。重建调度镜像并匹配production-worker/全部函数/00032–00061/前端；旧probe20拒绝，monitor持久卷要求保持。官方旧Cron不提供这套轮转，下文为历史协议。

当前 [迭代31](ITERATION_31_ACCOUNT_STORYBOARD.md)：production严格probe19/00059/render4/edit2，预检新增profile概览/头像引用触发器核对；重建调度镜像并匹配production-worker/operations/00032–00059及前端。常驻每分钟monitor独立于任务执行，最近三分钟采集成功才健康，连续三次失败及恢复同卷保存。宿主完全停机仍需外部监控；官方旧视频Cron不提供新production/monitor轮转。

最新 [迭代26](ITERATION_26_EDITOR_ASSETS.md)升级渲染协议为render4，支持实际音频EQ/回声/机器人；production预检严格要求version15/required_migration=00054/render_version=4/edit_version=1。00054、material-assets/匹配production服务、常驻调度/MCP58/前端与FFmpeg镜像同窗，旧render3不领取任务。上传登记不是供应商任务，不增加后台现金出账。

最新 [迭代25](ITERATION_25_EDIT_ANALYSIS.md)增加edit_analysis字幕结案/原版本识别轮转；FFmpeg按render/analysis_prepare/edit_prepare三队列轮转处理，页面关闭不影响音轨分析。专用渲染密钥不能结案字幕模型阶段，上传与结果绑定原租约。production预检严格要求version14/required_migration=00053/render_version=3/edit_version=1，重建镜像及匹配数据库/API/调度/前端；长素材吞吐与真实Whisper待验收。

最新 [迭代24](ITERATION_24_WECHAT_TRANSACTIONS.md)将微信原订单/退款核对加入生产轮转，支付到期与关闭按原商户和签名查单处理，退款只查询已发出的原编号，不自动现金出账。订单/退款独立UUID租约/退避；production严格要求version13/required_migration=00052/render_version=2，数据库/所有匹配函数和调度同窗发布，真实渠道/吞吐仍需验收。

最新 [迭代23](ITERATION_23_DATA_LIFECYCLE.md)加入有界媒体TTL/七天终态证据清理与声纹删除轮转；删除使用原模型版本/独立租约，未知配音受理延迟声纹删除。production模式严格要求version12/required_migration=00051/render_version=2，旧video-job-worker仍version1。迁移、API/Worker、常驻调度、MCP56及页面同窗；实际清理、队列吞吐和恢复仍待目标验收。

最新 [迭代21](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)加入product_translate轮转与30天译文/竞品引用、180天通知清理；使用原模型版本/证据归档，不重发executing未知请求。production模式严格匹配version10/required_migration=00049/render_version=2，旧video-job-worker仍version1。迁移/函数/常驻调度与MCP/前端须同步发布，当前云端旧Cron不是新能力的运行验收。

当前 [迭代20](ITERATION_20_CASH_OPERATIONS.md)新增现金退款核对轮转：专用Worker仅查询已发出原申请，10秒至10分钟退避/租约、最多100次后保留人工核对。production模式严格匹配version9、00048、render2，video-job-worker仍version1；调度器与production-worker/迁移须一起升级。没有支付配置时退款runner不影响其他队列；云端仍旧基线，源码增加调度不代表已运行验收。

当前 [迭代19](ITERATION_19_PRODUCT_MANAGEMENT.md)production-worker新增product_import轮转和30天原文/结果清理。常驻调度修复旧version1预检：生产模式严格要求version8、00046、render2，旧video-job-worker模式仍version1。数据库、函数和调度器须一起升级；探针只读通过不证明真实商家/模型任务和生产持续运行已验收。

新增 [发布组迭代18](ITERATION_18_PUBLISH_GROUPS.md)：各账号仍按原publish任务轮转和next_run_at领取，不依赖页面；无整组重发执行器。probe v7要求00045的组/子任务结构，render_version仍2。部署匹配函数/迁移后验收定时、多账号并发和unknown核对，原10秒调度机制保持。

production-worker run新增 [情报计划及采集](ITERATION_15_MARKET_INTELLIGENCE.md)：每24小时按用户确认次数/预算入队，与现有任务轮转；同一时点确定性UUID，拥堵延后，权限/余额/配置变化停用。run同时清理30天统计来源副本。probe v6要求00044；VIDEO_WORKER_SECRET仍为专用后台凭据，新链依赖常驻调度而非页面计时。

production-worker新增knowledge_index/search轮转执行，与现有视频/图片/媒体/分析公平领取，不依赖知识页打开。probe v5要求00043知识表结构，专用VIDEO_WORKER_SECRET保持不变；Embedding POST结果未知不自动重发，checkpoint后仅恢复数据库写入。发布范围00032–00043与匹配共享模块，详见 [知识迭代14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)，云端旧调度证据不证明新链已启用。

00042 [观测及实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)把production-worker探针升级v4，核对measurement_sources/key_digest及content_experiments结构。自然视频仍由原15分钟指标调度采集，签名日观测/实验事件由授权采集服务主动送达；不能靠视频Cron推断广告/电商/实验流量已接入。最新部署须覆盖00032–00042及新增函数，旧探针说明仅为历史版本。

00041新增 [两段素材分析](ITERATION_12_GROUNDED_ANALYSIS.md)：通用production轮转增加analysis；FFmpeg轮转render与analysis_prepare，prepared后释放租约进入模型阶段。probe升级version=3/required_migration=00041，部署仍需匹配函数与镜像，现有旧视频Cron不会自行支持新分析。

官方历史Cron仅旧视频，最近成功证据00031/三函数；管理401后尚未重新确认实时状态。新production轮转依赖常驻调度，火山ECS方案尚未运行验收；扩展Cron需目标确认。

历史2026-10-21官方Supabase `aigcp`视频Cron已启用并有退款验收记录，见[部署记录](DEPLOYMENT_AIGCP.md)；2026-10-22管理401后未重新核验，不能据此认定当前Cron健康。生产全栈依赖常驻Docker生产/维护进程及独立FFmpeg，仍待目标部署。

新增媒体队列要求00040与production-worker版本2，开启既有production调度后轮转视频/图片/发布/TTS/ASR/即时克隆/照片口播/口型，不需要独立数字人调度器。旧视频Cron仅覆盖视频，不能据其运行推断媒体后台已启用。probe要求voice_clones/五计费项，真实关页、配置变更与原受理未知验收见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)；云端最近记录仍是00031/旧函数。

## 推荐：常驻服务器的 Docker 调度器

最新版须核对目标缺失至00068和全部冻结函数/共享模块，production-worker/probe24、FFmpeg render4/edit2、MCP59/前端身份及镜像一致。Edge配置VIDEO_WORKER_SECRET、模型keyring与发布源码摘要；调度器只需URL/Worker专用密钥，不需service_role/模型/主密钥。

当前官方旧环境仅到 00031、旧 Worker 与 Cron 已运行；不得只替换新版 Worker。缺 00034 时新版 probe 将失败，旧任务还需要核对原账号后绑定版本。升级顺序见 [开发指南](DEVELOPMENT_GUIDE.md)。

1. 首次从deploy/video-scheduler/.env.example创建.env，填目标SUPABASE_URL并保持`PRODUCTION_WORKER_ENABLED=true`，已有配置不覆盖。旧视频模式不能替代新production。
2. 将同一 `VIDEO_WORKER_SECRET` 原值写入该目录的 `video_worker_secret` 文件，无变量名，建议文件权限 `600`。该文件及 `.env` 均被 Git 忽略。
3. 从项目根目录启动：

```sh
python3 scripts/manage_video_scheduler.py start
python3 scripts/manage_video_scheduler.py status
python3 scripts/manage_video_scheduler.py logs
```

`start`先构建镜像并调用完整只读probe，预检失败不启动；生产模式同时启动video-scheduler/maintenance-scheduler，同镜像、独立健康文件。生产默认每10秒一批/最多4并发，一批未完成不启下一批，失败最多退避300秒；数据库另限制全局8/普通6/单类2、资金保留2机会。配额是跨进程保护，不代表已验收的吞吐。

`status` 中服务应为运行状态，并最终显示 `healthy`。健康检查依据最近成功派发时间；后台失败会保留错误码。`start` 重跑用于恢复停止的服务，不会创建新 Supabase 项目。

每分钟独立monitor，健康要求最近三分钟采集成功；生产/维护分别保留故障记录。run仅执行已入队的视频/媒体/知识/情报/翻译/字幕/编排/发布与原渠道交易/退款查询，maintenance独立处理计划、留存/删除、指标，错误互不阻断。alerts profile使用独立进程投递DB及离线卷事件，原事件UUID/渠道回执与未确认历史保留；正式Relay送达和宿主外部监控须另验收，不自动新发现金退款或重提unknown。

```sh
python3 scripts/manage_video_scheduler.py stop
```

停止仅停止后续派发，正在执行的请求可在 160 秒宽限内完成，原任务与扣费记录不会删除。用于本机 Docker 时，关网页仍继续工作，但关闭 Docker 或电脑休眠会暂停；生产环境应放在常驻服务器。

## Supabase Cron：无需常驻外部主机

本节是旧视频单队列的可选调度。现有SQL不能覆盖新production/monitor/FFmpeg；全栈启用采用前节常驻生产模式，勿同时启动两种视频派发。

目标平台需支持 pg_cron、pg_net、Vault。使用受控数据库管理连接执行：

1. 在 Vault 中配置各一个 `supabase_url`、`video_worker_secret`，值与目标项目及 Edge Secrets 一致，不能重名。
2. 部署新版 Worker 后，用独立调度器 `--probe` 或受控 HTTP 请求执行 `{"action":"probe"}`，应返回 `{"ready":true,"version":1}`。SQL 安装只能确认数据库/Vault 就绪，无法同步确认 Edge Function 已部署。
3. 执行 `supabase/ops/video_worker_schedule.sql`。脚本会检查迁移与 Vault 配置，重复安装更新同一个 `shopro-video-workers` 任务，默认每 10 秒运行。
4. 执行 `supabase/ops/video_worker_status.sql` 检查 Cron 活跃、HTTP 响应和任务计费状态。只有任务到期时才发请求；全局最多 4 个未完成请求。HTTP 超时或超过 180 秒没有响应的请求会回收派发名额，业务任务仍按数据库租约防止重复提交。
5. 停止派发执行 `supabase/ops/video_worker_unschedule.sql`，保留业务记录。

派发摘要在 `video_worker_dispatches` 保留 7 天，包含请求编号、时间、状态码和处理数量，不包含密钥及响应原文。pg_net 自身管理的请求队列中会暂存 Authorization，须保持其平台默认管理权限。

## 页面关闭后的验收

在自己的测试账号提交一条模型任务后关闭网页，查看调度器日志或 Cron 派发摘要。数据库应从 `queued` 到 `submitted`，最终 `completed/settled` 或 `failed/refunded`；再次登录时作品库可见成片，失败流水能关联原扣费。重复调度不会重复扣费或退款。

`unknown` 提交结果不按超时自动退款，须按 [运维核对流程](RUNBOOK.md#42-受理未知)核对原账号与上游受理情况。健康检查通过也不等于真实模型生成成功或配置可解密，实际验收需目标模型已配置并联调。`video-jobs.query` 可能执行任务，不是只读 probe。

本地验证：

```sh
pnpm test:scheduler
pnpm test:alert-delivery
pnpm test:video
```

测试包含周期恢复、预检不消费任务、HTTP 异常脱敏、并发限制、Cron 重装、到期派发及过期请求回收。数据库测试使用真实 PostgreSQL 与业务迁移；Cron/pg_net/Vault 使用隔离替身，不连接云端、不调用收费模型。

关闭网页和停用调度不同：浏览器视频query仍可领取，冻结需控制生成/查询入口。监控/恢复见[运维手册](RUNBOOK.md)，本轮验证见[实施台账](OPTIMIZATION_IMPLEMENTATION_20261027.md)；目标吞吐、真实恢复/渠道/SMS/模型/平台与外部告警另验收。
