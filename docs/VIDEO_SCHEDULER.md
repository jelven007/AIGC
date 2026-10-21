# 视频任务后台调度

更新：2026-10-21，源码基线 `ce90bfe`。当前实际使用官方 Supabase 云端 Cron；火山方案默认常驻 ECS Docker，尚未部署验收。火山 Cron 扩展需在目标环境确认后才能使用，见 [火山部署指南](VOLCENGINE_DEPLOYMENT.md)。

独立 Docker 调度器和 Supabase Cron 配置均已就绪，部署时选择其中一种。调度完全不依赖网页；主机或云端服务必须保持运行。2026-10-21 已创建并接入用户的官方 Supabase `aigcp` 项目，云端 Cron 已启用且完成后台退款验收，见 [部署记录](DEPLOYMENT_AIGCP.md)。当前使用云端 Cron，独立 Docker 调度器未同时启动。

## 推荐：常驻服务器的 Docker 调度器

最新版需要目标环境已核对并应用 00030–00034，特别是 `model_config_version_id`、新版领取函数与配置权限；部署匹配的 `video-job-worker` 与共享模块，并在 Edge Secrets 配置 `VIDEO_WORKER_SECRET`（至少 32 字符）和 `MODEL_CONFIG_ENCRYPTION_KEY`。模型密钥在管理员设置页保存加密版本，调度器无需 service_role、主密钥或模型密钥。

当前官方旧环境仅到 00031、旧 Worker 与 Cron 已运行；不得只替换新版 Worker。缺 00034 时新版 probe 将失败，旧任务还需要核对原账号后绑定版本。升级顺序见 [开发指南](DEVELOPMENT_GUIDE.md)。

1. 在 `deploy/video-scheduler/` 将 `.env.example` 复制为 `.env`，填入自己的 `SUPABASE_URL`。不要使用源仓库演示项目。
2. 将同一 `VIDEO_WORKER_SECRET` 原值写入该目录的 `video_worker_secret` 文件，无变量名，建议文件权限 `600`。该文件及 `.env` 均被 Git 忽略。
3. 从项目根目录启动：

```sh
python3 scripts/manage_video_scheduler.py start
python3 scripts/manage_video_scheduler.py status
python3 scripts/manage_video_scheduler.py logs
```

`start` 先构建镜像并调用只读 `probe`，验证目标函数、专用密钥和任务迁移；预检失败不会启动调度。成功后容器以 `restart: unless-stopped` 后台运行，每 10 秒开始一批、最多 4 个并发 Worker 请求。一批未完成不会启动下一批，失败退避最多 300 秒。日志不包含密钥或远端响应内容。

`status` 中服务应为运行状态，并最终显示 `healthy`。健康检查依据最近成功派发时间；后台失败会保留错误码。`start` 重跑用于恢复停止的服务，不会创建新 Supabase 项目。

```sh
python3 scripts/manage_video_scheduler.py stop
```

停止仅停止后续派发，正在执行的请求可在 160 秒宽限内完成，原任务与扣费记录不会删除。用于本机 Docker 时，关网页仍继续工作，但关闭 Docker 或电脑休眠会暂停；生产环境应放在常驻服务器。

## Supabase Cron：无需常驻外部主机

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
python3 tests/test_video_scheduler.py
python3 tests/test_video_schedule_db.py
npm run test:video
```

测试包含周期恢复、预检不消费任务、HTTP 异常脱敏、并发限制、Cron 重装、到期派发及过期请求回收。数据库测试使用真实 PostgreSQL 与业务迁移；Cron/pg_net/Vault 使用隔离替身，不连接云端、不调用收费模型。

关闭网页和停用调度是不同动作：停用只停止后续派发，浏览器查询仍可领取；发布冻结需同时控制用户生成/查询入口。监控阈值、发布、故障和恢复见 [运维手册](RUNBOOK.md)，本次结果见 [验证报告](TEST_REPORT_20261021.md)。
