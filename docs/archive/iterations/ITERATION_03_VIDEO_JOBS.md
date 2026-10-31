# 第三轮：服务端视频任务与失败自动退积分

> 历史记录：本文保存对应迭代/审计时点的事实与建议，旧行号、Mock、密钥来源、收费、部署状态和未完成清单不作为当前操作依据。2026-10-21 最新基线 ce90bfe，环境见 [当前状态](../../CURRENT_STATE.md)，闭环关系见 [追踪矩阵](../../CHANGE_TRACEABILITY.md)，本轮实测见 [验证报告](../reviews/TEST_REPORT_20261021.md)。
> 后续工作区变更另见 [待验收开发](../../PENDING_CHANGES.md)，不能追记为历史迭代已完成。

主工作台已改为持久化服务端队列。服务端创建任务时一次预占积分，成功转存成片后结算，确定失败时按原流水返还。代码已完成本地验证，未部署或调用真实模型。

## 已实现

- `video-jobs` 提供 `create/query/list`。用户身份来自 Auth，客户端不能指定扣费用户、金额、上游任务 ID 或失败状态；查询只返回本人的任务。
- `create_video_job` 在同一事务创建作品档案、任务和扣费流水。默认 10 积分，服务端读取 `credit_costs.generate_video`。重复请求复用同一 UUID 与完整参数，只扣一次；不同参数复用请求 UUID 会拒绝。
- 任务保存模型、归一化参数、上游任务 ID、原扣费 ID、积分金额、执行租约、下次查询时间与处理证据。后台执行器与用户查询共享租约，多实例领取使用 `FOR UPDATE SKIP LOCKED`。
- MiniMax H3、Seedance Mini、Wan3、HappyHorse、Kling，以及旧 Cdance/Seedance 的协议移到服务端。保留原仓库协议；未做真实网关联调，需逐模型验收。不再从浏览器读取视频模型 `VITE_*` 密钥。
- 创建 POST 只发送一次。HTTP 400/401/402/403/404/405/413/415/422/429 为确定拒绝；网络异常、408/409/5xx、成功响应缺少任务 ID 均保留为受理结果未知，不自动重发或退款。
- 查询仅根据上游任务明确 `failed/cancelled/canceled/expired` 判定失败。HTTP 错误、`UNKNOWN`、缺少状态、成功但缺少成片 URL、下载或 Storage 故障都保留任务重试。
- 上游失败或转存成功后先持久化终态证据，再执行原子结算。退款事务暂时失败不会丢失证据，租约恢复后继续结算，无需上游再次返回相同结果。
- 失败状态、作品档案与退款同事务；成功状态与成片档案同事务。重复退款一次生效，已完成任务不可被迟到失败改写，换套餐后的旧周期退款仍按原流水补偿。
- 成片转存至 `materials/generated-videos/{user_id}/{job_id}.mp4` 或 `.webm`，固定路径幂等写入，避免仅保存上游 24 小时签名链接。当前支持 MP4/WebM，大小上限 100MB，转存失败继续查询重试。
- 首页先上传本地参考素材，再创建任务。保存用户独立请求回执，刷新后恢复查询；创建响应丢失时按相同请求 UUID 查询/重试。余额变更和作品变更同步刷新。
- 删除前端旧视频适配器，停用无计费关联的 `seedance`、`kling-video-create/query`、`sora-video-create/query` 代理，返回 410；删除 `ai-assistant` 内已停用的模拟视频及后台轮询实现。
- 关联服务端任务的作品禁止客户端改写状态、视频 URL、原始参数或删除进行中档案；标题、封面仍可编辑。失败重试带原提示词回工作台，由用户重新提交新任务。
- 批量创建和旧五步生成暂不恢复。批量入口在扣费前明确提示未接入执行器，自定义视频模型尚未支持服务端密钥管理，也在扣费前拒绝。

预占通过现有 `credits_used` 与原始 `deduct` 流水实现，`billing_state=reserved` 表示尚待任务结算，并未新增独立冻结账户。成功标记为 `settled`；失败原子冲回额度并标记 `refunded`。

## 部署顺序

1. 数据库备份后，在已有 00028、00029 基线上执行 `00030_server_video_jobs.sql`。迁移新增 `aspect_ratio`，修复原前端使用但历史迁移缺失的字段。
2. 配置服务端模型 Secrets 与 `VIDEO_WORKER_SECRET`（随机独立密钥）。平台提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。所有模型 Base URL 必须是完整 HTTPS 地址，不能使用前端代理相对路径。
3. 部署 `video-jobs`、`video-job-worker`、`ai-assistant` 和五个停用代理及共享模块。`video-jobs` 需要用户 JWT；Worker 在 `config.toml` 关闭平台 JWT 验证，内部只接受专用 `VIDEO_WORKER_SECRET`。
4. **配置并确认后台定时任务可正常触发 Worker，再发布前端。** 单次 Worker 领取一个任务，默认 180 秒租约，不在函数内长时间轮询。没有调度器时仅用户查询能推进任务，关闭页面后不会自动处理。
5. 后台调度部署入口见 [VIDEO_SCHEDULER.md](../../operations/VIDEO_SCHEDULER.md)。推荐常驻服务器运行 Docker 调度器，`scripts/manage_video_scheduler.py start` 先只读预检，再后台启动；`run_video_worker.py --daemon` 支持持续调度，默认每 10 秒一批、最多 4 并发、失败退避与健康检查。无需业务数据库或模型密钥。
6. 平台支持 pg_cron、pg_net、Vault 时，可采用 `supabase/ops/video_worker_schedule.sql`。先在 Vault 创建 `supabase_url` 与 `video_worker_secret`，再安装调度；默认每 10 秒检查，全局最多 4 个未完成请求，只在有到期任务时派发，支持响应摘要、过期回收、重复安装与只读状态 SQL。调度 SQL 不自动随迁移执行；本地已用平台替身验证 SQL 行为，尚未在云端安装这些扩展。
7. 逐模型验收提交、排队、失败退款、成片转存、刷新恢复、关闭页面后后台结算。Storage 使用已有公开 `materials` 桶；未实现私有视频及限时下载授权。

| 模型 | 服务端密钥 | 默认 Base URL |
| --- | --- | --- |
| MiniMax H3 | `OPENAI_NEXT_API_KEY`，兼容 `MINIMAX_API_KEY` | `https://api.openai-next.com` |
| Seedance Mini | `SEEDANCE_MINI_API_KEY`，兼容共用 `TOKENDANCE_API_KEY` | `https://tokendance.space` |
| Wan3 | `WAN3_API_KEY`，兼容共用 `TOKENDANCE_API_KEY` | `https://tokendance.space` |
| HappyHorse | `HAPPYHORSE_API_KEY`，兼容共用 `TOKENDANCE_API_KEY` | `https://tokendance.space` |
| Cdance/Seedance | `CDANCE_API_KEY`，兼容 `VECTRUST_API_KEY` | `https://ai.dxkp.com/v1` |
| Kling | `KLING_API_KEY`，兼容 `INTEGRATIONS_API_KEY` | 保留原 appmiaoda create/query 网关 |

前五类分别支持同前缀的 `*_BASE_URL`。升级后曾通过 `VITE_*` 发布过的视频密钥应在供应商侧轮换，再将新值配置到服务端。其他文本、图片、音频的既有直连与模拟逻辑不属于本轮，仍需后续迁移。

## 异常核对

无上游幂等键且 POST 响应丢失，无法单凭超时证明任务未受理。此时显示“提交结果待核对”，积分保持预占；运维须核对上游账单、任务列表后处理。后台不会盲目退款或重发。

先查看任务：

```sql
SELECT id,user_id,provider,provider_task_id,status,submission_state,billing_state,
       credit_cost,error_message,needs_attention,created_at
FROM public.video_jobs
WHERE charge_id IS NOT NULL
  AND (needs_attention OR (status='processing' AND started_at < now()-interval '24 hours'));
```

通过受控管理连接执行，仅 `service_role`/数据库管理员可用：

```sql
-- 已查到上游任务：绑定任务标识，恢复查询，不再扣费。
SELECT public.reconcile_video_submission(
  '<job UUID>', '<verified provider task ID>', '记录上游账单或工单核对依据（至少10字）');

-- 上游确认从未受理：NULL 表示释放本任务的原扣费，依据写入审计日志。
SELECT public.reconcile_video_submission(
  '<job UUID>', NULL, '记录上游明确未受理的核对依据（至少10字）');
```

已有上游 ID 的任务查询错误采用退避重试；超过 24 小时标记 `needs_attention` 并改为每小时查询，仍不把超时作为失败。没有扣费关联的历史任务不由新 Worker 消费，也不追溯自动退款。

## 本地验证

```sh
python3 tests/test_finance.py
npm run test:video
npm run test:payments
npm run typecheck
npx biome lint
npm run build
```

验证结果：23 个真实数据库用例（其中 11 个为本轮新增）、15 个视频协议/API/执行器用例、原有 10 个支付与 AI 计费用例通过；前端类型检查、Biome、生产构建，以及 7 个新任务/停用代理函数的 Deno 检查通过。

数据库执行真实迁移和资金事务，模拟 Supabase Auth/Storage schema，不连接生产；模型与 API 测试使用受控 fetch/Storage 替身，不产生实际计费。新增视频回归覆盖创建幂等、领取并发、越权、状态转换、原子退款故障回滚、证据恢复、旧周期补偿、未知提交与核对。尚未进行真实模型、Storage SDK、前端浏览器及生产调度集成验收。
