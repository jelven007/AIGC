# 后台语音、声纹克隆与数字人任务

日期：2026-10-21。增量迁移 `00040_audio_avatar_jobs.sql`。本地源码及验证已交付，真实供应商账号、云端部署和质量验收尚未执行。

## 产品与协议范围

`/avatars` 新增语音与数字人工作台，支持五种任务，列表与 `/task-queue` 共用生产队列。首页数字人入口转到此工作台，移除预设形象映射固定视频和“形象/发音人已同步”的虚假成功提示。形象库的“使用”选择照片后创建真正的口播请求。

| 类型 | 配置槽 / 协议 | 输入与结果 | 默认积分 |
| --- | --- | --- | --- |
| tts | audio.tts / openai-tts、step-tts | 1–8000字、真实音色ID；私有MP3/WAV/Opus归档与素材记录 | 2 |
| asr | audio.asr / openai-asr、step-asr | 音频最多20MB；真实正文，whisper-1可返回有效时间分段 | 2 |
| voice_clone | audio.voice_clone / elevenlabs-ivc | 授权样本、名称；私有声纹记录与供应商验证状态 | 10 |
| avatar | avatar.photo / did-talks | 人物照片与已有口播音频；异步查询照片动画口播MP4并归档作品 | 10 |
| lipsync | avatar.lipsync / sync-lipsync | 人物视频与已有口播音频；异步查询口型同步MP4并归档作品 | 10 |

这是照片口播、即时声纹克隆和视频口型同步的协议实现，不包含专业声纹训练、全身数字人训练或表情/手势参数控制。旧情绪时间轴标为关键词估计，不能冒称供应商已执行。ASR没有可靠时间分段时只返回正文，不编造时间戳。

供应商协议于2026-10-21核对：

- [D-ID Talks](https://docs.d-id.com/reference/createtalk)：POST `/talks`，`script.type=audio/audio_url`，Basic认证；GET原ID，`done/result_url`。
- [Sync 创建](https://sync.so/docs/api-reference/api/generate-api/create)、[查询](https://sync.so/docs/api-reference/api/generate-api/get)、[幂等说明](https://sync.so/docs/api-reference/guides/idempotency)：POST `/v2/generate`，video/audio输入，`x-api-key`与固定`Idempotency-Key`；GET原ID，`COMPLETED/outputUrl`。
- [ElevenLabs IVC](https://elevenlabs.io/docs/api-reference/voices/ivc/create)、[配音](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)：`xi-api-key`，Multipart `name/files`，保留`requires_verification`；配音使用原声纹账号的`/text-to-speech/{voice_id}`。

模型设置从13个扩到16个可配置槽；Sora仍在独立退役目录。D-ID需要Basic已编码凭据；Sync使用x-api-key/raw；ElevenLabs使用xi-api-key/raw，调用基础地址为`https://api.elevenlabs.io/v1`，服务端追加具体路径。端点、账号权限和真实Model ID由管理员确认，默认地址不证明账号已开通。

## 任务、配置与资金一致性

1. 浏览器上传到本人私有路径，提交前保存UUID、完整输入与确认价格。创建失败或失联保留原回执，可刷新后恢复，禁止改键重发不确定请求。
2. 事务以账户锁检查幂等、配置版本、本人声纹/验证状态、每人共用10个未结案媒体任务上限、价格与余额，创建任务和原扣费流水；照片口播/口型工程也在同一事务创建。价格变化409且零扣费，队列不足429，未配置424。
3. Worker轮转领取视频、图片、发布及五种媒体任务；180秒租约、30秒心跳。同步TTS/ASR/克隆返回后保存证据，异步数字人保存上游ID；存储/结案失败恢复原结果，不重复供应商POST。
4. 上游明确拒绝或原ID查询确认失败，原子返还原扣费。POST超时、5xx、无有效结果或执行阶段中断进入unknown，保留预占；等待不是失败。数字人原ID超过48小时仍无终态进入核对。
5. 所有任务使用不可变配置。声纹配音绑定克隆时的版本和账号，不能把浏览器传来的供应商voice_id用于其他用户；配置停用阻止新请求，已存在任务仍可恢复。

TTS证据最多5MB原始音频，编码后存入受限任务列，以便归档故障恢复；ASR正文最多100000字，克隆只存供应商ID和验证标志。数字人成片下载最多80MB，校验MP4文件头后保存固定私有路径。证据、租约、原始供应商声纹ID均不返回普通任务查询；普通用户只能读取本人的声纹公开字段。

旧`siliconflow-audio/stepaudio`入口通过共享处理器返回410及迁移说明，不能成为不计费旁路。`src/services/audio`和`src/lib/sse`已切换到创建/查询任务，保留原调用入口；最多等待120秒，退出等待不取消后台任务。声音失败不再用浏览器朗读显示已合成成功。

## 接口

`production-jobs`仅POST，函数内JWT/API Key鉴权：

| Action | scope | 契约 |
| --- | --- | --- |
| create kind=tts/asr/voice_clone | audio:create | request_key、input；202 `{job}` |
| create kind=avatar/lipsync | avatar:create | request_key、input；202 `{job}` |
| list | jobs:read | 可选kinds筛选，最近30条 |
| query | jobs:read | job_id或request_key；本人任务结果 |
| voices | jobs:read | 本人最近100个声纹的id/name/requires_verification/created_at |
| media-prices | jobs:read | `{costs:{tts,asr,voice_clone,avatar,lipsync}}` |

输入`confirmed_credit_cost`可固定用户确认价格，网页与原音频客户端均提交；API未提供时使用创建时真实配置价格。TTS普通音色留空使用管理员默认，克隆配音传本站`voice_clone_id`，只支持MP3和0.7–1.2语速。OpenAI普通配音0.5–2；Step数值语速固定1，表现指令单独填写。Step ASR只接受WAV/MP3。克隆和人物任务需`consent=true`；人物照片/视频与音频需授权。

失败响应分类不能表示供应商一定未受理：只有创建前校验/事务明确拒绝才能丢弃回执，503保留。成功创建202表示排队，未表示供应商已完成。成片无可靠供应商时长时保留缺失，需要后续实际媒体探测，不能用估计时长伪造。

## 运维与启用

- 当前官方云端最近仍到00031、3个旧函数；本次没有刷新或发布云端。应用缺失00032–00040，部署匹配production-jobs/production-worker/model-settings、共享模块和兼容音频入口，前端最后发布。
- `production-worker.probe`版本2验证voice_clones与五类计费项，返回required_migration=00040；这是结构检查，不能代替真实供应商权限与生成验收。使用既有production调度，不只更新旧视频Cron。
- 监控五类任务状态/年龄/租约/退款证据、TTS证据体积、Storage用量和供应商成本。默认积分是应用价格，不等于现金或供应商报价。
- 受理未知仅由service_role调用`reconcile_production_job(job,evidence,note)`，需至少10字核对依据：TTS原音频/类型、ASR原正文、克隆原voice_id/验证状态、数字人原provider_task_id；确认未受理传NULL，进入原失败退款事务。核对记录写audit_logs，不能重发或直接改余额。
- `requires_verification=true`的声纹保持不可配音；在供应商控制台完成其验证后由受控管理员确认，当前没有自动验证回调。未使用上传、声纹撤销/供应商删除、成片时长探测与全部质量控制仍需后续治理。
- 正式验收：双用户访问、真实声音/口型/清晰度、供应商读取私有签名、同键账单、关页完成、配置更新与故障退款。真实账号权限、质量、长期容量和云端SLA不从夹具外推。

## 本地验证

7项PG16真实迁移/事务测试通过，覆盖并发一次扣费、配置停用恢复、共用容量、价格变化零扣费、执行中断/审计退款、归档恢复一次、声纹归属与原版本、工程状态保护。8组API/协议夹具通过，覆盖OpenAI/Step/ElevenLabs/D-ID/Sync协议、私有输入、归档故障、未知与确定失败。390px真实页面的两组流程通过，覆盖失联刷新同请求恢复、上传、授权必选、识别正文、未知保留和布局；截图本地检查无横向溢出。

既有33项PG资金/任务、6组生产协议、9组配置与1组旧音频退役、8项任务中心回归通过。TypeScript/Biome/实际ast-grep/Tailwind/检查构建通过，生产构建6.07秒；Deno关键入口检查通过。主分包仍约632kB，未测公网性能。入口`npm run test:media`、`tests/browser_media_jobs.mjs`，日志与截图在被忽略的`.volcengine-build/`。

剩余自动编排、特殊渲染效果、真实媒体分析/竞品选品/RAG、广告归因/实验、多账号、现金退款和运营后台继续推进；本轮不能代表全部原版功能或全栈生产验收完成。
