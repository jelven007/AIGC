# 接口与数据契约

增量00041：[素材分析契约](ITERATION_12_GROUNDED_ANALYSIS.md)。production-jobs新增analysis-price与create kind=analysis（video:create），input的mode/title/source_url/confirmed_credit_cost；查询含mode及源指纹/模型版本/可验证结果。专用Worker领取analysis_prepare并提交prepared，模型阶段权限隔离；旧风格/高光入口410。普通同步AI强制JWT身份及关联工程/商品归属校验。

更新：2026-10-21，源码基线 `ce90bfe`。描述当前代码协议；当前官方云端仅有旧版本三个函数，见 [当前状态](CURRENT_STATE.md)。示例 UUID 为说明用途，接入时生成自己的 UUID。

## 1. 通用约定

业务 Edge API 基地址为 `${SUPABASE_URL}/functions/v1`。浏览器使用 SDK 登录后携带 `Authorization: Bearer <用户JWT>` 与项目公开 apikey；用户型接口拒绝 service_role 冒充用户。管理接口进一步检查 Auth 管理员身份。用户 CRUD 仍经 Supabase Data API，由 GRANT/RLS 限定本人数据。

JSON 请求使用 `Content-Type: application/json`，允许的预检由各函数处理。通常 400 表示参数/配置非法，401 未登录，403 无权限，402 视频积分不足，404 本人任务不存在，409 幂等/配置冲突，429 频控，503 运行错误或结果未确认。各接口具体状态以实现为准，不能把所有非 2xx 当作上游未受理。

访问控制增量 `00037`：四个业务入口支持 `Authorization: Bearer ak_live_...`，按 Action 的 scope 验证；管理端 `api-keys/team-space/material-assets` 仅用户 JWT。完整 Action/权限与 Key 有效期、每分钟限额、团队邀请/共享、删除 outbox 见 [访问控制接口](ITERATION_08_ACCESS_CONTROL.md)。旧 phase3 团队和密钥 Actions 返回410；前端不再直接写相关管理表。网关设置与函数内鉴权须一起发布。

批量增量00038：`batch-video-jobs`支持quote/list/query（video:read）与create/pause/resume/cancel（video:create），JWT/Key共用身份。create传request_key、商品ID、统一规格/独立要求、确认单价和总预算；整批原子预占并复用video_jobs。query/list纯读取，终态与资金汇总子任务；取消仅释放未提交项。完整字段、错误状态和兼容见 [批量接口](ITERATION_09_BATCH_VIDEO.md)。

导出增量00039：production-jobs新增export（render:create）、query-export/exports（jobs:read）。export传request_key、source_project_id、formats[{ratio,height}]；源URL/时长由服务端读取。六画幅含4:5、三短边，最多18组合，全部输出作品/渲染任务同事务；24个未结案渲染共用配额，容量不足429。同键不同参数409，失联503保留原请求；query-export缺本人记录404。返回export包含独立jobs的规格/状态/结果，未返回原始输入或租约。完整兼容见 [多规格导出接口](ITERATION_10_RENDER_EXPORTS.md)。

媒体增量00040：production-jobs create支持tts/asr/voice_clone（audio:create）、avatar/lipsync（avatar:create），list可按kinds筛选；voices与media-prices使用jobs:read。完整输入/返回与原声纹版本绑定见 [媒体任务接口](ITERATION_11_AUDIO_AVATAR_JOBS.md)。确认价格变化409零扣费；未配置424；共享10个活跃媒体任务上限429；503保持原回执。旧同步音频入口410，原客户端已切后台队列。production-worker probe版本2要求00040，不消费任务。

## 2. 视频任务

入口 [video-jobs](../supabase/functions/video-jobs/index.ts)，仅 POST：

```json
{
  "action": "create",
  "request_key": "11111111-1111-4111-8111-111111111111",
  "provider": "ArkSeedance",
  "input": {
    "prompt": "商品置于桌面，缓慢推进镜头展示材质",
    "duration": 5,
    "resolution": "720p",
    "ratio": "9:16"
  }
}
```

`provider` 允许 ArkSeedance、MiniMax、SeedanceMini、Wan3、HappyHorse、Kling、Seedance。规格及首尾帧/参考视频的互斥与支持范围由 [video-providers](../supabase/functions/_shared/video-providers.ts) 校验，不承诺每个模型支持所有参数。

| Action | 参数 | 返回与语义 |
| --- | --- | --- |
| `create` | `request_key` UUID、`provider`、`input` | HTTP 202 `{job}`；数据库创建、预占与版本绑定；不证明已提交供应商 |
| `query` | `job_id` 或 `request_key` UUID | `{job}`；限定本人；可能领取到期任务执行一次，**不是只读健康检查** |
| `list` | 无额外参数 | `{jobs}`；本人有扣费关联的最近 30 条，创建时间倒序；未提供分页游标 |

公开 `job` 字段为 `id/project_id/provider/status/submission_state/billing_state/credit_cost/progress/video_url/error_message/needs_attention/created_at`。不回传上游 ID、密钥、扣费流水 ID、租约或配置密文。

创建 503 或响应丢失：复用相同 UUID 与参数查询/创建找回。相同 UUID 不同参数 409；禁用模型不影响找回已有任务。确定失败后再次生成是新任务。

任务中心 `/task-queue` 使用上述list/query与production-jobs、platform-publish组合读取；不再查询历史job_type/input_data字段或直接删除video_jobs。平台发布按job_id去重，以publish_tasks审核状态为准，待提交取消调用既有platform-publish cancel。错误保留上次记录，未知受理不重发。契约与验证见 [任务中心迭代](ITERATION_07_TASK_CENTER.md)。

## 3. 状态与执行器

三个状态维度分开解释：

| 维度 | 值与含义 |
| --- | --- |
| `status` | 服务端主链路使用 `pending/processing/completed/failed`；00038增加批次内queued子任务的服务端cancelled，不支持取消已受理任务 |
| `submission_state` | `queued` 待领、`submitting` 提交在途、`submitted` 有上游 ID、`unknown` 受理待核对 |
| `billing_state` | `reserved` 已预占、`settled` 成功结算、`refunded` 原流水积分返还 |

```mermaid
stateDiagram-v2
    [*] --> queued: 创建并预占/绑定配置
    queued --> submitting: 租约领取
    submitting --> submitted: 获取上游任务ID
    submitting --> unknown: 超时/无ID/受理不确定
    submitting --> failed: 明确拒绝/返还积分
    submitted --> submitted: 生成中/查询或转存暂时错误
    submitted --> completed: 成片转存/结算
    submitted --> failed: 明确失败/返还积分
    unknown --> submitted: 审计核对后绑定上游ID
    unknown --> failed: 证实未受理/返还积分
```

入口 [video-job-worker](../supabase/functions/video-job-worker/index.ts) 只接受 POST 和 `Bearer VIDEO_WORKER_SECRET`：

- `{"action":"probe"}`：只验证队列所需字段，返回 `{ready:true,version:1}`；不领取、不调用模型，也不保证配置可解密或供应商可用。
- `{"action":"run"}`：最多处理一个任务，返回 `{processed:0|1}`；省略 action 也按 run 处理。

租约默认 180 秒，`FOR UPDATE SKIP LOCKED` 避免并发重复领取。先持久化终态证据再执行状态/退款事务；退款事务失败后可由租约恢复重试。长期查询退避并标记 `needs_attention`，不会仅凭等待时长退款。

## 4. 模型设置

入口 [model-settings](../supabase/functions/model-settings/index.ts)，仅 POST：

| Action | 身份/输入 | 输出 |
| --- | --- | --- |
| `catalog` | 登录用户 | `{configs,admin}`；槽、名称、类别、启用、视频 provider |
| `list` | 管理员 | 设置、`version_id/has_key/updated_at`；无明文/密文 |
| `save` | 管理员；`slot/settings/enabled/version_id/api_key` | `{version_id}`；首次版本传 null，后续传当前 ID；并发冲突 409 |
| `import` | 管理员；历史服务端 Secrets | `{imported,skipped}`；只补尚未保存的有效槽 |
| `test` | 管理员；`slot` | `{ok,status,latency_ms,message}`；保存的只读 GET，10 秒超时 |

`settings` 字段为 `name/protocol/endpoint/query_endpoint/model/auth_header/auth_scheme/timeout_ms/voice/test_endpoint`。完整槽与协议见 [MODEL_SLOTS](../supabase/functions/_shared/model-catalog.ts) 和 [模型指南](MODEL_SETTINGS.md)。Key 留空保留原值；设置里显示的默认模型名称不证明该账号有权限。主密钥 AES-GCM 加解密，配置版本不可 UPDATE/DELETE，版本与槽绑定。

## 5. 同步生成与兼容入口

| 入口 | 核心输入/返回 | 应用计费与边界 |
| --- | --- | --- |
| `text-generation` | `messages`、`stream`、`temperature`、`max_tokens`；真实 SSE/JSON | 暂不扣应用积分，20 次/用户/分钟；最多 30 消息、单消息 16000 字符、输出最多 8192 tokens |
| `image-generation` | request_key、prompt/size/quality/reference_image；202 `{job}` | 进入图片后台计费队列；默认10积分，原结果归档恢复 |
| `siliconflow-audio`、`stepaudio` | 历史同步入口 | 410迁移说明；改用production-jobs后台语音任务 |
| `production-jobs`媒体类型 | tts/asr/voice_clone/avatar/lipsync；202 `{job}` | 真实确认价格、版本与私有输出；默认2/2/10/10/10，详见迭代11 |
| `ai-assistant` | `action` 与业务参数 | 按 `credit_costs` Action 收费；缓存/限流拒绝不扣，失败按原流水补偿；部分 Action 仍有模拟业务逻辑 |
| 旧文本函数 | GLM/DeepSeek/Wenxin/MiniMax 兼容入口 | 复用统一主备配置；名称不代表固定供应商运行 |

图片处理器见 [image-provider](../supabase/functions/_shared/image-provider.ts)，音频协议见 [audio-provider](../supabase/functions/_shared/audio-provider.ts)，任务执行见 [media-jobs](../supabase/functions/_shared/media-jobs.ts)。封面数据库/前端统一 `gen_task_id` 与 `completed`；不生成 CTR 预测值。网页 Reader 配置供商品卖点读取使用，没有独立公开任意抓取服务。

## 6. 数据与事务边界

| 数据 | 责任与关联 |
| --- | --- |
| `profiles/user_plans/plans` | 用户资料、套餐及 `credits_total/credits_used`；注册赠分默认 20 |
| `credit_costs/credit_logs` | Action 成本、扣费与补偿关联；视频默认 10；不存现金兑换承诺 |
| `orders/alipay_notify_events/alipay_refunds` | 订单渠道、金额、权益快照、支付宝通知/遗留退款记录；收款原子发放，现金退款另待验收 |
| `video_jobs/video_projects` | UUID 幂等、输入、原扣费、配置版本、租约、终态证据、作品结果 |
| `model_configs/model_config_versions` | 当前指针与不可变设置/密文版本；仅服务端管理 |
| `production_jobs/voice_clones` | 五类媒体任务的幂等、预占、证据/归档/原流水退款，声纹归属及历史配置；供应商声纹ID为受限列 |
| `audit_logs/rate_limit_windows` | 配置和异常核对证据、频率控制 |
| Storage | `materials/videos/thumbnails`；成片固定 `generated-videos/{user_id}/{job_id}.mp4|webm`，当前公开桶 |

实际字段以 [迁移目录](../supabase/migrations) 为准。数据库关键接口包含 `create_video_job(...,p_config_version)`、`claim_video_job`、`checkpoint_video_job_result`、`record_video_job_event`、`save_model_config`、`bind_legacy_video_config`、`reconcile_video_submission`。普通用户不得直接执行这些状态/配置写入口；权限在 00028–00034 收敛。

`reconcile_video_submission(job_id,task_id,note)` 仅用于 unknown：真实上游 ID 恢复查询，`task_id=NULL` 表示已有**未受理证据**并释放积分。`bind_legacy_video_config(job_id,version,note)` 只证明核对了原配置，不改变未知受理事实；均为受控 service_role 操作并审计。

## 7. 支付与 MCP

支付接口、验签、权益快照与对账见 [支付方案](plan/支付.md)。支付宝查询是 GET `alipay-trade-query?order_no=...`，不能用 POST 或页面跳转直接认定支付成功。

MCP [接入指南](../mcp/mcp.md) 使用同一业务 API，HTTP 每次请求携带用户 JWT 并隔离并发身份；视频显式 UUID，默认 ArkSeedance。没有旁路计费或独立模型 Key。

API/字段变更必须同步调用端、迁移、测试、运维查询与 [追踪矩阵](CHANGE_TRACEABILITY.md)；删改旧签名前先核对未完成任务和当前已部署版本。
