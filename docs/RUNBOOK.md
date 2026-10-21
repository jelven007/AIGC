# 运维运行手册

更新：2026-10-21，源码基线 `ce90bfe`。当前实际为官方 Supabase，迁移到 00031、三个旧函数、10 秒 Cron；新版 00032–00034 尚未发布。火山 BaaS/Pages/ECS 是独立待验收方案。[当前状态](CURRENT_STATE.md) 是环境判断入口。

源码增量已到00037，实际云端记录未刷新。除 [生产链路](ITERATION_06_PRODUCTION_PIPELINE.md) 外，本次发布须包含 [访问控制](ITERATION_08_ACCESS_CONTROL.md)：旧Key迁移停用，四业务入口函数内验证JWT/Key；团队只从事务API写入；素材删除清理由production调度执行。查看未清理对象只查询 `media_deletions` 的 id/bucket/path/attempts/next_run_at/last_error，不输出认证请求；持续失败应修复Storage并重试原清理项。

## 1. 环境与访问责任

生产记录至少包含平台、项目/workspace/branch、URL、前端构建 Git/校验值、迁移回执、函数版本与对应源码、调度方式、配置版本、负责人和验收链接。URL 是公开信息，密钥不写运行记录。

管理凭据用受控凭据系统；本地部署材料存 `.env.deploy.local`，权限 600、Git 忽略。前端仅 URL/anon key；调度器仅后端 URL/Worker 专用密钥；MCP 仅公开连接参数及请求用户 JWT。service_role 仅管理环境使用。

| 项目 | 当前/建议 |
| --- | --- |
| 官方后端 | `https://bbqqhkukgbgpebqpesub.supabase.co`；控制台域名 supabase.com |
| 官方调度 | `shopro-video-workers`，每 10 秒；独立 Docker 未同时运行 |
| 火山调度方案 | 常驻 ECS Docker，默认 10 秒/4 并发；扩展 Cron 可选 |
| 健康 | Worker probe、派发 HTTP、任务年龄、真实成片与账单分别检查 |
| Storage | 公开桶；访问权限/私有签名播放尚未实现 |

## 2. 监控与建议告警

以下是初始人工值班阈值，尚未实现自动告警或验收 SLA；部署时按真实基线调整并接入监控。

| 信号 | 初始处置阈值 | 行动 |
| --- | --- | --- |
| 活跃任务但无成功派发 | 连续 3 个调度周期 | 查 Cron/容器、密钥、HTTP 与函数部署 |
| unknown/新 needs_attention | 出现即建立核对记录 | 核对原供应商；保留积分，不自动重提 |
| 最老到期任务不推进 | 连续 5 分钟无状态进展 | 查租约/next_poll_at/配置版本/函数限制 |
| 退款证据尚未结算 | 超 2 个租约周期 | 查 RPC 故障、权限与事务；恢复执行器重试 |
| 支付成功权益未到账 | 发现一笔差异 | 对交易、事件与快照；修复后原子重试 |
| 频控/供应商 429/余额不足 | 持续 5 分钟或配额耗尽 | 查用量预算，必要时禁用新任务 |
| 转存持续失败/超 100MB | 单任务反复出现 | 查格式、下载、Storage 与容量；人工转存需证据 |
| 身份/资金异常 | 任意证实事件 | 暂停受影响入口，保护证据，优先恢复一致性 |

Cron 派发摘要只保留 7 天；需要长期追踪时在过期前导出脱敏摘要。pg_net 自身请求队列可能暂存 Authorization，维持平台管理权限，不开放查询给业务用户。

## 3. 只读检查

先用目标控制台执行 [video_worker_status.sql](../supabase/ops/video_worker_status.sql)。新版字段存在后可用受控 SQL：

```sql
SELECT id, provider, status, submission_state, billing_state,
       needs_attention, created_at, updated_at, next_poll_at,
       model_config_version_id
FROM public.video_jobs
WHERE charge_id IS NOT NULL
  AND (status IN ('pending','processing') OR needs_attention)
ORDER BY created_at
LIMIT 100;
```

当前旧云端未具备 `model_config_version_id`，检查旧环境时去掉该列；列不存在首先判断版本差距，不直接修改表凑字段。不要 SELECT 配置密文、Vault 全量值或 pg_net 请求正文。

Worker `probe` 用专用密钥调用；新版 probe 只验证结构，不检查供应商权限、所有配置解密或当前任务成功率。`video-jobs.query` 会尝试执行一次，不能作为不消费任务的探针。

Docker 方案：

```sh
python3 scripts/manage_video_scheduler.py status
python3 scripts/manage_video_scheduler.py logs
```

## 4. 故障处置

### 4.1 调度或 Worker 不可用

检查平台与 URL、调度活跃/容器健康、Worker HTTP 401/503、Secrets 对齐、数据库字段与函数签名。401 先核对专用密钥，不改成用户 JWT；503 先查是否部署了新版 Worker 却缺 00034。

恢复依赖后先 probe，再启动一种调度器。租约默认 180 秒，等待现有租约恢复；不通过清空 `lease_token`、删除任务或增加 `attempts` 强行重提。Docker 的重启策略不能解决宿主停机/休眠。

### 4.2 受理未知

以任务 ID/request_key、创建时间、原配置版本、原供应商账号、模型与请求日志核对是否受理。网络超时、5xx、无 ID 都不证明未受理。若已受理，取得真实 ID；若供应商证实未受理，保存证据。无法证明时保留 unknown。

仅受控 service_role 调用：

```sql
SELECT public.reconcile_video_submission(
  '实际任务UUID', '真实上游任务ID', '原账号核对依据，至少十字'
);
```

第二参数 **NULL 仅用于已证实未受理**，会走原扣费释放流程；不能用作超时退款快捷入口。记录工单、供应商证据、操作者和审计结果。不要用新账号搜索旧任务后判定“不存在”。

### 4.3 配置迁移或改 Key 后旧任务停留

核对 `model_config_version_id`、历史密文能否解密、供应商 Key 是否仍有查询权限。新版 Worker 不领取未绑定配置版本的旧任务；按 [模型迁移](MODEL_SETTINGS.md) 核对原账号后执行 `bind_legacy_video_config`，不能把新 Key/新模型直接绑定所有旧任务。

禁用配置只停止新创建，旧任务应继续读原版本；供应商撤销旧 Key 前完成旧任务/查询/核对。若主密钥被直接覆盖，恢复原主密钥与密文备份，制定迁移后再轮换；不得删除历史版本掩盖问题。

### 4.4 退款、转存与支付差异

视频已持久化 `resolution_event` 但终态事务失败：修复数据库/RPC 后由 Worker 恢复，按原 charge_id 补偿一次。查询/转存失败仍保留任务与预占；修复 Storage/下载问题再查询，不将失败次数当退款证据。

支付按本地订单、渠道交易、事件、权益快照和积分流水对账。事件已记录不代表权益发放成功；重复通知应重试原子入账。客户端跳转、截图或金额输入不作到账依据。详见 [支付方案](plan/支付.md)。

## 5. 发布与停止派发

1. 确认平台/项目、Git/迁移差距和目标能力，备份并建立发布记录。
2. 暂停新计费生成；停止后续调度并等待在途请求结束。仅停调度不能阻止浏览器 query 执行任务，需同时限制相关用户入口/访问。
3. 核对应用未发布迁移，部署配套函数与共享模块、Secrets；当前官方不要用火山 SHA-256 脚本重放。
4. 配置管理员/供应商并绑定核对过的旧任务。运行 probe、双用户权限和真实模型小样本。
5. 恢复一种调度器，完成关页/退款/配置切换验收，发布匹配前端；记录实际版本和脱敏证据。

官方停止后续 Cron 派发执行 [video_worker_unschedule.sql](../supabase/ops/video_worker_unschedule.sql)，恢复用 [调度指南](VIDEO_SCHEDULER.md)。Docker 用 `manage_video_scheduler.py stop/start`；stop 给在途请求 160 秒宽限。停用不删除任务或退款。

回滚先检查前端/函数/RPC 兼容性。新版配置版任务不能直接交给旧 Worker；优先向前修复或暂停。数据库/模型版本/资金流水不做破坏性回退，已受理任务不重提。

## 6. 备份、密钥与恢复

备份包括数据库（业务/权限/任务/流水/配置版本）、Auth 用户迁移材料、Storage 实物与映射、主密钥/Worker/商户凭据的独立安全备份、迁移回执和前端/函数产物。数据库备份不含 Storage 文件；官方免费项目的实际备份/PITR 能力需按项目确认，不承诺已具备。

建议初期每日业务备份、发布前备份、每月隔离恢复演练；这是运维要求，自动流程尚未建立。RPO/RTO 由负责人按业务目标确定并在演练实测后发布，当前没有实测数值。

恢复时先关闭新生成和调度，恢复 DB、旧密文与匹配主密钥、Auth/Storage，再核对恢复点之后的供应商受理/支付交易。陈旧 `submitting` 可能已受理，不能恢复 queued 后重提；用审计核对消除差异，再启用 Worker。

凭据轮换：Worker Secret 同步 Edge 与唯一调度器/Vault；支付证书核对有效期/序列号；模型 Key 通过设置页生成新版本并保留旧任务可查询凭据；AES-GCM 主密钥先完成所有历史密文重加密设计和恢复验证。本轮未实现自动主密钥轮换工具。

## 7. 值班与交接

故障记录统一包含环境、时间、范围、任务/订单/配置版本、已知资金影响、处置命令、证据与恢复验收。客服说明见 [运营手册](OPERATIONS_GUIDE.md)。交接不发送明文 Key，记录凭据位置、权限负责人、有效期和恢复责任。

涉及配置/计费/状态的运行变更要更新 [追踪矩阵](CHANGE_TRACEABILITY.md) 与部署记录；健康恢复后仍核对真实任务和资金一致性。
