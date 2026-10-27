# 开发指南

更新：2026-10-27。当前66个生产迁移（68文件，最新00068）、43个生产函数入口、20模型槽、MCP59/19、probe24/render4/edit2。本轮变更见[实施台账](OPTIMIZATION_IMPLEMENTATION_20261027.md)，安装/锁/发布身份见[可复现发布](REPRODUCIBLE_RELEASE.md)；以下早期摘要保留历史时点。

## 历史开发增量

最新 [迭代33](ITERATION_33_CREDITS_SMS.md)：useCredits共用['credits',uid]查询；CreditsSync只挂AccountScope一次，accountRequest支持取消与原令牌。不得用套餐名称或读取失败的零余额授予/拒绝权益。SMS独立SDK不自动写全局会话，注册需正式VITE_TERMS_URL/VITE_PRIVACY_URL。test:account-credits及两类UI专项验证，所有历史浏览器夹具匹配新RPC。probe21/00061/render4/edit2同窗更新。

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

先读 [当前状态](CURRENT_STATE.md)与 [PRD](prd/PRD.md)。官方最近成功证据00031/三旧函数，管理最近401；本地启动不证明最新API可用。

## 1. 环境与首次启动

使用Node.js 22.23.4（.node-version）、pnpm 10.34.5、Deno 2.2.6、Docker Compose和Git。Worker/MCP/调度镜像为Python3.12，PG16备份镜像当前系统解释器为Python3.13.5，全部使用哈希锁；宿主Python仅启动隔离测试。包版本以[package.json](../package.json)和锁文件为准。

从仓库根目录执行：

```sh
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

复制配置仅用于首次初始化；已有 `.env.local` 时直接编辑，保留目标环境配置。浏览器使用 `http://localhost:5173`；Auth 站点和重定向地址必须允许该地址。

前端公开配置`VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY`，注册还需正式HTTPS `VITE_TERMS_URL/VITE_PRIVACY_URL`；缺法律资源时禁注册。anon为公开凭据，权限依赖Auth/GRANT/RLS。模型/service_role/Worker/支付与加密密钥只进入服务端，构建拒绝敏感VITE变量。

没有本机 Node 时可用开发容器：

```sh
docker run --rm -it -p 127.0.0.1:5173:5173 \
  -v "$PWD:/app" -w /app node:22.23.4-alpine \
  sh -lc 'npm install --global pnpm@10.34.5 && pnpm install --frozen-lockfile && pnpm dev'
```

容器与宿主架构不同时不共享node_modules。本轮本地验证使用Node22.23.4；旧Node20/24记录保留为历史环境。

## 2. 后端初始化

| 环境 | 管理工具与入口 | 注意 |
| --- | --- | --- |
| 当前官方 Supabase | 官方管理面及受控迁移流程，[部署记录](DEPLOYMENT_AIGCP.md) | 历史成功证据00031/管理401；重新核对后升级缺失至00068 |
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
| `src/api`、`src/db`、`src/lib` | 账号固定请求、Supabase客户端、任务/素材/商品API、模型与输入契约 |
| `supabase/functions/_shared` | 身份验证、协议、配置加解密、计费补偿、视频状态处理 |
| `supabase/functions/*/index.ts` | HTTP 入口；输入/身份校验与业务调用 |
| `supabase/migrations` | 递增数据库迁移、权限、资金事务、队列与配置版本 |
| `supabase/ops` | Cron 安装、状态与停用脚本 |
| `scripts`、`deploy` | 发布预检、后台调度、Docker 与配置模板 |
| `mcp` | JWT/受限Key共用59工具/19权限、SDK目录、九业务入口/传输边界 |
| `tests` | 真实事务、受控上游协议、调度与发布回归 |
| `backend` | 缺少核心源码；不作为现有可运行后台 |

## 4. 实现约束

- `src/App.tsx`的AccountScope按账号重建QueryClient，`src/api/accountSession.ts`固定发起账号JWT并支持取消；`useCredits`共用本人查询和单份订阅。Auth回调不等待SDK自身锁；迟到结果核对当前账号/请求代次，不能恢复旧路由输入。
- 原UUID和完整输入先保存成功再提交；保存/上传/领取/退款/编排/发布未知都按原回执恢复。JWT只留请求内存。SMS独立客户端验证原手机号后安装全局会话，不直接使用旧代理。
- 图片编辑共用image-contract/API/worker/00062；原图/掩码私有登记，实际PNG解压有界，确认原价/模型版本。checkpoint恢复不能重新读源或调用模型；刷新配置保留原输入。
- 编排复用batch_pipeline_stages及原video/production流水；待依赖阶段不占执行名额。费用/锁序修改必须回归套餐→团队/风险→团队行，不能修改已发布00056替代00057。
- 运营使用当前可信范围、原版本/UUID；工单内部消息过滤，现金账本最小币种单位/凭证/追加冲销。媒体删除使用引用索引、墓碑和租约，不能直接删Storage对象。
- 关键财务与视频状态只走服务端 RPC；Data API CRUD 同时核对显式权限和 RLS。不接受客户端传来的退款金额、用户 ID 或终态作为证据。
- 新视频使用显式 UUID 幂等键；同一逻辑请求重试复用键和全部参数。创建响应丢失先找回，不能换键重提。
- 配置保存追加不可变版本；新任务事务绑定版本。改账号、停用或换Key不改变旧任务；主密钥按keyring更换活动ID，先只读预检全部历史用途并备份，旧键保留，见[密钥轮换](KEY_ROTATION.md)。
- 任务列表/详情使用`taskQueries/useTaskQuery`，每client/key共用计时器，活跃10秒、unknown/错误30秒、终态停询、隐藏取消；新领域回执使用`taskReceipt`写后读回。
- 剪辑使用`editorHistory/editorPersistence/editorClock`，恢复结束前不自动保存，新工程先持久化完整UUID/正文，原账号串行保存。媒体工作目录使用专用磁盘并配置可信HTTPS域名，不能用tmpfs代替素材盘。
- Worker 一次有限处理，不在 Edge Function 内持续轮询。上游 POST 受理未知时暂停核对；查询/转存错误重试，明确失败才退款。
- 用户界面如实区分排队、生成、待核对、成功、退款。模拟数据不能包装成真实模型、真实销量或已发布结果。
- 添加供应商时新增/扩展协议适配器并验证素材、规格、ID 和失败语义；修改地址本身不能兼容新协议。
- 日志使用任务 ID、订单号、配置版本和错误分类，不输出 Key、JWT、私钥、上游完整正文或私有素材。

## 5. 检查与变更交付

```sh
pnpm lint
node --test tests/*.test.mjs
pnpm test:finance
pnpm test:payments
pnpm test:models
pnpm test:scheduler
pnpm test:release
pnpm test:acceptance
pnpm test:alert-delivery
pnpm test:backup
pnpm test:mcp
deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts
pnpm build
git diff --check
```

MCP先构建`shoproai-mcp:local`，媒体和备份先构建各自镜像，调度镜像使用最新runtime-contract.json。按变更选择`package.json`领域入口；UI使用明确本地夹具服务及Chromium。Deno使用公共配置/锁冻结检查全部入口；lint包含类型/Biome/ast-grep/Tailwind/编译。Mac整仓bind可能等待时，复制必要测试材料到隔离容器执行，实际加载镜像/app源码并核对SHA；不以无输出等待视作成功。本轮证据见[实施台账](OPTIMIZATION_IMPLEMENTATION_20261027.md)。

涉及API/身份/状态/权限/收费时同步需求、接口、测试、运营/财务与运维。纯文档变更核对链接/锚点/命令/契约，无需重复全量业务测试。提交/推送须有本次用户明确授权；本轮优化尚未commit/push，历史仓库规则见[版本管理](VERSION_MANAGEMENT.md)。

## 6. 发布顺序

先保存数据库/Storage/密钥恢复材料并记录版本，再冻结新生成入口、停止后续调度并等待在途请求结束。应用核对后的新增迁移，部署匹配的函数与共享模块，配置 Secrets/管理员/模型版本，绑定核对过的旧任务，执行只读 probe 与隔离权限检查，恢复一种调度器，完成真实业务验收后发布前端。

不单独部署依赖新 RPC 的前端，不将函数 `version:1` 或健康检查结果当作 Git 提交证明。不可变配置与新增数据库字段优先向前修复；回滚函数前核对签名兼容性，不能删除任务、资金流水或旧密文。

当前完整发布必须匹配00068/probe24/render4/edit2、43入口与共享模块、MCP59、前端发布身份、最终镜像、独立维护、法律资源和真实Auth/商户/平台。按[发布接受](RELEASE_ACCEPTANCE.md)核对；官方旧库不使用火山工具盲重放，仓库push不执行目标部署。
