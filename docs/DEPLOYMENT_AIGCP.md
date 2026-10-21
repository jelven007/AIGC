# aigcp 环境部署记录

最新待发布范围00032–00052，见 [迭代24](ITERATION_24_WECHAT_TRANSACTIONS.md)：新增wechat-trade-ops/wechat-refund-webhook与匹配微信创建/支付通知、支付宝交易/operations/production-worker及共享模块、调度/前端。probe13/00052/render2；回调使用微信原文签名鉴权，不带Supabase JWT。最近官方00031/三旧函数证据未变，真实商户/回调/退款/历史绑定和全栈仍需验收，本段不是上线回执。

最新待发布范围00032–00051，见 [迭代23](ITERATION_23_DATA_LIFECYCLE.md)：引用索引/清理租约/声纹撤销/知识副本，匹配production-jobs/production-worker/knowledge-base及共享模块、调度/MCP56/前端同步。probe12/00051/render2；旧Storage与知识DELETE策略撤销，页面必须同窗。真实供应商删除、积压/容量与备份恢复需验收，最近官方00031/三旧函数证据未变化；此段不是部署成功记录。

最新待发布范围00032–00050，见 [迭代22](ITERATION_22_CHECKOUT_LOADING.md)：两支付创建/checkout、production-worker/调度及前端同步，probe v11/00050/render2；客户端缺原UUID/确认金额/积分会拒绝。MCP54工具/18权限，资金不对Key开放。官方最近00031/三个旧函数回执未变化，此段只记录发布条件。

最新待发布范围00032–00048，见 [迭代20](ITERATION_20_CASH_OPERATIONS.md)：operations、alipay-trade-ops/alipay-trade-query及匹配production-worker/调度/前端，probe v9/00048/render2。先验收历史退款/权益周期绑定、真实支付宝签名与退款字段/到账、可信运营授权和日预算；MCP仍52工具且不开放运营资金。官方最近00031/三旧函数回执未改变，此段不构成部署成功记录。

待发布范围最新扩展00032–00046与 [商品管理](ITERATION_19_PRODUCT_MANAGEMENT.md)：新product-management、匹配production-worker/调度器/MCP52/前端，probe v8要求00046/render2。00046撤销旧商品直写，必须配合新前端一次发布窗口切换并验证签名/CSV/关页恢复。官方最近00031回执未改变，本段为发布要求，非新增部署记录。

下一发布范围新增 [00045发布组](ITERATION_18_PUBLISH_GROUPS.md)：应用缺失00032–00045，部署匹配platform-publish/production-worker及共享契约，probe v7验证组/子任务结构，再47工具MCP与前端。需实际平台账号逐项验收源读取、原ID/审核、定时/取消；本地PG/网页通过不是云端回执，最近已核验的官方00031基线未因本段改变。

下一发布包含 [MCP迭代17](ITERATION_17_MCP_PRODUCTION.md)的45工具镜像及16权限共享模块，更新knowledge-base/market-intelligence/production-jobs/api-keys/platform-publish/platform-accounts；后者网关JWT例外由函数内安全读/账号管理鉴权约束。没有新迁移，仍需00032–00044及匹配Worker；本地SDK/权限测试不改变官方环境00031/旧函数的既有回执。

下一官方升级范围为00032–00044及market-intelligence/匹配API与Worker，probe v6、20槽；正式供应商配置、日预算调度和30天清理验收见 [迭代15](ITERATION_15_MARKET_INTELLIGENCE.md)。这只是源码发布要求，未修改云端；最近核实到00031的事实不变。历史部署范围不等于当前整包依赖。

下一次官方环境升级范围扩展00032–00043、knowledge-base及匹配文本/API/production-worker，探针v5；新增17槽Embedding须真实配置与验收。正文索引/引用、恢复/退款、供应商用量检查见 [迭代14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)。本段为部署要求，不是部署回执；最近云端仍到00031，本轮未改远端环境。

本地增量00042及 [观测实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)不改变真实部署回执。下次需核对00032–00042、measurements/measurement-ingest、匹配AI/Worker probe v4和前端，再实际登记授权采集来源/验收分流与指标；现有云端00031及旧3函数不能运行新报告。

新增本地00041与 [真实素材分析](ITERATION_12_GROUNDED_ANALYSIS.md)，官方云端实际回执仍00031。本段不更新部署记录；下一次发布应核对00032–00041、共享函数、production调度、FFmpeg镜像与真实模型能力，再发布前端。

记录性质：此前部署与运行验收证据，2026-10-21 本轮只读复核。当前源码基线 `ce90bfe`，云端停在 00031 与旧三函数；不是最新全栈发布回执。以 [当前状态](CURRENT_STATE.md) 判断版本差距。

2026-10-21 已在用户 `jelven007` 的官方 Supabase 免费组织 `aigcp` 创建并接入项目。项目为亚太区域、nano 算力，未开通付费升级。

- 项目地址：`https://bbqqhkukgbgpebqpesub.supabase.co`
- 控制台：`https://supabase.com/dashboard/project/bbqqhkukgbgpebqpesub`
- 本地前端：`http://localhost:5173`

## 已部署基线与历史配置

- 迁移 00001–00031，跳过 00018/00019 固定演示用户数据并记录跳过；新增 00031 补缺失免费套餐，注册初始化发放 20 积分。
- `video-job-worker`、`video-jobs`、`ai-assistant` 与共享模块。
- Worker 专用密钥同时写入 Edge Secrets 与 Vault，后台使用独立密钥鉴权。
- 云端 `shopro-video-workers` Cron，每 10 秒检查，最多 4 个未完成 HTTP 请求。只在存在到期任务时派发，不依赖本机或浏览器。
- 本地 `.env.local` 绑定此项目，邮箱注册登录启用，回调地址限制为本地 5173。
- 此前 Docker 开发服务 `shoproai-web` 已启动并监听 `127.0.0.1:5173`，设置重启策略；本轮未重新确认容器运行状态。停止使用 `docker stop shoproai-web`，恢复使用 `docker start shoproai-web`。

部署临时令牌仅授权此项目、24 小时有效。数据库密码、管理令牌、项目服务端密钥与 Worker 密钥保存到 `.env.deploy.local`；文件权限 600、受 Git 忽略。前端 `.env.local` 仅包含公开项目 URL 与 anon key。文件不可上传到仓库。

## 此前运行验证

- Worker `probe` 返回 HTTP 200，`ready=true`。
- 真实 Supabase Auth 创建临时账号并完成密码登录，用户任务 `list` API 返回 HTTP 200。
- 使用临时账号创建 10 积分任务，未配置模型密钥；Cron 在服务端自动领取，确认尚未提交上游，任务变为 `failed/refunded`。
- 积分流水实际为赠送 +20、预占 -10、原流水关联退款 +10；余额恢复 `credits_total=20/credits_used=0`。Cron HTTP 返回 200、处理数 1，无错误。
- 验收账号和所属测试任务、流水随后清理；没有调用付费模型或支付平台。
- 前端生产构建通过，本地 HTTP 200。数据库 23 个回归用例通过。实际页面交互仍需浏览器验收。

## 当前可用范围

旧基线邮箱注册登录、服务端任务 API 和云端 Cron 已有运行证据。最新前端需要 `model-settings` 等新服务，而当前云端 `model_configs` 不存在；尚未部署 00032–00034 与相匹配的函数。不能据本地界面/旧退款验收宣称最新视频、统一配置、图片或音频可用。

最新版先核对/应用未发布迁移，部署匹配函数和共享模块，配置 `MODEL_CONFIG_ENCRYPTION_KEY` 与真实管理员，在 [模型设置](MODEL_SETTINGS.md) 配置供应商；旧任务按原账号绑定版本。历史模型 Secrets 表只用于旧基线解释，不是当前运行时配置方式。支付商户/短信/其他辅助入口尚未正式验收。

代码库中的其他模拟与旧直连功能还未全部移除，不能据此视为已完成全产品生产验收。视频批量生成、自定义视频模型继续停用。

Cron 状态可在控制台执行 `supabase/ops/video_worker_status.sql`；停用后续派发执行 `supabase/ops/video_worker_unschedule.sql`。独立 Docker 调度器配置已写入但未同时启动，以云端 Cron 为当前运行方案。

本轮复核为迁移到 00031、三个 ACTIVE/version 1 函数、10 秒 active Cron；version 1 不等于 Git 提交证明。真实模型/新版关页恢复、配置切换与支付验收按 [测试计划](TEST_PLAN.md) 执行。本次不新增资源、不部署函数、不调用付费模型；后续发布记录需补充实际提交/迁移/函数/任务证据。
