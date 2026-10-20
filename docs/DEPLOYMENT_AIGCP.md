# aigcp 环境部署记录

2026-10-21 已在用户 `jelven007` 的官方 Supabase 免费组织 `aigcp` 创建并接入项目。项目为亚太区域、nano 算力，未开通付费升级。

- 项目地址：`https://bbqqhkukgbgpebqpesub.supabase.co`
- 控制台：`https://supabase.com/dashboard/project/bbqqhkukgbgpebqpesub`
- 本地前端：`http://localhost:5173`

## 已部署

- 迁移 00001–00031，跳过 00018/00019 固定演示用户数据并记录跳过；新增 00031 补缺失免费套餐，注册初始化发放 20 积分。
- `video-job-worker`、`video-jobs`、`ai-assistant` 与共享模块。
- Worker 专用密钥同时写入 Edge Secrets 与 Vault，后台使用独立密钥鉴权。
- 云端 `shopro-video-workers` Cron，每 10 秒检查，最多 4 个未完成 HTTP 请求。只在存在到期任务时派发，不依赖本机或浏览器。
- 本地 `.env.local` 绑定此项目，邮箱注册登录启用，回调地址限制为本地 5173。
- Docker 开发服务 `shoproai-web` 已启动并监听 `127.0.0.1:5173`，设置重启策略。停止使用 `docker stop shoproai-web`，恢复使用 `docker start shoproai-web`。

部署临时令牌仅授权此项目、24 小时有效。数据库密码、管理令牌、项目服务端密钥与 Worker 密钥保存到 `.env.deploy.local`；文件权限 600、受 Git 忽略。前端 `.env.local` 仅包含公开项目 URL 与 anon key。文件不可上传到仓库。

## 运行验证

- Worker `probe` 返回 HTTP 200，`ready=true`。
- 真实 Supabase Auth 创建临时账号并完成密码登录，用户任务 `list` API 返回 HTTP 200。
- 使用临时账号创建 10 积分任务，未配置模型密钥；Cron 在服务端自动领取，确认尚未提交上游，任务变为 `failed/refunded`。
- 积分流水实际为赠送 +20、预占 -10、原流水关联退款 +10；余额恢复 `credits_total=20/credits_used=0`。Cron HTTP 返回 200、处理数 1，无错误。
- 验收账号和所属测试任务、流水随后清理；没有调用付费模型或支付平台。
- 前端生产构建通过，本地 HTTP 200。数据库 23 个回归用例通过。实际页面交互仍需浏览器验收。

## 当前可用范围

本地界面、邮箱注册登录、数据管理、服务端任务 API 和云端后台调度已具备运行条件。真实 AI 视频还需配置自己的模型 Secrets，见 [模型密钥表](ITERATION_03_VIDEO_JOBS.md#部署顺序)。暂未配置任何模型或支付渠道密钥，也未开通付费套餐；支付、短信以及其他未部署的辅助函数尚不可用。

代码库中的其他模拟与旧直连功能还未全部移除，不能据此视为已完成全产品生产验收。视频批量生成、自定义视频模型继续停用。

Cron 状态可在控制台执行 `supabase/ops/video_worker_status.sql`；停用后续派发执行 `supabase/ops/video_worker_unschedule.sql`。独立 Docker 调度器配置已写入但未同时启动，以云端 Cron 为当前运行方案。
