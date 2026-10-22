# 统一模型接口设置

00053 [剪辑音轨与人物分割](ITERATION_25_EDIT_ANALYSIS.md)不增加供应商槽：字幕固定创建时audio.asr版本，要求openai-asr/whisper-1/verbose_json；无时间段失败退原积分，未知请求不重发。节拍本地FFT不调用供应商；人物PPHumanSeg在镜像构建时固定摘要/许可证并离线推理，不可通过模型设置替换任意ONNX。probe14/00053/render3/edit1，真实供应商及人物边缘/长素材质量仍待验收。

00049 [翻译与图片选品](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)不增加配置槽：翻译固定创建时text.primary版本；勾选主图文字识别须模型支持OpenAI兼容image_url数据URI，真实图片/语言质量另验收，不能仅凭探针判断。eBay图片搜索沿intelligence.ebay应用凭据/Browse官方POST与目标市场，需实际search_by_image权限。执行时私有图读取/魔数/5MB/指纹核对，供应商收到图片字节，不收到Storage签名凭据。probe v10/00049仍待全栈部署。

商品资料提取见 [迭代19](ITERATION_19_PRODUCT_MANAGEMENT.md)：使用实际JSON-LD/用户资料读取，不调用语言模型猜测商品，不需要新的模型槽位或积分价格。商品卖点/翻译创作仍使用既有真实文本模型协议；公开页提取不等于已授权所有电商原生接口。匹配00046和生产调度probe v8仍待目标部署。

00044 [情报设置](ITERATION_15_MARKET_INTELLIGENCE.md)新增intelligence.youtube/ebay/licensed，当前20槽。YouTube固定正式地址及x-goog-api-key raw；eBay固定Browse地址和Basic编码应用凭据，token仅在服务端；licensed需真实授权网关。情报不填模型ID、单次HTTP最多30秒，所有凭据继续服务端加密。以下17/16槽表述是先前迭代记录，当前目录以model-catalog及数据库目录为准。

00043 [知识索引](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)新增embedding.primary，当前总计17槽。填完整OpenAI兼容Embeddings地址及已开通模型/Key，必须返回float格式2–1536维非零同维向量；不是Chat接口。启用后用户主动确认积分提交索引/查询，新版本需重建索引；原任务始终读取旧版本，已有检索引用按正文再次核验。数据库目录model_slot_catalog统一白名单，00043/API/Worker须一起部署；旧16槽表述为前轮基线。

00042 [观测及实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)不增加模型槽。创意建议沿text.primary，先确认实际积分价，只引用背景和服务端观测，不让模型创造流量概率。广告/交易签名数据源独立登记于AB页，仅管理员，密钥同主加密体系保护但不作为LLM API Key；需实际取得来源授权和采集服务，不能用文本模型替代真实交易。

新增 [素材分析任务](ITERATION_12_GROUNDED_ANALYSIS.md)复用text.primary与audio.asr，数量仍16槽；任务固定两个旧配置版本。文本模型需真实支持image_url画面，直播ASR须openai-asr/whisper-1及可靠分段；Step只有正文时不能生成高光时间。不要在未验收时宣称视觉模型或声音权限可用。

更新：2026-10-21，源码基线 `ce90bfe`。当前官方 Supabase 仍到 00031，`model_configs` 不存在，以下为最新版启用步骤，尚未在该云端完成。不要仅发布设置页；环境差距见 [当前状态](CURRENT_STATE.md)。

入口：侧边栏「模型接口设置」→ `/settings/models`。平台管理员可编辑，普通用户仅看到模型名称与启用状态。所有客户端和 MCP 共用服务端配置。

供应商生命周期：OpenAI官方确认Sora 2和Videos API已于2026-09-24关闭，无一对一替代接口。设置页展示退役日期及 [官方说明](https://developers.openai.com/api/reference/resources/videos/methods/create)，退役信息独立于16个可配置槽，不能启用或计费；原Sora函数保持410。不得使用历史API文档宣称当前服务可用，详见 [迭代10](ITERATION_10_RENDER_EXPORTS.md)。

00040新增audio.voice_clone/ElevenLabs IVC（基础`/v1`、xi-api-key/raw）、avatar.photo/D-ID Talks（`/talks`、Basic已编码凭据）、avatar.lipsync/Sync（`/v2/generate`、x-api-key/raw）；数字人另填查询基础地址，提交最多30秒。后台音频、克隆声纹与原版本配音、人物输入、计费与验收见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)。匹配数据库/API/production调度须先发布。

## 首次启用

1. 核对并先应用未发布的 00032/00033，再应用 `00034_model_registry.sql`，部署新函数、兼容入口与共享模块。火山清单共 26 个生产入口，不包含 `setup-demo`；官方目标按同一入口/鉴权语义逐项发布，不用火山脚本重放旧库。
2. 在受控终端生成 `openssl rand -hex 32`，将结果配置为 Edge Secret `MODEL_CONFIG_ENCRYPTION_KEY`，备份于凭据管理系统。API Key 使用 AES-GCM 加密；更换主密钥前必须迁移所有历史密文，不能直接覆盖。
3. 用户完成正常 Auth 注册。通过数据库控制台对实际用户授权：

```sql
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
WHERE id = '实际管理员用户UUID';
```

4. 重新登录，进入设置页。服务端通过 Auth `getUser` 验证 `app_metadata.role`，数据库保存函数再次检查 `auth.users.raw_app_meta_data`。`profiles.role` 和用户自行填写的 `user_metadata` 不授予配置权限。
5. 填写完整 HTTPS 调用地址、协议、实际已开通的模型 ID、API Key；视频另填查询基础地址。启用并保存后，工作台显示可用模型。

不在浏览器 `.env`、localStorage 或 MCP 中填写模型密钥。首次配置时前端只需要 BaaS URL 与 anon key。

## 配置范围

| 配置项 | 协议与用途 |
|---|---|
| 主文本 / 备用文本 | OpenAI Chat Completions，文本业务共用主备，首选火山方舟 |
| 知识索引 / 语义查询 | OpenAI Embeddings，2–1536维浮点、独立模型版本、后台任务 |
| 图片与封面 | OpenAI Images，同步 URL 或 base64 图片；Chat Completions 图片 URL，可携带参考图 |
| 语音合成 | OpenAI Audio Speech 或 Step TTS，模型与默认音色可设置 |
| 语音识别 | OpenAI Audio Transcriptions 或 Step ASR SSE，服务端兼容上传文件与原 Step 输入 |
| 网页读取 | Jina Reader，将商品网页转换为文本再交给文本模型 |
| 视频 | ArkSeedance、MiniMax、SeedanceMini、Wan3、HappyHorse、Kling、Seedance 七个现有协议 |
| 即时声纹与克隆配音 | ElevenLabs IVC，同一历史版本与供应商账号；需本人样本授权，requires_verification=true不可配音 |
| 照片口播 / 视频口型 | D-ID Talks / Sync Lipsync，已有口播音频与人物输入，保存原ID查询 |

通用字段还包括显示名称、认证请求头、Bearer/原始密钥格式、超时、只读连接检查地址。视频提交最长 30 秒，其余最长 120 秒。协议特有的素材能力和视频规格由现有适配器校验；新的供应商协议仍需新增适配器，修改 URL 不会自动改变协议。

连接检查使用供应商提供的只读 GET 健康接口或模型列表，验证网络和认证；不发起生成任务，不能证明某个模型或视频账号已开通生成权限。保存前无需进行付费生成。业务使用时供应商可能计费。

## 更新、迁移与旧任务

每次保存产生不可修改的版本，携带当前版本 ID，冲突返回 409。API Key 留空保留原密钥，输入新值则替换；服务端列表仅显示 `has_key`，不回传密文和明文。保存后清除 LLM 缓存。

视频创建事务检查启用状态并绑定 `model_config_version_id`，提交、查询始终读取该版本。禁用配置只阻止新任务；重复 `request_key` 恢复原任务，仍只扣一次。已有配置禁止原地修改或删除，以便旧任务查询与财务核对。

「导入旧服务端配置」仅导入尚未保存且完整有效的历史 Secrets；已有配置不会覆盖，运行时不会自动回退 Secrets。旧异步图片网关与新同步协议不兼容，需人工配置。

迁移前已受理的视频任务没有配置版本，Worker 暂停领取。核对供应商、原账号、模型与查询地址后，运维调用：

```sql
SELECT public.bind_legacy_video_config(
  '实际旧任务UUID', '核对后的配置版本UUID', '原账号与查询接口核对依据，至少10字'
);
```

这个函数仅 service_role 可执行，并记录审计。受理结果未知的任务仍需走原 `reconcile_video_submission`；绑定配置不能证明是否受理。历史未完成封面需单独核对，本轮不自动替换上游。

## 计费与边界

视频沿用 `credit_costs.generate_video`（默认10积分）及预占、结算、逐笔退款。图片/封面默认各10积分；TTS/ASR默认各2；即时克隆/照片口播/口型默认各10。媒体任务每用户共用10个活跃上限，网页提交确认价格，变化409零扣费。提示词辅助暂不收应用积分，旧同步音频入口410。应用积分与实际供应商用量分开记录。

图片供应商协议仍返回同步结果，应用调用已任务化：保存原返回证据、归档失败重试保存、关闭页面后按同一UUID恢复；受理未知不能重新调用。此能力须部署00035、匹配函数和生产调度器。图片尺寸为1024×1024、1024×1536、1536×1024，质量为auto/low/medium/high，需供应商协议支持。参考图仅chat-image支持；OpenAI Images的编辑、扩图及掩码暂未接入。

接口保存与调用检查HTTPS、域名解析及公网地址，拒绝本机、内网、云元数据地址和重定向。域名检查到请求间仍存在DNS重绑定时间窗，生产应配置可信供应商域名或网络出口策略。当前源码提供私有素材与签名访问，最近云端仍为旧部署；启用条件见 [生产链路迭代](ITERATION_06_PRODUCTION_PIPELINE.md)。

验收包括管理员/普通用户、并发保存、V1 任务在 V2/禁用后继续查询、真实生成与失败退款，见 [测试计划](TEST_PLAN.md)。日常预算和客服见 [运营手册](OPERATIONS_GUIDE.md)，主密钥/旧任务恢复见 [运维手册](RUNBOOK.md)。
