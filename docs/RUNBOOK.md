# 运维运行手册

更新：2026-10-27。当前完整发布要求00068/probe24/render4/edit2、66生产迁移、43生产入口、MCP59/19及匹配共享模块/镜像/前端身份。官方已记录成功证据00031/三旧函数，2026-10-22管理401，本轮未复核；实际状态见[当前状态](CURRENT_STATE.md)和[发布接受](RELEASE_ACCEPTANCE.md)。

本轮操作入口：[生产与独立维护](WORKER_SCHEDULING.md)、[媒体/MCP资源](MEDIA_WORKER_RESOURCES.md)、[密钥轮换](KEY_ROTATION.md)、[外部告警投递](ALERT_DELIVERY.md)、[异地归档恢复](BACKUP_RECOVERY.md)。以下历史增量中的旧探针不用于当前发布。

## 历史运行条件

下列增量记录保留各轮时点；当前处置依后文及综合基线，旧probe/迁移范围不可用于新发布。

最新 [迭代33](ITERATION_33_CREDITS_SMS.md)要求00032–00061/probe21/匹配全栈。缺get_my_credits或权限口径未就绪返回503；调度拒绝probe20/00060。余额/权益读失败重试，不重置账；配置正式协议链接和Auth的SMS服务/6位验证码/服务端限流、邮件回跳。官方管理401未发布，镜像预检不代替真实送达与容量验收；下文按历史时点阅读。

当前 [迭代31](ITERATION_31_ACCOUNT_STORYBOARD.md)需同步00059/production-worker/probe19调度/前端及全部匹配业务函数。概览失败显示未知/上次读取；资料失败不自动补建注册，头像/脚本未知结果按原上传或保存记录恢复。官方管理访问最近401；恢复有效管理访问后按00032–00059匹配全栈发布步骤验收，本地构建和隔离夹具不作为目标上线证据。

当前 [迭代29](ITERATION_29_ALERTS_RECOVERY.md)：00057统一扣费套餐→团队/风险锁，00058/probe18/匹配operations与production-worker、常驻调度/前端同窗。运行告警保存原对象/版本/范围/接手/恢复，后台monitor每分钟扫描；采集过三分钟显示失效，容器持久卷记录Edge/DB不可达事件，内部告警未配置外部值班通知。加密备份与双PG16/HTTP实物恢复见 [执行指南](BACKUP_RECOVERY.md)，目标实际调度、官方平台迁移、异地保管与RPO/RTO仍待验收。以下迭代为历史运行条件。

最新 [迭代26](ITERATION_26_EDITOR_ASSETS.md)：必须匹配00054/material-assets/production API、probe15/render4/edit1、常驻调度、前端/MCP58与FFmpeg镜像。上传失联恢复本人原UUID，404重新选择原文件，不覆盖原对象；正式素材受引用保护，删除墓碑与回执必须进入备份。检查Storage大小/MIME元数据、录音失败与有界缓存；render3旧镜像领取前426。自动编排、正式告警/备份恢复与真实目标验收继续执行。

最新 [迭代25](ITERATION_25_EDIT_ANALYSIS.md)：probe14/00053/render3/edit1与production-jobs/production-worker、常驻调度/前端及重建FFmpeg镜像同窗。检查/opt/shopro-models固定摘要/许可证、edit_prepare与字幕模型阶段积压、unknown用量和临时空间；单蒙版512MB/工程768MB/成片1GB，空间少于128MB或时长不符停止，不接受截断成片。原字幕请求待核对时禁止重新提交；真实Whisper、长素材CPU/质量及备份恢复仍待目标验收。

最新 [迭代24](ITERATION_24_WECHAT_TRANSACTIONS.md)：probe13/00052/render2与微信创建/支付通知/新增交易和退款通知、支付宝交易/operations/production-worker/调度及前端同窗。监控微信订单/退款needs_attention、next_query_at、原商户失配、ABNORMAL及长期pending；后台只查询原退款，禁止删回执或盲目重发。恢复保留原商户/期限/关闭记录、请求/供应商退款ID及现金/权益台账，先停资金受理核对渠道；真实账单、告警与备份恢复仍待交付验收。

最新 [迭代23](ITERATION_23_DATA_LIFECYCLE.md)：00051与production/knowledge API、Worker/调度/MCP56/前端同窗，probe12/00051/render2。监控媒体/声纹outbox积压、租约/退避、unknown引用及旧声纹凭据；只清理超过24小时无引用对象和七天终态证据，未知任务不丢证据或盲退。恢复需保留引用/删除墓碑/撤销时间和原配置版本，不能通过删回执重新启用对象或声纹；真实删除、容量与备份恢复仍待目标验收。

最新 [迭代22](ITERATION_22_CHECKOUT_LOADING.md)：两支付创建/checkout/00050与前端同窗，调度probe11/00050/render2；前端POST缺原UUID/确认金额会拒绝。unknown先核对原订单，不删除本地原请求新建收款；监控十待支付配额与签名入账失败，备份checkout_request_key/原快照。微信官方查单/过期/关闭与原路退款仍待接入。多本地Vite服务缓存隔离；空白页先核对脚本HTTP/MIME与目标缓存，不更换用户会话绕过。

最新 [迭代21运行条件](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)：00032–00049、匹配商品/情报/production API与Worker、调度/MCP54/前端同窗口，probe v10/00049/render2。翻译unknown按原结果/原版本service-only核对，不重新调用模型；确认拒绝才沿原流水退款。监控共享4槽、私有原图失效/指纹不符、30天译文/竞品副本与180天通知清理；通知缺失先核对真实状态/偏好，通用publish completed不等于公开发布。备份新增通知/偏好/引用和任务原请求；目标云端尚未发布。

新增 [现金/运营运维](ITERATION_20_CASH_OPERATIONS.md)：00047/00048与资金函数、operations/production-worker/常驻调度/前端同窗口，probe v9/00048/render2。监控unknown/租约超时/入账失败/待核对及100次自动查询上限；调度只查询原编号，不能删预占或新建编号绕过未知退款。核对历史累计/周期、原签名证据/账单、负余额欠额与授权撤销/UTC预算；证据白名单无原响应。真实支付宝与完整账套/备份仍待目标验收。

新增 [商品导入运维](ITERATION_19_PRODUCT_MANAGEMENT.md)：00046与product-management/production-worker/常驻调度/MCP52一起发布，probe v8要求00046/render2，旧版探针不可通过。监控商品提取三次失败/共享4队列/503回执与签名上传、版本409和30天清理；原UUID回执保留，不能靠删客户端恢复记录替代核对。源图片私有归档后的孤立对象TTL/备份仍需后续目标验收。

发布组运行见 [迭代18](ITERATION_18_PUBLISH_GROUPS.md)：先00032–00045与匹配platform-publish/production-worker，probe v7，再47工具MCP与前端。关注每用户24未结案/unknown容量、每账号状态和原平台ID；503查询原组，409冲突保留参数，确定拒绝才改内容。账号撤销不删除已提交证据，取消仅未提交项，不能通过回滚页面重发成功项。备份新增publish_groups及关联任务/审计。

MCP发布与故障见 [迭代17](ITERATION_17_MCP_PRODUCTION.md)：先部署匹配API/00032–00044后部署45工具镜像，platform-accounts网关JWT关闭但函数内验证Key安全读取/JWT管理。旧客户端配音须升级UUID/确认价格；HTTP部署TLS/真实Host规则。401/403核对用户/范围/撤销，409核对原参数/价格，503查询原UUID，unknown核对供应商；不记录Authorization/密钥/原始正文，不更换UUID重提。

渲染增量发布见 [迭代16](ITERATION_16_RENDER_EFFECTS.md)：重建镜像包含render_effects.py，部署匹配production-jobs后再发布前端；迁移仍00032–00044。新增HSL/蒙版/转场逐像素效果关注CPU、内存、临时盘、排队/取消及超时，执行真实长工程/4K容量验收。旧Worker可能拒绝或忽略新参数，切换须统一版本，保存任务/镜像与错误证据后回滚匹配服务。

情报运行见 [迭代15](ITERATION_15_MARKET_INTELLIGENCE.md)：00032–00044、market-intelligence与匹配Worker，probe v6。常驻run包含每日计划入队、轮转采集及30天快照/终态来源副本清理；监控任务积压、原流水退款、停止计划的last_error、供应商配额与清理结果。配置改变暂停旧计划，新授权须用户重新确认。云端未升级前不得发布新版前端或宣称24小时监控已启用。

知识运行新增见 [迭代14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)：00043、knowledge-base、匹配production/text/AI函数、probe v5和常驻production调度一起发布。监控knowledge_index/search的ready/accepted/unknown与4任务配额，checkpoint后可恢复数据库结案；executing超时禁止重发。确认未受理后沿reconcile_production_job空证据释放，向量人工导入未支持。备份knowledge_entries/chunks、任务和全部历史加密版本/主密钥，恢复后校验摘要与版本；新Embedding版本需重新建索引。200条/24块精确扫描扩大前先压测。

最新发布范围00032–00042与 [观测实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)，新增measurements/measurement-ingest，匹配AI与production-worker probe v4。监控签名401/体积413/限流429/依赖503、来源最后接收时间、版本冲突、回执增长、实验分组/曝光缺失及样本比例；停用来源后拒绝新写但保留历史。HMAC需要采集端与服务器时钟一致，不记录密钥/原始身份；每分钟来源500、报告90，失败不可用随机数据填充。真实采集分流、留存压测、告警与备份仍需目标验收。

当前新增源码需部署到00041，见 [素材分析运行契约](ITERATION_12_GROUNDED_ANALYSIS.md)。重建FFmpeg Worker以支持analysis_prepare，匹配production-worker两段处理和probe v3；关注准备阶段队列年龄、8帧/WAV私有对象、unknown、旧版本和退款。数据库最近真实回执仍00031；不得用探针或本地测试充当发布回执。输入/中间对象清理与备份演练继续待实施。

官方最后已记录成功证据00031/三旧函数与当时10秒Cron；2026-10-22访问401，不能据此认定当前Cron健康。目标缺失至00068须重新核对；火山为独立待验收方案。

源码增量已到00037，实际云端记录未刷新。除 [生产链路](ITERATION_06_PRODUCTION_PIPELINE.md) 外，本次发布须包含 [访问控制](ITERATION_08_ACCESS_CONTROL.md)：旧Key迁移停用，四业务入口函数内验证JWT/Key；团队只从事务API写入；素材删除清理由production调度执行。查看未清理对象只查询 `media_deletions` 的 id/bucket/path/attempts/next_run_at/last_error，不输出认证请求；持续失败应修复Storage并重试原清理项。

最新00038增量见 [批量迭代](ITERATION_09_BATCH_VIDEO.md)。batch-video-jobs与共享videoWorker一起发布，既有调度执行子任务，无需第二套批量模型调度。父表状态仅是控制意图，监控批次须用batch_video_snapshot汇总子任务/预占/结算/退款/unknown；不能直接将父批次标completed。暂停阻止新提交、已受理继续；取消只释放queued，退款故障重试原事务，unknown沿原核对流程处理。

00039新增多规格导出，见 [迭代10](ITERATION_10_RENDER_EXPORTS.md)。先迁移/production-jobs，重建更新FFmpeg镜像和既有production调度，前端最后发布。每用户24个未结案渲染共用队列上限；429等待原任务释放容量。监控production_jobs按export_id的状态/年龄/租约/归档失败，不输出payload/签名/凭据。批次失联恢复原UUID，单项失败不改其他成片；父进度只汇总，不手动标成功。官方Sora API已关闭，旧接口410是退役状态，不通过启用历史端点处理。

00040新增TTS/ASR/即时克隆/照片口播/口型，见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)。部署匹配production-jobs/production-worker/model-settings与兼容音频入口；probe版本2要求voice_clones和五计费项。每用户共用10个未结案媒体任务，默认积分2/2/10/10/10，价格变化拒绝且不扣。unknown核对原账号后用reconcile_production_job提交原音频/正文/voice_id/任务ID及至少10字依据，确定未受理传NULL进入退款事务，不重发POST。需供应商验证的声纹不可配音；监控任务年龄、证据/Storage大小和原流水补偿，生产调度轮转执行，旧视频Cron不能替代。云端记录未刷新。

## 1. 环境与访问责任

生产记录至少包含平台、项目/workspace/branch、URL、前端构建 Git/校验值、迁移回执、函数版本与对应源码、调度方式、配置版本、负责人和验收链接。URL 是公开信息，密钥不写运行记录。

管理凭据用受控凭据系统；本地部署材料存 `.env.deploy.local`，权限 600、Git 忽略。前端仅 URL/anon key；调度器仅后端 URL/Worker 专用密钥；MCP 仅公开连接参数及请求用户 JWT。service_role 仅管理环境使用。

| 项目 | 当前/建议 |
| --- | --- |
| 官方后端 | `https://bbqqhkukgbgpebqpesub.supabase.co`；控制台域名 supabase.com |
| 官方调度 | 历史`shopro-video-workers`每10秒仅旧视频；当前运行状态需恢复访问再核验 |
| 火山调度方案 | 常驻 ECS Docker，默认 10 秒/4 并发；扩展 Cron 可选 |
| 健康 | Worker probe、派发 HTTP、任务年龄、真实成片与账单分别检查 |
| Storage | 本地三桶私有/授权签名/引用与TTL已实现；目标旧桶与存量需迁移验收 |

## 2. 监控与建议告警

00058按原对象去重自动记录未知提交、五分钟到期积压、工单超期、一天终态缺成本、退款结算/交易核对、反复清理失败及调度故障。运营控制台按权限接手，恢复由真实规则消失触发，不能手动标恢复掩盖问题。调度故障持久记录位于scheduler-alerts命名卷，连续三次失败打开/恢复记录；宿主完全停机仍需要独立外部监控。以下是目标值班处置参考，尚未验收SLA或外部通知。

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

生产模式必须`PRODUCTION_WORKER_ENABLED=true`，probe24/00068/render4/edit2全等；启动同时运行生产和独立维护进程，各有健康与持久故障记录。run只执行已入队任务，维护领取计划/留存/删除/指标；日常轻量ready一条RPC，完整probe用于发布核对。monitor每分钟独立扫描，健康需最近派发及三分钟内采集。外部投递需单独启用alerts profile、配置Relay持久幂等回执；宿主完全故障仍需独立监控。

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

微信按原商户/30分钟期限签名查单与关单，竞争付款仍一次入账；两渠道退款仅查询原申请，unknown/PROCESSING/ABNORMAL保留占用，SUCCESS证据才事务回收权益和记录欠额。原退款ID/UUID/渠道/快照/租约须备份；不删除预占或换编号。

### 4.5 身份、图片与编排恢复

本人余额/概览读取503先查00059–61/RPC权限、账号初始化与目标版本，不重置余额/代建赠分。检查正式条款/隐私URL、Auth SMTP/SMS、6位验证码和限流/回跳；SMS原手机独立回执验证。迟到资料/通知/图片不更新新账号，恢复操作使用原账号/UUID。

图片409核对当前原价/配置版本，刷新后确认；编辑无能力/PNG权限拒绝在扣费前处理。每输入12MB、同尺寸非交错PNG、有透明/不透明区。unknown保留原供应商证据，checkpoint后仅归档；不能因源已删再生成。多镜头按原阶段依赖/版本/流水核对，配音真实长度超镜头时长不截断，发布需原阶段UUID/真实预览/逐账号确认。

### 4.6 运营与对象生命周期

工单/租户/风险/现金成本写入核对当前客户范围、版本、原UUID；权限撤销后旧回执也不能绕过。团队预算固定原charge归因，退积分不擦预算；风险只限制新计费，原任务/退款/工单仍恢复。已签链接直到原期限有效。

删除outbox/声纹/知识须保留墓碑、租约和原配置，unknown不能清证据；24小时仅清孤立上传，七天仅清终态原始证据。正式素材/头像/工程引用受保护。检查Storage MIME/大小、清理失败及原供应商删除状态，不直接删除对象或撤销历史密钥。

## 5. 发布与停止派发

1. 确认平台/项目、Git/迁移差距和目标能力，备份并建立发布记录。
2. 暂停新计费生成；停止后续调度并等待在途请求结束。仅停调度不能阻止浏览器 query 执行任务，需同时限制相关用户入口/访问。
3. 核对缺失至00068，部署43生产入口及冻结共享模块/Secrets/源码摘要；官方不要用火山SHA-256脚本重放旧库。
4. 配置管理员/供应商并绑定核对过的旧任务。运行 probe、双用户权限和真实模型小样本。
5. 核对probe24/00068/render4/edit2、真实迁移摘要、最终镜像及前端发布身份，执行六项只读接受；恢复唯一生产/维护调度和FFmpeg，执行真实关页/退款/身份/配置/媒体/平台用例并记录MCP/前端实际运行证据。

官方停止后续 Cron 派发执行 [video_worker_unschedule.sql](../supabase/ops/video_worker_unschedule.sql)，恢复用 [调度指南](VIDEO_SCHEDULER.md)。Docker 用 `manage_video_scheduler.py stop/start`；stop 给在途请求 160 秒宽限。停用不删除任务或退款。

回滚先检查前端/函数/RPC 兼容性。新版配置版任务不能直接交给旧 Worker；优先向前修复或暂停。数据库/模型版本/资金流水不做破坏性回退，已受理任务不重提。

## 6. 备份、密钥与恢复

备份包括数据库（业务/权限/任务/流水/配置版本）、Auth 用户迁移材料、Storage 实物与映射、主密钥/Worker/商户凭据的独立安全备份、迁移回执和前端/函数产物。数据库备份不含 Storage 文件；官方免费项目的实际备份/PITR 能力需按项目确认，不承诺已具备。

可执行加密流程见[备份恢复](BACKUP_RECOVERY.md)：导出快照、账表摘要/迁移回执、Storage实物和完整历史密钥目录一起认证，按原备份ID/摘要上传独立网关、拉回后在空环境恢复。双PG16/真实本地HTTP演练已通过；目标每日/发布前调度、保留策略和独立保管仍须配置，小样本不代表生产RPO/RTO。官方托管Auth/Storage迁移按平台流程验收。

恢复时先关闭新生成和调度，恢复 DB、旧密文与匹配主密钥、Auth/Storage，再核对恢复点之后的供应商受理/支付交易。陈旧 `submitting` 可能已受理，不能恢复 queued 后重提；用审计核对消除差异，再启用 Worker。

凭据轮换：Worker Secret同步Edge与唯一调度器/Vault，支付证书核对期限/序列号；模型Key通过设置页生成新版本并保留旧任务查询凭据。AES-GCM主密钥通过完整keyring更换当前ID，先执行跨全部用途的只读key-preflight，备份完整目录并做空环境恢复；新写入v2按用途AAD，原密文按原ID/legacy键读取。删除历史键或批量重加密不在本轮自动工具范围，见[密钥轮换](KEY_ROTATION.md)。

## 7. 值班与交接

故障记录统一包含环境、时间、范围、任务/订单/配置版本、已知资金影响、处置命令、证据与恢复验收。客服说明见 [运营手册](OPERATIONS_GUIDE.md)。交接不发送明文 Key，记录凭据位置、权限负责人、有效期和恢复责任。

涉及配置/计费/状态的运行变更要更新 [追踪矩阵](CHANGE_TRACEABILITY.md) 与部署记录；健康恢复后仍核对真实任务和资金一致性。

仓库合并及两个最近历史标签见 [版本管理](VERSION_MANAGEMENT.md)。Git标签用于查阅或隔离恢复，不破坏性回退业务数据库；Gitee推送不等于目标环境上线。
