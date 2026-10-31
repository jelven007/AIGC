# 统一模型接口设置

2026-10-31页面职责拆分：`/settings/models`仅管理16项模型API（文本2、向量1、图片1、视频7、音频3、数字人2）。YouTube统计、eBay搜索、授权情报数据商和Jina网页读取4项移至`/settings/integrations`「第三方集成」，TikTok/抖音发布应用也在此配置。普通用户在模型页只读模型启用状态，集成页不展示管理员表单。

此调整沿用20项底层配置及原版本，无需迁移已有数据。设置页对列表、保存、连接检查和历史导入发送`scope=models`或`scope=integrations`；后端限定返回目录与导入范围，跨范围保存/检查返回400。业务端不传scope时仍兼容原完整目录。连接检查只验证只读GET接口，不等于模型已开通生成权限。页面地址及导入范围验证：`pnpm test:models`、`pnpm test:settings-scope-ui`和现有模型/发布应用表单回归。

2026-10-31修复设置页：初次列表为空或加载失败时仍显示模型表单；未读取的服务端状态明确标为“未读取”，不当作已关闭。失败后的“重试加载”保留当前草稿和API Key；成功读到原版本后才能保存，保存失败不清空输入或显示成功。密钥只暂存在当前页面内存，关闭页面后不保留。

本日真实目标复核：`model-settings`返回404 NOT_FOUND，`model_configs`返回404 PGRST205；管理令牌401。页面修复已生效，但原云端尚不能持久保存模型配置。恢复`.env.deploy.local`有效管理令牌后按[官方发布入口](../releases/OFFICIAL_SUPABASE_DEPLOYMENT.md)核对原账、迁移和部署函数；不能用浏览器本地缓存替代服务端配置。本次改动使2026-10-30候选包的源码身份过期，后续部署需重新prepare。

更新：2026-10-27，20槽、00068/probe24/render4/edit2。模型不可变版本、用途绑定keyring、文本尝试/usage与成本核对已本地验证；当前配置/启用以正文和[密钥轮换](../operations/KEY_ROTATION.md)为准，旧计数/探针保留历史。

2026-10-27本地优化：文本主备配置新增可选布尔项`supports_vision`，设置页「支持图像审核」默认关闭。只有已开通视觉理解且经实际样本确认的模型可启用；图片审核先按素材ACL读取最大5MB实物，以data URI提供图像并返回SHA-256。没有视觉模型、读取失败或审核结构/判定冲突时返回待复核。详见[实施记录](../archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)，尚不表示目标环境已发布。

## 历史配置增量

00053 [剪辑音轨与人物分割](../archive/iterations/ITERATION_25_EDIT_ANALYSIS.md)不增加供应商槽：字幕固定创建时audio.asr版本，要求openai-asr/whisper-1/verbose_json；无时间段失败退原积分，未知请求不重发。节拍本地FFT不调用供应商；人物PPHumanSeg在镜像构建时固定摘要/许可证并离线推理，不可通过模型设置替换任意ONNX。probe14/00053/render3/edit1，真实供应商及人物边缘/长素材质量仍待验收。

00049 [翻译与图片选品](../archive/iterations/ITERATION_21_TRANSLATION_NOTIFICATIONS.md)不增加配置槽：翻译固定创建时text.primary版本；勾选主图文字识别须模型支持OpenAI兼容image_url数据URI，真实图片/语言质量另验收，不能仅凭探针判断。eBay图片搜索沿intelligence.ebay应用凭据/Browse官方POST与目标市场，需实际search_by_image权限。执行时私有图读取/魔数/5MB/指纹核对，供应商收到图片字节，不收到Storage签名凭据。probe v10/00049仍待全栈部署。

商品资料提取见 [迭代19](../archive/iterations/ITERATION_19_PRODUCT_MANAGEMENT.md)：使用实际JSON-LD/用户资料读取，不调用语言模型猜测商品，不需要新的模型槽位或积分价格。商品卖点/翻译创作仍使用既有真实文本模型协议；公开页提取不等于已授权所有交易平台原生接口。匹配00046和生产调度probe v8仍待目标部署。

00044 [情报设置](../archive/iterations/ITERATION_15_MARKET_INTELLIGENCE.md)新增intelligence.youtube/ebay/licensed，当前20槽。YouTube固定正式地址及x-goog-api-key raw；eBay固定Browse地址和Basic编码应用凭据，token仅在服务端；licensed需真实授权网关。情报不填模型ID、单次HTTP最多30秒，所有凭据继续服务端加密。以下17/16槽表述是先前迭代记录，当前目录以model-catalog及数据库目录为准。

00043 [知识索引](../archive/iterations/ITERATION_14_KNOWLEDGE_RETRIEVAL.md)新增embedding.primary，当前总计17槽。填完整OpenAI兼容Embeddings地址及已开通模型/Key，必须返回float格式2–1536维非零同维向量；不是Chat接口。启用后用户主动确认积分提交索引/查询，新版本需重建索引；原任务始终读取旧版本，已有检索引用按正文再次核验。数据库目录model_slot_catalog统一白名单，00043/API/Worker须一起部署；旧16槽表述为前轮基线。

00042 [观测及实验](../archive/iterations/ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)不增加模型槽。创意建议沿text.primary，先确认实际积分价，只引用背景和服务端观测，不让模型创造流量概率。广告/交易签名数据源独立登记于AB页，仅管理员，密钥同主加密体系保护但不作为LLM API Key；需实际取得来源授权和采集服务，不能用文本模型替代真实交易。

新增 [素材分析任务](../archive/iterations/ITERATION_12_GROUNDED_ANALYSIS.md)复用text.primary与audio.asr，数量仍16槽；任务固定两个旧配置版本。文本模型需真实支持image_url画面，直播ASR须openai-asr/whisper-1及可靠分段；Step只有正文时不能生成高光时间。不要在未验收时宣称视觉模型或声音权限可用。

官方已记录成功证据00031/三旧函数/缺model_configs，2026-10-22管理401，本轮未复核；以下步骤尚未在目标执行。须重新核对缺失至00068及冻结函数/镜像，见[当前状态](../CURRENT_STATE.md)。

入口：侧边栏「模型接口」→ `/settings/models`；第三方数据服务与发布应用→ `/settings/integrations`。平台管理员可编辑，普通用户仅看到模型名称与启用状态。所有客户端和 MCP 共用服务端配置。

供应商生命周期：Sora按已记录的2026-09-24官方退役处理，退役信息独立于20可配置槽，不启用/计费，原入口410。依据及日期见 [迭代10](../archive/iterations/ITERATION_10_RENDER_EXPORTS.md)与 [官方说明](https://developers.openai.com/api/reference/resources/videos/methods/create)。

00040新增audio.voice_clone/ElevenLabs IVC（基础`/v1`、xi-api-key/raw）、avatar.photo/D-ID Talks（`/talks`、Basic已编码凭据）、avatar.lipsync/Sync（`/v2/generate`、x-api-key/raw）；数字人另填查询基础地址，提交最多30秒。后台音频、克隆声纹与原版本配音、人物输入、计费与验收见 [迭代11](../archive/iterations/ITERATION_11_AUDIO_AVATAR_JOBS.md)。匹配数据库/API/production调度须先发布。

## 首次启用

1. 核对缺失至00068后按序应用；部署manifest的43生产入口及冻结共享模块（不含setup-demo），匹配probe24/render4/edit2及发布摘要。官方按同一入口/鉴权发布，不用火山回执脚本重放旧库。
2. 在受控终端生成 `openssl rand -hex 32`，将结果配置为 Edge Secret `MODEL_CONFIG_ENCRYPTION_KEY`，备份于凭据管理系统。新写入为版本化AES-GCM密文。轮换使用完整`MODEL_CONFIG_KEYRING`保留旧ID/主密钥，先验证全部历史用途，再切换活动ID；步骤见 [密钥轮换](../operations/KEY_ROTATION.md)。
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
| 图片/封面/编辑 | OpenAI Images结果URL/base64；可选同域images/edits与支持的GPT Image模型，JSON images/mask数据URI；Chat参考图保留 |
| 语音合成 | OpenAI Audio Speech 或 Step TTS，模型与默认音色可设置 |
| 语音识别 | OpenAI Audio Transcriptions 或 Step ASR SSE，服务端兼容上传文件与原 Step 输入 |
| 网页读取 | Jina Reader，将商品网页转换为文本再交给文本模型 |
| 视频 | ArkSeedance、MiniMax、SeedanceMini、Wan3、HappyHorse、Kling、Seedance 七个现有协议 |
| 即时声纹与克隆配音 | ElevenLabs IVC，同一历史版本与供应商账号；需本人样本授权，requires_verification=true不可配音 |
| 照片口播 / 视频口型 | D-ID Talks / Sync Lipsync，已有口播音频与人物输入，保存原ID查询 |
| 情报三槽 | YouTube官方公开统计、eBay Browse应用凭据、实际授权数据商；固定来源/市场/口径 |

20槽组成：文本2/视频7/图片1/音频3/数字人2/Reader1/Embedding1/情报3。通用字段有名称/认证头/格式/超时/test地址；视频与异步数字人提交最长30秒，其余受各适配器限制（通用最高120秒）。新供应商须匹配协议，改URL不会自动接入。

`image.primary.settings.edit_endpoint`可选，必须生成地址同域同images路径的edits并使用image-contract支持的GPT Image模型；旧配置可继续生成，不因升级自动获得编辑权限。catalog仅公开version_id与image_capabilities。原图和掩码先私有登记、同标准尺寸非交错8位PNG，每文件12MB，实际解压/透明区校验；编辑提交确认原价/版本，409刷新配置后再确认。

连接检查使用供应商提供的只读 GET 健康接口或模型列表，验证网络和认证；不发起生成任务，不能证明某个模型或视频账号已开通生成权限。保存前无需进行付费生成。业务使用时供应商可能计费。

## 更新、迁移与旧任务

每次保存产生不可修改的版本，携带当前版本 ID，冲突返回 409。API Key 留空保留原密钥，输入新值则替换；服务端列表仅显示 `has_key`，不回传密文和明文。保存后清除 LLM 缓存。

视频创建事务检查启用状态并绑定 `model_config_version_id`，提交、查询始终读取该版本。禁用配置只阻止新任务；重复 `request_key` 恢复原任务，仍只扣一次。已有配置禁止原地修改或删除，以便旧任务查询与财务核对。

「导入旧模型配置」仅导入当前模型范围内尚未保存且完整有效的历史 Secrets；「第三方集成」的「导入旧数据服务配置」只处理数据服务。已有配置不会覆盖，运行时不会自动回退 Secrets。旧异步图片网关与新同步协议不兼容，需人工配置。

迁移前已受理的视频任务没有配置版本，Worker 暂停领取。核对供应商、原账号、模型与查询地址后，运维调用：

```sql
SELECT public.bind_legacy_video_config(
  '实际旧任务UUID', '核对后的配置版本UUID', '原账号与查询接口核对依据，至少10字'
);
```

这个函数仅 service_role 可执行，并记录审计。受理结果未知的任务仍需走原 `reconcile_video_submission`；绑定配置不能证明是否受理。历史未完成封面需单独核对，本轮不自动替换上游。

## 计费与边界

视频沿用 `credit_costs.generate_video`（默认10积分）及预占、结算、逐笔退款。图片/封面默认各10积分；TTS/ASR默认各2；即时克隆/照片口播/口型默认各10。媒体任务每用户共用10个活跃上限，网页提交确认价格，变化409零扣费。提示词辅助暂不收应用积分，旧同步音频入口410。应用积分与实际供应商用量分开记录。

图片供应商返回原结果后checkpoint，归档重试不再次调用或读取源；关页按原UUID恢复，unknown不能重发。标准尺寸1024×1024/1024×1536/1536×1024、质量auto/low/medium/high须实际协议支持。Chat参考与配置GPT Image编辑地址的参考/扩图/矩形重绘已接入00062，不保证掩码保留区逐像素不变；实际权限/商品和文字质量/现金成本待验收。

接口保存与调用检查HTTPS、域名解析及公网地址，拒绝本机、内网、云元数据地址和重定向。域名检查到请求间仍存在DNS重绑定时间窗，生产应配置可信供应商域名或网络出口策略。当前源码提供私有素材与签名访问，最近云端仍为旧部署；启用条件见 [生产链路迭代](../archive/iterations/ITERATION_06_PRODUCTION_PIPELINE.md)。

验收包括管理员/普通用户、并发保存、V1 任务在 V2/禁用后继续查询、真实生成与失败退款，见 [测试计划](../testing/TEST_PLAN.md)。日常预算和客服见 [运营手册](../operations/OPERATIONS_GUIDE.md)，主密钥/旧任务恢复见 [运维手册](../operations/RUNBOOK.md)。
