# 火山引擎部署指南

当前 [迭代29](ITERATION_29_ALERTS_RECOVERY.md)要求00032–00058/全部匹配共享模块、operations与production-worker、probe18调度/告警持久卷/前端，render4/edit2和MCP59/19权限保持。发布工具核对probe18/00058；旧00056摘要不变，00057增量修复扣费锁序。新加密备份/恢复镜像见 [指南](BACKUP_RECOVERY.md)，先在空隔离PG恢复并验证实物/账本/历史密钥。火山与官方托管资源不同，不能用火山回执重放官方旧库；目标告警/备份调度与平台迁移仍待验收。

最新 [迭代28](ITERATION_28_OPERATIONS_WORKFLOWS.md)要求00032–00056及匹配operations/production-worker/全部共享模块、调度与前端，保留MCP59/19权限和render4/edit2。verify严格要求probe17/00056/render4/edit2；备份必须覆盖原任务/资金/模型版本、工单/消息、租户策略/团队预占、风险处置与不可变现金账本。火山和官方目标均无本轮部署回执，真实业务/容量及恢复验收仍需执行。

最新 [迭代26](ITERATION_26_EDITOR_ASSETS.md)要求00032–00054与匹配material-assets/production API和共享模块、常驻调度、前端/MCP58及重建FFmpeg。verify严格要求probe15/00054/render4/edit1，旧render3领取前拒绝；新增material_upload_receipts须备份并验证Storage MIME/大小元数据与共享权限。火山及官方目标均没有本轮部署回执，不能单独更新前端。

最新 [迭代25](ITERATION_25_EDIT_ANALYSIS.md)要求00032–00053与匹配production-jobs/production-worker/共享模块、常驻调度和前端，FFmpeg镜像重新构建包含固定ONNX/许可证。verify严格要求probe14/00053/render3/edit1；旧render2领取前拒绝。目标须验证真实Whisper、人物质量/旋转和长素材CPU/临时空间，火山资源仍无新增部署验收证据。

最新 [迭代24](ITERATION_24_WECHAT_TRANSACTIONS.md)要求00032–00052全栈与新增wechat-trade-ops/wechat-refund-webhook及匹配共享模块、现有支付/运营/production-worker/调度/前端。verify严格要求probe13/00052/render2；退款回调关闭平台JWT，原文微信签名/AES在函数内验证。原商户与退款台账须保留，真实商户和火山部署资源仍无新增验收证据。

最新 [迭代23](ITERATION_23_DATA_LIFECYCLE.md)要求00032–00051与匹配production-jobs/production-worker/knowledge-base、共享模块、调度/MCP56/前端同窗。verify严格要求probe12/00051/render2及迁移回执。撤销旧Storage/知识直接删除策略，验收原UUID撤销、实际对象与供应商删除、未知保护及备份恢复；火山资源仍无新增部署证据。

最新 [迭代22](ITERATION_22_CHECKOUT_LOADING.md)发布范围00032–00050，两支付创建函数/checkout共享模块/production-worker/常驻调度/前端同窗口；verify要求probe v11/00050/render2，MCP仍54工具。客户端须确认原UUID/金额/积分，旧支付客户端不兼容。目标验收商户签名/回调、同单恢复和改价权益；火山资源无新增部署回执。

最新 [迭代21](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)需发布00032–00049与匹配product-management/market-intelligence/production-jobs/production-worker、常驻调度/MCP54/前端；verify要求probe v10/00049/render2与迁移回执。通知不新增Edge入口，authenticated RPC/RLS与页面同窗口。eBay图片搜索权限、视觉文本模型、私有素材与真实通知/关页/版本/清理需目标验收；火山仍无新增部署证据。

最新 [现金与运营迭代20](ITERATION_20_CASH_OPERATIONS.md)要求发布00032–00048、operations/资金函数/匹配production-worker/调度与前端。verify要求probe v9/00048/render2及迁移回执，manifest增加operations（函数内个人JWT鉴权、拒绝service/API Key）。按实际Auth服务端元数据或operator_grants授予运营角色，profile.role无效；真实支付宝和历史权益/预算/授权范围必须验收。火山资源仍无新增部署回执。

最新 [商品管理迭代19](ITERATION_19_PRODUCT_MANAGEMENT.md)发布00032–00046，manifest增加product-management并在函数内验证JWT/API Key；同步production-worker、常驻调度和MCP52/18权限。verify同时要求迁移回执及probe v8/00046/render2。00046浏览器商品写入撤销，必须匹配API/前端；仍需目标BaaS/图片签名/真实商品来源、Pages/TLS及持续调度验收。

发布组新增 [00045](ITERATION_18_PUBLISH_GROUPS.md)，迁移清单自动纳入；目标需完整00032–00045、匹配platform-publish/production-worker/probe v7和47工具MCP镜像，再发布前端。没有新增平台秘密或网关宽泛权限，API内部维持当前用户与16范围。真实火山资源/平台授权/审核/定时验收尚未执行，不能把本地验证记为部署完成。

新增 [MCP迭代17](ITERATION_17_MCP_PRODUCTION.md)发布要求：45工具镜像、16权限与匹配六业务函数；manifest/config关闭platform-accounts网关JWT，函数内仅list/creator接受受限Key，OAuth/应用管理仍用户JWT。schema仍00044，先后端/Worker再MCP与前端；公网TLS/Host和真实模型/平台验收尚未执行。

当前清单新增market-intelligence，需00032–00044和匹配production-worker探针v6/20槽设置页；官方协议、授权数据商、预算监控和留存验收见 [迭代15](ITERATION_15_MARKET_INTELLIGENCE.md)。仍只有适配代码与本地验证，火山资源/真实供应商未运行验收；先发布后端/Worker并验证，再发布前端。

本轮清单新增knowledge-base，最新版增量00032–00043与production探针v5，当前17槽含独立Embedding。需在目标环境核实新知识RPC、加密历史版本、真实模型权限与有界向量性能，按 [知识迭代14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)验收后最后发布前端。本轮只有本地代码/清单更新，火山资源与真实供应商尚未运行验收。

最新发布范围扩展00032–00042，新增 [统一观测及实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)。manifest自动包含measurements和measurement-ingest，两者网关JWT关闭后分别由业务鉴权/HMAC验证；须匹配ai-assistant及production-worker v4，数据库在前、前端在后。登记已授权采集来源并验收签名/日版本/随机分流，不能从部署函数成功推断真实广告、电商数据或ROI已接入。火山资源和供应商仍待验收。

当前源码发布范围00032–00041，匹配production-jobs/production-worker/ai-assistant/phase3-assistant及共享依赖，重建FFmpeg镜像，前端最后发布。[素材分析迭代12](ITERATION_12_GROUNDED_ANALYSIS.md)要求真实视觉/ASR配置、两段Worker与私有输出。火山资源与实际供应商仍无新验收证据，部署工具自动发现00041不等于已应用。

目标方案：火山 AI 原生 BaaS Supabase 版 + 火山 Pages + ECS Docker 调度器，模型可用火山方舟。该方案使用火山独立管理面，前端无需 Vercel；**当前实际仍连接官方 Supabase，未切换火山**。源码基线 `ce90bfe`，尚无火山资源创建/部署验收证据；授权准备不等于资源上线。见 [当前状态](CURRENT_STATE.md)。

源码增量包含00035–00039，最新多规格导出须部署匹配production-jobs、重建FFmpeg镜像与既有production调度，前端最后发布。00039的导出事务/共用渲染队列配额/4:5/旧回执与实际验收见 [迭代10](ITERATION_10_RENDER_EXPORTS.md)；本段不更新真实云端回执，不重放已应用旧迁移。

最新媒体增量扩展到00040，配套production-worker版本2和16槽model-settings，旧同步音频入口410；D-ID/Sync/ElevenLabs服务端协议与五类后台计费任务见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)。只应用缺失增量，更新匹配共享模块/生产调度，再发布前端；真实签名素材、声音/口型/账单和关页恢复仍须在目标账号验收，本地夹具不改变云端部署事实。

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

配置BaaS HTTPS根地址/anon key及实际域名MCP_ALLOWED_HOSTS，HTTP绑定ECS本机端口经TLS代理公开/mcp；请求携带用户JWT或受限业务Key。45工具不配置模型Key/service_role，创建保存原UUID/参数，媒体确认价格，不自动重发POST。

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
