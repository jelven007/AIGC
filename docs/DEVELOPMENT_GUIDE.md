# 开发指南

最新 [迭代32](ITERATION_32_REWARDS_AUTH.md)：新增00060接管快照邀请触发器但不补发历史。资格与领取共用数据库函数，先保存本人原UUID，未知响应复用回执；敏感写入使用accountRequest固定原账号令牌。禁止注册后浏览器upsert档案或直接写奖励/错误表。test:rewards/test:rewards-ui覆盖真实PG及开发/压缩操作；probe20/00060/render4/edit2同窗更新。下文为历史规则演进。

当前 [迭代30](ITERATION_30_WORKS_LIBRARY.md)复用materialAssets上传/原回执/身份核对和useRecentWorks限40条只读入口；作品分页每页24项，服务端搜索做字面匹配。公开演示媒体不进入生产资源；测试MP4/WAV只生成在.volcengine-build。

当前 [迭代31](ITERATION_31_ACCOUNT_STORYBOARD.md)：新增00059，不修改旧迁移；资料读取失败不得自动插入profiles或代做注册。认证回调内不能等待SDK自身锁，异步结果须检查当前账号/代次；账号布局、缓存和继承路由输入隔离。SSE工具已返回解码正文，调用方不要再次JSON解析文本；完整响应与分镜校验后才更新结果。新增test:profile/test:profile-ui，probe19/00059/render4/edit2同窗更新。

历史 [迭代29](ITERATION_29_ALERTS_RECOVERY.md)：00057修复套餐→团队/风险→团队行锁，00058刷新规则/告警事件/心跳。备份恢复只向空隔离库，秘密文件0600且Docker context忽略。

最新 [迭代26](ITERATION_26_EDITOR_ASSETS.md)：materialAssets API与五个独立资源/上传/录音/音频/预览组件共用私有路径、原UUID和实际时长；00054核对存储证据、回执和墓碑。删除旧模拟资源交易、演示工程和装饰波形；MediaBlobCache限制账号/页面内128MB，render4执行真实EQ/回声/调制。执行test:assets、MCP58/权限、浏览器和原剪辑回归；probe15/00054/render4/edit1与匹配服务同窗发布。

最新 [迭代25](ITERATION_25_EDIT_ANALYSIS.md)：edit-contract/edit-jobs统一原音轨与价格/版本，00053复用队列/租约/原退款，edit_analysis.py读取真实PCM节拍；person_mask.py校验固定模型并生成FFV1透明视频，render.py分别合成原音轨并验证时长/空间。禁止固定间隔铺字幕、未知请求重发或运行期下载任意模型。执行test:edit/真实页面和原render/任务中心/情报/调度/部署；probe14/00053/render3/edit1，重建镜像与匹配全栈。

最新 [迭代24](ITERATION_24_WECHAT_TRANSACTIONS.md)：00052与wechat-transactions/wechat-refunds负责原商户/期限/租约、官方RSA/AES及原路退款，cash-trade-ops共用两渠道权限与原申请，apply_cash_refund只经渠道证据入口。新增test:wechat/浏览器原订单和渠道恢复，回归cash/checkout及调度/部署/Deno/压缩构建；probe13/00052/render2，旧插件不再参与微信支付。

最新 [迭代23](ITERATION_23_DATA_LIFECYCLE.md)：00051统一引用索引/对象锁、清理租约、声纹撤销/原版本DELETE、知识副本和七天证据清理；对应media-cleanup/media-jobs、production/knowledge API、MediaJobsPanel/KnowledgePage及MCP56。禁止直接Storage删除、撤销后重启声纹或重发未知请求。执行test:lifecycle及媒体/知识/访问/MCP、browser_data_lifecycle、Deno/调度/部署/构建；probe12/00051/render2，真实删除与容量仍需目标验收。

最新 [迭代22](ITERATION_22_CHECKOUT_LOADING.md)：00050/checkout共享事务、两支付创建函数、checkout API/PaymentDialog和CreditsPage原请求；禁止回退静态二维码/按截图成功或删除unknown请求重提。执行test:checkout、browser_checkout、现金/支付、probe11调度/部署及工程检查。Vite缓存按后端主机隔离，构建验证产物不触发热更新；measure_frontend_bundle计算静态依赖总量，不能只报告entry大小。

最新 [迭代21入口](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)：00049/product-translation/intelligence-image、两业务API/production-worker、ProductTranslationDialog、MarketIntelligenceWorkspace/VideoAnalysisPanel、notifications API与useNotifications。译文保存必须绑定source_updated_at，图片参数必须canonical引用/原指纹，竞品统计由DB取证；通知状态来源/偏好/批量cutoff不在浏览器模拟。执行test:translation、综合浏览器、MCP54目录/scopes、任务中心/调度/部署与工程检查；probe v10/00049/render2。

新增 [现金退款与运营入口](ITERATION_20_CASH_OPERATIONS.md)：00047/00048、cash-refunds共享模块、operations/Alipay两函数、OperationsPage与用户订单回执。不得恢复profile角色/浮点累计/浏览器财务写、供应商原响应日志或无UUID重发；所有新扣费均经账户锁/UTC日预算。修改权益需验证欠额、旧周期/加油包和支付锁顺序，执行test:cash/finance/payments、browser_operations、Deno/调度/工程检查；发布probe v9/00048与匹配服务。

商品模块最新入口见 [迭代19](ITERATION_19_PRODUCT_MANAGEMENT.md)：共享product-contract/product-import、product-management、ProductFields/UrlProductImportDialog、productCsv和00046；修改字段须同步前后端规范化及RPC回执。使用test:products与浏览器专项验证，禁止恢复默认商品/库存/图片或本地隐藏删除。MCP目录由真实SDK导出，重建镜像并检查52工具；常驻调度要求probe v8/00046。

发布组入口见 [迭代18](ITERATION_18_PUBLISH_GROUPS.md)：00045、publish-contract.ts、platform-publish、PublishPage及MCP两个工具。`npm run test:publish`执行真实PG和Edge，browser_publish_groups.mjs验证页面恢复；修改options须同步三端。不得为每账号另建供应商直连或重试整组旁路，保存预览源/原UUID，SQL原子回滚并共用24队列配额。MCP当前47工具需重新导出与镜像重建。

MCP修改见 [迭代17](ITERATION_17_MCP_PRODUCTION.md)：45工具仅调用业务API，先构建shoproai-mcp:local后运行`npm run test:mcp`；`python mcp/export_tools.py`生成目录，`--check`检查漂移。权限统一api-scopes.ts，不能新建供应商/资金旁路，写入必须保留原UUID且不自动重发；新增scope同时验证拒绝、所属用户和网关配置。

剪辑效果修改见 [迭代16](ITERATION_16_RENDER_EFFECTS.md)：render-effects.ts与render_effects.py维护对应标识；不得把用户表达式直接插入FFmpeg图。`test:render`同时验证API协议与实际成片，browser_render_effects.mjs验证参数/保存恢复/移动控件。RGB滤镜须保留alpha；新增模块必须进入Worker重建镜像，禁止只提交前端效果名称。

市场情报入口见 [迭代15](ITERATION_15_MARKET_INTELLIGENCE.md)：00044、intelligence-provider/jobs、market-intelligence与共用MarketIntelligenceWorkspace，20槽。运行`pnpm test:intelligence`验证实际PG与协议；旧竞品表只读，不把预置数据迁入来源表。新增Provider须验证正式端点、指标口径、缺失字段及合同权限；接口/Worker/数据库与前端一起交付。

知识开发入口见 [迭代14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)：统一knowledge_entries，不再创建prompt_knowledge旁路；正文摘要/全文由受限触发器计算，向量只能Worker写。独立Embedding默认17槽，knowledge-base、knowledge.ts、00043和ScriptPage/sse/text-handler共同交付；测试`pnpm test:knowledge`，真实PG及协议无需供应商费用。修改配置目录同步数据库model_slot_catalog；扩大语料先评估精确扫描容量，不直接增加配额。

00042入口见 [统一观测及实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)：MeasurementDashboard、ABTestPage、measurements/measurement-ingest及measurement-input/statistics，真实迁移/权限/事务通过`npm run test:measurements`；browser_measurements.mjs验证三看板、Excel与原请求恢复。禁用旧ab变体直写，来源密钥不持久化浏览器，累计自然数据不转换为广告/实验样本。所有观测表通过服务端API，不新增前端service_role。

增量00041开发入口见 [真实素材分析](ITERATION_12_GROUNDED_ANALYSIS.md)：VideoAnalysisPanel、_shared/video-analysis、structured-analysis、worker/analyze.py。使用`npm run test:analysis`验证真实迁移/协议/FFmpeg，浏览器脚本browser_video_analysis.mjs验证失联恢复与MP4请求。输入视频≤100MB/10分钟，抽样帧不代表完整镜头或BPM测量。

更新：2026-10-21，源码基线 `ce90bfe`。先读 [当前状态](CURRENT_STATE.md) 与 [PRD](prd/PRD.md)。本地源码比当前官方 Supabase 云端新，启动前端成功不代表新版接口已部署。

## 1. 环境与首次启动

推荐 Node.js 22+、pnpm 10.34.5、Python 3.12、Docker Compose、Git；Edge Functions 使用 Deno，当前验证使用 Deno 2.2.6。数据库隔离测试依赖 Docker PostgreSQL 16。包版本以 [package.json](../package.json) 和锁文件为准。

从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

复制配置仅用于首次初始化；已有 `.env.local` 时直接编辑，保留目标环境配置。浏览器使用 `http://localhost:5173`；Auth 站点和重定向地址必须允许该地址。

前端仅配置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。anon/publishable key 是公开客户端凭据，访问权限依赖 Auth、GRANT 和 RLS。模型 Key、service_role、Worker、支付私钥和加密主密钥只进入服务端；构建会拒绝敏感 `VITE_*KEY/SECRET/TOKEN/PASSWORD`。

没有本机 Node 时可用开发容器：

```sh
docker run --rm -it -p 127.0.0.1:5173:5173 \
  -v "$PWD:/app" -w /app node:22-alpine \
  sh -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm dev'
```

容器和宿主若架构不同，不共享安装后的 `node_modules`；安装依赖应在实际执行环境进行。本轮测试使用 Node 20 Alpine，补装其 arm64/musl 原生依赖后构建通过，不代表必须降级开发环境。

## 2. 后端初始化

| 环境 | 管理工具与入口 | 注意 |
| --- | --- | --- |
| 当前官方 Supabase | 官方管理面及受控迁移流程，[部署记录](DEPLOYMENT_AIGCP.md) | 已到 00031，00032–00034 与配套函数尚未发布 |
| 火山 BaaS Supabase 版 | `byted-supabase-cli`，[火山指南](VOLCENGINE_DEPLOYMENT.md) | 独立 workspace/branch；不能沿用官方管理令牌或推断已迁移 |
| 隔离测试数据库 | `tests/test_finance.py` 创建 PG16 与平台替身 | 不提供真实 Auth、Storage SDK、PostgREST 或云端函数运行环境 |

新库按顺序执行生产迁移，排除 00018/00019 演示数据/访问策略。已有库只应用核对后缺失的迁移；不把全量迁移和 `schema.sql` 再跑一次。火山脚本使用私有 SHA-256 回执，拒绝自动重放没有该回执的旧业务库。

新版模型服务要求 00034、`MODEL_CONFIG_ENCRYPTION_KEY`、匹配的函数与共享模块。通过 Auth 管理面授权真实管理员后，在 `/settings/models` 配置接口；不能通过 `profiles.role` 或 `user_metadata` 提权。完整步骤见 [模型设置](MODEL_SETTINGS.md)。

访问控制增量要求00037及 `api-keys/team-space/material-assets`，业务Key入口与production Worker同步更新。团队成员/Key不能再从Data API直接写入；素材删除使用持久化outbox，客户端统一 `src/api/accessControl.ts`。专项入口 `npm run test:access`，页面夹具 `tests/browser_access_control.mjs`；兼容与网关要求见 [访问控制迭代](ITERATION_08_ACCESS_CONTROL.md)。

批量增量要求00038、batch-video-jobs和匹配共享视频Worker，客户端 `src/api/batchVideoJobs.ts`。父子创建/套餐/价格/预算统一事务；暂停与取消用父锁，已提交不停止查询。调用端不得直接写批次表；专项 `npm run test:batch`，页面夹具 `tests/browser_batch_video.mjs`，见 [批量迭代](ITERATION_09_BATCH_VIDEO.md)。

多规格增量要求00039、production-jobs与更新的FFmpeg镜像；沿既有production调度。客户端createRenderExport只提交源作品ID/规格/原UUID，禁止先写占位作品。共享队列配额/旧回执兼容见 [迭代10](ITERATION_10_RENDER_EXPORTS.md)。专项 `npm run test:exports`、`npm run test:render`、`tests/browser_render_exports.mjs`。`npm run lint`要求PATH可找到ast-grep；缺工具或规则失败会终止，不再记录为通过。

媒体增量要求00040及匹配production-jobs/production-worker/model-settings，16槽包括D-ID/Sync/ElevenLabs；新types为tts/asr/voice_clone/avatar/lipsync，统一原流水计费、版本、租约和证据。客户端MediaJobsPanel及原services/audio调用后台任务，先持久化原UUID/确认价格，503不换键；旧同步入口410。专项`npm run test:media`和`tests/browser_media_jobs.mjs`，完整协议、声纹版本、输入/响应限制与真实验收见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)。

## 3. 目录与修改位置

| 目录 | 职责 |
| --- | --- |
| `src/pages`、`src/components` | 页面、业务交互、生成任务恢复和模型设置 |
| `src/db`、`src/lib` | Supabase 客户端、任务 API、模型目录及输入转换 |
| `supabase/functions/_shared` | 身份验证、协议、配置加解密、计费补偿、视频状态处理 |
| `supabase/functions/*/index.ts` | HTTP 入口；输入/身份校验与业务调用 |
| `supabase/migrations` | 递增数据库迁移、权限、资金事务、队列与配置版本 |
| `supabase/ops` | Cron 安装、状态与停用脚本 |
| `scripts`、`deploy` | 发布预检、后台调度、Docker 与配置模板 |
| `mcp` | JWT/受限Key与业务API共用的45工具、SDK目录/传输边界 |
| `tests` | 真实事务、受控上游协议、调度与发布回归 |
| `backend` | 缺少核心源码；不作为现有可运行后台 |

## 4. 实现约束

- 关键财务与视频状态只走服务端 RPC；Data API CRUD 同时核对显式权限和 RLS。不接受客户端传来的退款金额、用户 ID 或终态作为证据。
- 新视频使用显式 UUID 幂等键；同一逻辑请求重试复用键和全部参数。创建响应丢失先找回，不能换键重提。
- 配置保存追加不可变版本；新任务事务绑定版本。改账号、停用或换 Key 不改变旧任务；主密钥轮换需专门密文迁移。
- Worker 一次有限处理，不在 Edge Function 内持续轮询。上游 POST 受理未知时暂停核对；查询/转存错误重试，明确失败才退款。
- 用户界面如实区分排队、生成、待核对、成功、退款。模拟数据不能包装成真实模型、真实销量或已发布结果。
- 添加供应商时新增/扩展协议适配器并验证素材、规格、ID 和失败语义；修改地址本身不能兼容新协议。
- 日志使用任务 ID、订单号、配置版本和错误分类，不输出 Key、JWT、私钥、上游完整正文或私有素材。

## 5. 检查与变更交付

```sh
npm run typecheck
npm run test:finance
npm run test:payments
npm run test:video
npm run test:models
npm run test:scheduler
npm run test:volcengine
python3 tests/test_mcp_backend.py
npm run build
git diff --check
```

MCP 测试先在虚拟环境安装 `mcp/requirements_mcp.txt`。Deno 检查从仅挂载 `supabase` 的运行目录执行，避免根目录 npm 配置干扰。`npm run lint` 包含历史 `.rules` 工具和固定路径，不能据类型检查通过宣称整个 lint/CI 已通过；本轮执行范围见 [验证报告](TEST_REPORT_20261021.md)。

涉及 API/状态/权限/收费变更时同步 [接口与数据](API_AND_DATA.md)、[测试计划](TEST_PLAN.md)、[运维手册](RUNBOOK.md) 与 [追踪矩阵](CHANGE_TRACEABILITY.md)。提交说明用中文概括实际变更，先本地提交，远端名称与内容确认后再推送。

## 6. 发布顺序

先保存数据库/Storage/密钥恢复材料并记录版本，再冻结新生成入口、停止后续调度并等待在途请求结束。应用核对后的新增迁移，部署匹配的函数与共享模块，配置 Secrets/管理员/模型版本，绑定核对过的旧任务，执行只读 probe 与隔离权限检查，恢复一种调度器，完成真实业务验收后发布前端。

不单独部署依赖新 RPC 的前端，不将函数 `version:1` 或健康检查结果当作 Git 提交证明。不可变配置与新增数据库字段优先向前修复；回滚函数前核对签名兼容性，不能删除任务、资金流水或旧密文。
