# 模型接口与第三方集成

类型：reference。读者：模型管理员与开发者。责任：开发维护者。核验：2026-11-01。来源：supabase/functions/_shared/model-catalog.ts、model-settings、apps/web/src/pages/settings与services/mcp/tools.json。每次槽、协议、配置或部署变化复核；界面目录或真实服务状态变化未同步即过期。

当前20个服务槽分为16模型接口和4第三方数据集成。`/settings/models`管理模型，`/settings/integrations`管理数据服务及TikTok/抖音发布应用。两页统一标题、一级操作区与内容起点，不添加重复“平台设置”标题。管理员编辑，普通用户只读模型启用状态；集成页不展示管理员表单。

本地及ECS已运行v1.1.0并接受模型/集成加载和刷新，协议为00068/probe24/render4/edit2、MCP59/19。原官方Supabase未随本轮升级；其历史00031/三旧函数、model-settings/model_configs缺失及Management401记录是2026-10-30及更早时点，见[官方发布入口](../releases/OFFICIAL_SUPABASE_DEPLOYMENT.md)。本轮未重新验证该独立目标，不将其旧404写成当前自托管状态。

## 配置目录与协议

| 槽 | 数量与用途 |
| --- | --- |
| 文本 | 2；OpenAI Chat Completions主/备用，多个文本业务共用 |
| 向量 | 1；OpenAI Embeddings，2–1536维非零同维float向量 |
| 图片 | 1；OpenAI Images或已支持Chat参考；可选匹配协议的同域images/edits |
| 视频 | 7；ArkSeedance、MiniMax、SeedanceMini、Wan3、HappyHorse、Kling、Seedance |
| 音频 | 3；OpenAI/Step TTS、OpenAI/Step ASR、ElevenLabs即时声纹 |
| 数字人 | 2；D-ID照片口播、Sync视频口型，保存原上游ID查询 |
| 第三方数据 | 4；Jina Reader、YouTube公开统计、eBay Browse、真实授权数据商 |

新供应商须匹配实际适配器协议，修改URL不会自动接入。异步视频/数字人提交最长30秒，通用配置最高120秒，实际适配器可更短；超时未知必须查询原请求。Sora退役入口返回410，不能启用/计费；该历史入口不计入7个视频槽。

文本`supports_vision`只在供应商已开通并经样本确认时启用；未配置或审核结构冲突返回待复核。模型目录可见、GET连接检查成功或页面启用不证明生成权限、质量、价格或商业授权已接受。

## 列表、保存与密钥

列表、保存、连接检查和导入携带`scope=models`或`scope=integrations`；后端限定返回/导入范围，跨范围保存或检查返回400。不传scope的业务客户端兼容原完整目录。初次为空或读取失败仍显示表单和“未读取”；成功读取服务端原版本前不能保存。重试/保存失败保留草稿与页面内密钥，不显示成功。

每次保存创建不可修改的配置版本，携带当前版本ID，冲突409。API Key留空保留原密钥，填写新值替换；列表只返回has_key，不返回明文或密文。密钥只在当前页面内存暂存，不写浏览器环境、localStorage或MCP配置。保存后清除LLM缓存。

首次部署按初始化与[升级恢复](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)核对真实管理员权限、43入口和66迁移。权限以服务端Auth的app_metadata及数据库校验为准，profiles.role或用户自行填写的user_metadata不授予配置权。已有环境保持原密钥和完整历史keyring；只有全新无历史环境才按受控初始化生成主密钥。密钥轮换、用途绑定与旧任务解密见[轮换手册](../operations/KEY_ROTATION.md)。

连接检查使用供应商提供的只读HTTPS GET健康或模型列表，不发起付费生成。接口拒绝本机/内网/元数据地址、错误域名和重定向；实际生产出口按可信供应商白名单配置。保存完整地址、认证头/格式、实际模型ID，异步业务另填查询地址；未接入服务不自动回退浏览器缓存。

## 旧配置与旧任务

导入只处理当前scope内尚未保存且完整有效的历史Secrets；既有配置不覆盖，运行时不会自动回退Secrets。旧异步图片网关与新同步协议不兼容，需要人工配置。旧视频绑定历史配置版本后提交和查询都读取原版本；禁用只阻止新任务，重复request_key恢复原任务且只扣一次。

第三方视频网关与旧GLM配置不再内置演示Base URL。导入前显式提供该账号真实的 `*_BASE_URL`，Kling提供创建/查询地址；只有Key而无地址的配置跳过。原不可变版本不被改写，已受理任务继续使用原版本。

迁移前无配置版本的任务暂停领取。核对实际供应商账号、模型、查询地址和原请求记录后，使用受限运维RPC bind_legacy_video_config绑定真实版本并记录审计；UNKNOWN仍查询原受理结果。绑定版本不证明上游已经受理，不自动重发或替换旧成片。

## 图片、计费与接受

image.primary.settings.edit_endpoint必须与生成地址同域、同images路径并匹配image-contract支持的GPT Image模型；旧配置继续生成，不因升级获得编辑权限。原图/掩码先私有登记，使用受支持尺寸的非交错8位PNG，每文件12MB，实际校验解压/透明区；价格或版本变化409零扣费。局部重绘不保证保留区逐像素不变。

默认应用积分：视频/图片/封面各10，TTS/ASR各2，即时声纹/照片口播/口型各10；真实提交以服务端当前价格和确认结果为准，应用积分与供应商现金用量分别核对。媒体每用户共用10个活跃上限。checkpoint后的归档重试不重复调用上游；未知请求不因关页重发。

源码与浏览器范围包括scope、管理员/普通用户、并发409、V1任务在V2/禁用后查询、失败草稿、统一页头和刷新，见[测试计划](../testing/TEST_PLAN.md)。真实经营模型/价格/质量与成功生成、失败退款仍须在实际授权供应商范围独立接受。日常预算/客服见[运营手册](../operations/OPERATIONS_GUIDE.md)，旧增量保留在[归档](../archive/before-v1.1.0/docs/development/MODEL_SETTINGS.md)。
