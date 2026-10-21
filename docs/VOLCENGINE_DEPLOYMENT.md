# 火山引擎部署指南

目标方案：火山 AI 原生 BaaS Supabase 版 + 火山 Pages + ECS Docker 调度器，模型可用火山方舟。该方案使用火山独立管理面，前端无需 Vercel；**当前实际仍连接官方 Supabase，未切换火山**。源码基线 `ce90bfe`，尚无火山资源创建/部署验收证据；授权准备不等于资源上线。见 [当前状态](CURRENT_STATE.md)。

源码增量包含00035–00039，最新多规格导出须部署匹配production-jobs、重建FFmpeg镜像与既有production调度，前端最后发布。00039的导出事务/共用渲染队列配额/4:5/旧回执与实际验收见 [迭代10](ITERATION_10_RENDER_EXPORTS.md)；本段不更新真实云端回执，不重放已应用旧迁移。

## 1. 工具与资源

本地需要 Node.js 22+、pnpm 10、Python 3、`byted-supabase-cli`；ECS 需要 Docker Compose。CLI 已核实版本 `0.1.34` 的 SQL、函数、Secrets、Pages 参数。

```sh
npx @byted-supabase/cli@latest install
byted-supabase-cli configure get -o json
byted-supabase-cli --agent yes login --remote --region cn-beijing
```

远程登录会输出授权 URL。完成火山账号授权后，将页面给出的授权码原样回填到仍在等待的 login 进程。不要将火山 AK/SK、模型密钥或 service_role key 贴入聊天。

```sh
byted-supabase-cli projects list --limit 10 -o json
byted-supabase-cli projects create shoproai --region cn-beijing -o json
```

记录真实 `workspace_id` / 默认 `branch_id`，等待资源就绪。新建算力默认常驻不休眠。生产视频需要后台持续处理，初期保持常驻；创建的是 BaaS workspace，并非独立 RDS 实例。

已经有合适 workspace 时复用，不重复 create。生产操作统一显式传 `--workspace-id`，必要时传 `--branch-id`；不要把源项目或第三方演示 workspace 当目标。

## 2. 数据库

```sh
python3 scripts/deploy_volcengine.py prepare --skip-build
python3 scripts/deploy_volcengine.py migrate --workspace-id "$SHOPRO_WORKSPACE_ID"
byted-supabase-cli db advisors --workspace-id "$SHOPRO_WORKSPACE_ID"
```

先读取业务表/迁移回执，再按顺序执行未应用迁移。一次 SQL 事务包含部署锁、迁移和 SHA-256 回执，响应丢失可安全查询回执后恢复。00018/00019 的演示数据与公开策略被排除。`00031` 免费套餐种子、`00032` 方舟 Provider、`00033` Data API ACL、`00034` 统一模型配置与任务版本绑定属于当前生产迁移。

新库需要 Auth、Storage schema、Supabase Auth 角色、`supabase_realtime` publication 和历史迁移使用的扩展可用。SQL 隔离测试使用 PostgreSQL 16 和平台替身，云端权限与扩展必须通过实际迁移确认。当前官方数据库没有火山脚本的私有 SHA-256 回执，禁止把本文 migrate 命令指向官方旧库。

已有业务表但没有本项目部署回执时脚本拒绝自动重放。迁移原 Supabase 项目需要先核对结构与历史版本，并单独迁移 Auth 用户、业务数据和 Storage 对象；本轮未自动复制任何源项目数据。

火山 CLI 没有官方 `supabase db push` 的迁移语义，脚本使用 `byted-supabase-cli db query -f`。不要将 `schema.sql` 与全部历史迁移重复执行。

## 3. 服务端密钥与函数

复制 `deploy/volcengine/secrets.env.example` 为 `secrets.env`，权限设为 600，填入：

- `MODEL_CONFIG_ENCRYPTION_KEY`：32 字节随机主密钥的 64 位十六进制表示；
- 独立随机 `VIDEO_WORKER_SECRET`，与调度器一致；
- 需要上线支付时的支付宝/微信商户配置。

模型 API Key、地址、Model ID、音色在 `/settings/models` 配置。首次管理员授权与历史 Secrets 导入见 [统一模型配置](MODEL_SETTINGS.md)。没有必要的功能保持关闭；未配置视频模型在扣积分前拒绝。模型 ID 和 Endpoint ID 必须来自当前火山账号。

```sh
byted-supabase-cli secrets set --env-file deploy/volcengine/secrets.env --workspace-id "$SHOPRO_WORKSPACE_ID"
python3 scripts/deploy_volcengine.py functions --workspace-id "$SHOPRO_WORKSPACE_ID"
```

平台提供 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`，勿覆盖。函数部署从本地 `supabase/functions` 目录读取，运行时明确为 Deno。`video-job-worker` 与两个支付回调关闭平台 JWT 验证，内部使用独立密钥/支付验签。其他函数默认 JWT 校验。源项目专属短信函数返回 410，登录使用 Auth OTP。

## 4. Auth 与 Storage

在目标 BaaS 配置实际站点 URL、允许重定向地址、SMTP 邮件或短信供应商。邮箱注册需要验证时页面提示查收邮件；短信登录通过 `signInWithOtp` / `verifyOtp` 建立用户会话，不能使用旧短信代理。未配置短信供应商时使用邮箱登录。

迁移初始化 `materials`、`videos`、`thumbnails` 桶及对象策略。前端参考素材路径以用户 ID 开头；成片由 service_role 写入固定路径。当前桶公开，生产如需私有素材需另行加入签名 URL 授权。升级前核对旧视频的原供应商配置，再按模型配置文档绑定版本；不要让新配置接管旧账号任务。

## 5. ECS 后台调度

在常驻火山 ECS 部署代码，复制 `deploy/video-scheduler/.env.example` 为 `.env`，写目标 BaaS URL，将专用 Worker 密钥写入 `video_worker_secret` 文件。调度器不需要模型/数据库管理员密钥。

```sh
python3 scripts/manage_video_scheduler.py start
python3 scripts/manage_video_scheduler.py status
python3 scripts/manage_video_scheduler.py logs
```

启动先调用 `probe`，失败不启动。默认每 10 秒一批、最多 4 并发；容器断线退避并自动恢复。确认容器 healthy 后，提交测试任务并关闭页面验证任务自动完成/退款。ECS 断电或容器停机仍会暂停派发。

详见 [视频后台调度](VIDEO_SCHEDULER.md)。pg_cron/pg_net/Vault 是可选方案，必须先确认目标火山平台支持，不能当作默认前置条件。

## 6. 构建与 Pages

从 CLI 获取目标 endpoint 和 anon key。密钥命令不要直接输出到共享终端日志：

```sh
byted-supabase-cli endpoints list --workspace-id "$SHOPRO_WORKSPACE_ID" -o json
byted-supabase-cli projects api-keys --reveal --workspace-id "$SHOPRO_WORKSPACE_ID" -o json > deploy/volcengine/keys.local
```

从本地文件提取 **anon** key 到 `deploy/volcengine/anon.local`，设置权限 600。`keys.local` 可能同时含 service_role，处理后删除或保存在受控凭据位置；它不属于前端产物。应用 `.env.local` 只配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。

```sh
python3 scripts/deploy_volcengine.py prepare \
  --backend-url "$SHOPRO_BACKEND_URL" \
  --anon-key-file deploy/volcengine/anon.local
```

生成 `.volcengine-build/frontend.zip`、SQL 和 manifest。URL、anon key 指纹、ZIP 校验值记录在 manifest。前端构建拒绝模型/支付等敏感 `VITE_*` 变量。已构建 ZIP 的连接信息不会被 Pages bind 自动改写。

首次创建 Pages：

```sh
byted-supabase-cli pages upload .volcengine-build/frontend.zip -o json
byted-supabase-cli pages create shoproai --resource-id "$SHOPRO_RESOURCE_ID" --no-deploy -o json
```

取实际 `ProjectDeployResourceID` 和 `PagesProjectID`。然后使用相同 workspace、构建配置和 Worker 密钥发布：

```sh
python3 scripts/deploy_volcengine.py pages \
  --workspace-id "$SHOPRO_WORKSPACE_ID" \
  --pages-project-id "$SHOPRO_PAGES_ID" \
  --backend-url "$SHOPRO_BACKEND_URL" \
  --anon-key-file deploy/volcengine/anon.local \
  --worker-secret-file deploy/video-scheduler/video_worker_secret
byted-supabase-cli pages deploy list "$SHOPRO_PAGES_ID" -o json
byted-supabase-cli pages binding --workspace-id "$SHOPRO_WORKSPACE_ID" -o json
```

脚本先检查迁移回执、endpoint、anon key、ZIP 指纹和 Worker probe，随后 upload → bind → deploy。`pages deploy` 提交不代表验收通过，需检查部署状态。短效 PreviewDomain 仅作立即预览；正式使用需配置稳定域名和 HTTPS。

React 使用 BrowserRouter，需要 Pages 配置 SPA fallback，直接刷新 `/works`、`/login` 等路径应返回 `index.html`；目标 Pages 的重写规则需部署后确认。若当前 Pages 产品无法配置该规则，可在火山 ECS/Nginx 托管相同 ZIP（`try_files $uri $uri/ /index.html`）。

## 7. 可选 MCP

```sh
cd mcp
cp .env.example .env
docker compose -f docker-compose.mcp.yml up -d --build
```

配置 BaaS URL/anon key及实际公开域名 `MCP_ALLOWED_HOSTS`。HTTP 只绑定 ECS 本机端口，用 TLS 反向代理公开 `/mcp`；请求携带登录用户 JWT。MCP 不使用模型 key 或 service_role。视频创建必须携带 `request_key` UUID，重试复用相同参数与 UUID。

## 8. 验收

本地命令：

```sh
npm run typecheck
npm run test:finance
npm run test:payments
npm run test:video
npm run test:models
npm run test:volcengine
npm run build
```

云端验收：邮箱/OTP 登录、RLS 用户隔离、方舟文本 SSE、视频提交/刷新恢复、页面关闭后执行、明确失败退款、成片转存播放、重复支付通知只入账一次、MCP 用户隔离、Pages 深链接刷新。真实模型验收会产生供应商用量，部署前先配置账号与配额。

最新设计见 [技术架构](TECHNICAL_ARCHITECTURE.md)。验收计划见 [TEST_PLAN](TEST_PLAN.md)，本地结果与未覆盖项见 [验证报告](TEST_REPORT_20261021.md)；正式运行还须执行 [运维手册](RUNBOOK.md) 的备份、告警和恢复要求。
