# 统一模型接口设置

入口：侧边栏「模型接口设置」→ `/settings/models`。平台管理员可编辑，普通用户仅看到模型名称与启用状态。所有客户端和 MCP 共用服务端配置。

## 首次启用

1. 应用 `00034_model_registry.sql`，部署清单中的新函数和兼容入口。
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
| 图片与封面 | OpenAI Images，同步 URL 或 base64 图片；Chat Completions 图片 URL，可携带参考图 |
| 语音合成 | OpenAI Audio Speech 或 Step TTS，模型与默认音色可设置 |
| 语音识别 | OpenAI Audio Transcriptions 或 Step ASR SSE，服务端兼容上传文件与原 Step 输入 |
| 网页读取 | Jina Reader，将商品网页转换为文本再交给文本模型 |
| 视频 | ArkSeedance、MiniMax、SeedanceMini、Wan3、HappyHorse、Kling、Seedance 七个现有协议 |

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

视频沿用 `credit_costs.generate_video`（默认 10 积分）及预占、结算、逐笔退款。`ai-assistant.generate_cover` 沿用原 Action 计费；工作台 `image-generation` 与 `text-generation`、直接音频暂不收应用积分，分别限流 5/20/10 次每用户每分钟。供应商用量仍由平台账号承担；正式运营需结合成本设置收费口径。

同步图片会下载并保存至 Storage，失败明确报错。页面关闭后图片请求的归档结果可能已保存，但没有视频式持久化任务与自动恢复保证，不能盲目重试付费上游。图片尺寸目前为 1024×1024、1024×1536、1536×1024，质量为 low/medium/high，需供应商协议支持。OpenAI Images 的编辑、扩图及掩码暂未接入。

接口保存与调用检查 HTTPS、域名解析及公网地址，拒绝本机、内网、云元数据地址和重定向。域名检查到请求间仍存在 DNS 重绑定时间窗，生产应配置可信供应商域名或网络出口策略。Storage 目前公开，私有素材和短效授权不在本轮实现范围。
