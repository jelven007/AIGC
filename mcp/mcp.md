# MCP 接入指南

本地优化基线：00065/probe23/render4/edit2；59个实际SDK工具、19业务权限、固定九入口。真实TLS/供应商/平台仍待目标验收。请求/容器资源与健康见[媒体与MCP资源边界](../docs/MEDIA_WORKER_RESOURCES.md)，最新本地证据见[实施记录](../docs/OPTIMIZATION_IMPLEMENTATION_20261027.md)。以下迭代目录摘要为历史时点，当前参数由tools.json和正文维护。

## 历史目录增量

更新：2026-10-22，迭代27目录59个实际SDK工具/19业务权限。新增submit_batch_pipeline，需独立batch:create；报价按镜头数×video+tts+可选subtitles确认整批预算。submit_publish_group支持batch_item_id，使用快照中的publish阶段原UUID和真实成片预览源并逐账号确认。00032–00055、probe16/render4/edit2和匹配全栈待发布。见 [多镜头编排契约](../docs/ITERATION_27_BATCH_PIPELINE.md)；以下旧迭代计数为历史时点。

更新：2026-10-22，迭代26目录58个实际SDK工具/18业务权限，新增get_edit_prices和submit_edit_analysis；创建沿render:create/原UUID/确认价格/片段裁剪速度与本人工程，价格读取沿jobs:read，query_production_status沿jobs:read。00032–00054、probe15/render4/edit1与匹配全栈待发布。见 [资源与MCP契约](../docs/ITERATION_26_EDITOR_ASSETS.md)；以下旧迭代计数为历史时点。

更新：2026-10-22，迭代23提供56个实际SDK工具/18业务权限，新增revoke_voice_clone与delete_knowledge_entry，沿网页原UUID/用户身份/撤销与知识副本清理事务。撤销需audio:create，知识删除需knowledge:write；未知受理不盲目退款/重发。00032–00051与probe12/render2待匹配全栈发布及真实删除验收。见 [当前状态](../docs/CURRENT_STATE.md) 与 [生命周期契约](../docs/ITERATION_23_DATA_LIFECYCLE.md)。

## 1. 入口与连接配置

HTTP 入口 http_server.py，stdio 入口 mcp_shopro_server_stdio.py；mcp_shopro_server.py 含工具定义，也可作为 stdio 入口。原极简入口只作兼容，不建立计费旁路。配置模板见 [.env.example](.env.example)。

连接参数SUPABASE_URL/SUPABASE_ANON_KEY指向目标项目HTTPS根地址；HTTP每次携带`Authorization: Bearer 用户JWT或业务Key`，MCP_ALLOWED_HOSTS填真实公开域名。stdio沿用SUPABASE_USER_JWT环境名，可提供JWT或业务Key，放受控环境。禁止service_role、anon、模型Key和加密主密钥作为用户身份；业务服务验证签名、Key摘要、权限、到期、撤销、用户禁用和速率。

HTTP ContextVar 在每次请求后重置，无状态传输避免用户会话混用；MCP 握手只表示协议可用，业务仍由后端 Auth 验证 JWT。公开服务必须 TLS 反向代理，不能沿用第三方演示域名。

## 2. 工具契约

| 工具 | 输入 | 行为/边界 |
| --- | --- | --- |
| extract_product_highlights | product_info | text-generation；提取给定资料中的真实卖点，不自动抓取URL |
| generate_marketing_script | product_highlights、target_audience、platform、language、可选knowledge_job_id | 统一文本配置；可引用当前用户已完成知识检索，条目更新/删除后过滤旧引用 |
| translate_marketing_script | script、target_language | 同一文本配置；返回 script，不承诺完美本地化 |
| synthesize_voice_tts | text、request_key、confirmed_credit_cost、voice_id、speed、格式、instruction、voice_clone_id | production-jobs.create/tts，返回后台任务；空voice使用管理员默认。旧无UUID/价格的同步调用报参数错误 |
| enhance_prompt | prompt | text-generation；enhanced_prompt |
| submit_video_generation | prompt、request_key、provider、规格、首尾帧/参考图视频、watermark=false | 七种协议按管理员配置启用；素材组合及规格由业务服务校验，返回公开job |
| query_video_status/list_video_jobs | 本地request_id或原request_key之一/无 | 查询可推进原视频任务；不使用供应商任务ID |
| get_media_prices/list_voice_clones | 无 | 读取五媒体类型积分价格/自有声纹和供应商验证状态 |
| get_edit_prices/submit_edit_analysis | 无/mode、title、source、request_key、confirmed_credit_cost、可选project_id | 价格需jobs:read，创建需render:create；保留原片段裁剪、速度、UUID和本人工程，结果由原任务查询 |
| revoke_voice_clone | voice_clone_id、request_key | 立即撤销声纹，未提交配音取消退积分；异步删除原供应商声纹，失联沿原UUID恢复 |
| submit_audio_transcription/submit_voice_clone | 私有audio_url、filename、UUID、价格；克隆另有name/consent | asr/voice_clone后台任务，声纹授权必须显式确认 |
| submit_avatar_video/submit_lipsync | 私有照片或视频/音频、title、consent、UUID、价格 | avatar/lipsync后台任务，必须授权人物与声音 |
| submit_image_generation | prompt、UUID、size/quality、reference_image、project_id | 图片或封面任务，服务端按generate_image/generate_cover预占 |
| submit_render | render_spec、project_id、UUID | 工程v1交给现有双校验和FFmpeg队列，完整协议见[API](../docs/API_AND_DATA.md) |
| submit_render_export/query_render_export | 源作品、formats、UUID/导出ID或UUID | 多规格事务导出组，包含各子任务状态和成片 |
| query_production_status/list_production_jobs | 本地job_id或原UUID/无 | 当前用户任务，结果URL短效签名，过期重新查询 |
| get_analysis_price/submit_video_analysis | 无/私有视频、title、live或style、UUID、价格，可选competitor_reference | 真实抽帧/ASR任务；竞品参考仅style且须本人sample_id/item_id/rights_confirmed:true，平台播放页不是源素材 |
| list_product_translations/translate_product | 无/商品ID、expected_updated_at、12语言、include_image布尔、确认价格、UUID | 最近20任务和价格/原版本后台翻译，原UUID恢复；明确失败退款，未知先核对；保存需source_updated_at和用户确认 |
| get_batch_video_quote/submit_batch_videos | 无/商品IDs、provider、风格语言规格、单价、总预算、UUID | 1–50个自有商品，事务固定快照/版本与整批预占 |
| submit_batch_pipeline | 原商品/2–6镜头/确认台词/音色/字幕/交付、价格/总预算/UUID | batch:create独立权限，固定全部阶段原流水/版本；实际音轨/合成，发布等预览 |
| query_video_batch/list_video_batches/control_video_batch | ID或UUID/无/batch_id及pause/resume/cancel | 读取批次，控制未提交项，已受理项继续核对 |
| list_publish_accounts/get_publish_options | 无/connection_id | 账号安全摘要/实际可见范围；网页完成OAuth授权 |
| submit_platform_publish/query_platform_publish/list_platform_publish_tasks/cancel_platform_publish | 作品/账号/title/description/tags/options/UUID/排期；原UUID/无/task_id | 发布需完整可见/商业/AIGC及consent选项；取消只影响未提交项，每账号独立UUID |
| submit_publish_group/query_publish_group | project_id/source_url/duration/内容/targets/原UUID/可选排期；原UUID | 1–10个账号各自读取权限并取得同意，稳定私有源与真实时长绑定；整组事务保存、状态独立，未知按原组查询，不重发成功项 |
| get_platform_metrics/sync_platform_metrics | 无 | 读自然视频官方指标/主动同步；同步单独metrics:sync权限，2次/用户/分钟 |
| list_knowledge/submit_knowledge_index/search_knowledge/get_knowledge_context | 查询/条目hash+UUID+价格/查询+UUID+价格/检索job_id | 读取、索引、语义查询及有效引用；不是自动训练 |
| delete_knowledge_entry | entry_id | 事务删除当前用户条目/索引/任务知识副本，未提交索引取消退款，提交未知保留原用量核对 |
| list_market_intelligence/save_intelligence_target/collect_market_intelligence | 类型/对象及source_slot/params/UUID/target_id+UUID+价格 | 读取、保存和采集正式或授权来源，字段缺失保留空值 |
| schedule_market_intelligence/import_intelligence_product/delete_intelligence_target | target_id+次数预算价格UUID/sample_id+item_id/target_id | 有界监控、真实来源商品入库、删除对象；活跃任务不能直接删 |

完整参数由[tools.json](tools.json)维护，来源为真实SDK而非手写。`python mcp/export_tools.py`更新目录，`--check`拒绝漂移。TTS速度0.5–2，克隆0.7–1.2/MP3；Step TTS数值速度须1，具体供应商功能仍需验收。

计费沿用业务入口：文本暂不扣应用积分且有频控；视频、图片、媒体、分析、知识和情报按服务端表计费，媒体/分析/知识/情报须显式确认读取的价格，批次另有预算。渲染/发布目前不扣应用积分，但消耗基础设施和平台配额。创建返回任务不代表完成；重试复用UUID与完整参数，unknown不重提、不凭超时退款。

19种权限目录由`api-scopes.ts`共用。多镜头batch:create与单视频video:create独立；批次控制继续使用video:create。商品读/写、知识读/写、情报读/写、发布创建/读取和指标读取/同步相互独立；generic jobs:read可读自有生产结果。API Key每分钟最多100次，接口另外执行用户限流。持有全部业务权限仍不能管理Key、OAuth授权/撤销、平台应用或支付。MCP仅接受固定九个业务函数，不开放任意路由。

业务网络中断或503返回脱敏错误和原request_key，不自动POST重试；响应正文上限2MB、不跟随重定向。客户端先查询原键，仍不确定则以完全相同参数恢复，不能重新生成UUID。

## 3. 本地与 Docker 启动

在 mcp 目录建立 Python 3.12 虚拟环境并运行 `pip install --require-hashes -r requirements.lock && pip check`。首次复制配置模板，已有 .env 不覆盖；直接 Python 启动前由受控环境加载参数。


default HTTP：python http_server.py，默认 127.0.0.1:8080/mcp。stdio：python mcp_shopro_server_stdio.py，用户 JWT 过期后需安全更新。

Docker：docker compose -f docker-compose.mcp.yml up -d --build；端口绑定 127.0.0.1:8080，公网通过 TLS 代理。MCP_ALLOWED_HOSTS 包含实际 Host/端口规则，不使用任意域名通配。容器重启不代表宿主始终在线。

## 4. 客户端与验收

支持 streamable-http 的客户端配置实际 /mcp URL 与用户 Authorization；stdio 配置本地 Python/入口路径和受控用户环境。客户端必须处理 JWT 过期、限流和业务错误，不能以一次 initialize 成功宣称生成链路全通。

构建`docker build -t shoproai-mcp:local -f mcp/Dockerfile.mcp mcp`后根目录`npm run test:mcp`检查SDK59工具/19权限、并发身份、媒体/编辑/编排/商品/知识/发布载荷、原UUID与错误/传输。`test:access`核验真实PG撤销/归属/限流。MCP当前图片工具保留生成/参考参数，网页掩码编辑不是新增独立MCP工具；目标需匹配00062、TLS/真实JWT/模型/平台与后台运行。

接口状态见 [API_AND_DATA](../docs/API_AND_DATA.md)，真实验收见 [TEST_PLAN](../docs/TEST_PLAN.md)，部署见 [火山指南](../docs/VOLCENGINE_DEPLOYMENT.md) 或 [官方记录](../docs/DEPLOYMENT_AIGCP.md)。MCP 与前端同版本/同后端，不能用工具绕过配置/计费。
