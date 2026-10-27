# 变更、需求与文档追踪矩阵

更新：2026-10-27。下表保留Gitee `ce90bfe..d7e3d38`31提交的历史追踪；本轮工作区未提交。当前优化方案A/B/C/D/S1及ECS指南的实现/验证映射见[实施台账](OPTIMIZATION_IMPLEMENTATION_20261027.md)，接受条件见[PRD](prd/PRD.md)。

## 1. 迭代与实现

| 提交 | 变化/需求 | 实现与验证证据 | 运维/兼容影响 |
| --- | --- | --- | --- |
| 49cb6bb | 六领域文档/OPS-01 | 主文档首次收敛、实际官方与火山区分 | 文档不部署 |
| 53be501 | ASSET-01/IMAGE-01/RENDER-01/PUBLISH-01/METRIC-01 | 00035/36，私有素材/生产队列/FFmpeg/两平台；[06](ITERATION_06_PRODUCTION_PIPELINE.md) | 后端/Storage/容器先于前端 |
| 9ae32c3 | 原版范围与兼容核验 | [2026-10-21历史覆盖](FUNCTION_COVERAGE_REVIEW_20261021.md) | 当前进展由本次基线更新 |
| 4746bb3 | TASK-01 | 三来源任务中心、取消/错误/审核；[07](ITERATION_07_TASK_CENTER.md) | 新API兼容，删除旧重试/直删 |
| 49e0a2a | OPENAPI-01/TEAM-01/ASSET-02 | 00037，Key/成员/共享/outbox；[08](ITERATION_08_ACCESS_CONTROL.md) | 旧Key停用，网关与函数鉴权匹配 |
| 5018620 | BATCH-01/02 | 00038，原预算/版本/暂停取消；[09](ITERATION_09_BATCH_VIDEO.md) | 复用原视频执行器 |
| af64443 | RENDER-02/MODEL-04 | 00039，多规格/4:5/滤镜/Sora退役；[10](ITERATION_10_RENDER_EXPORTS.md) | 共用24配额，旧回执兼容 |
| 70109b2 | AUDIO-02/AVATAR-01 | 00040，五媒体任务/声纹原版本；[11](ITERATION_11_AUDIO_AVATAR_JOBS.md) | 旧同步音频410 |
| 3f218c0 | 素材分析/高光/分镜 | 00041，实际抽帧ASR/两段任务/MP4；[12](ITERATION_12_GROUNDED_ANALYSIS.md) | 重建分析镜像，源证据固定 |
| 7b36713 | METRIC-02/ATTR-01/EXPERIMENT-01 | 00042，签名观测/分组事件/统计；[13](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md) | 授权来源独立，不混自然指标 |
| 5a6cfaf | KNOWLEDGE-02 | 00043，私有向量/版本/引用；[14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md) | 200条/24块有界，非训练 |
| 690a151 | INTELLIGENCE-01 | 00044，官方/授权来源/预算/留存；[15](ITERATION_15_MARKET_INTELLIGENCE.md) | 20槽，真实数据商待验收 |
| 58942ab | RENDER-03–05/EDITOR-02 | 十二转场/八混合/色键；[16](ITERATION_16_RENDER_EFFECTS.md) | API与FFmpeg双校验 |
| ec4f03b | MCP-02–04/OPENAPI-02 | SDK工具/权限/原UUID/并发隔离；[17](ITERATION_17_MCP_PRODUCTION.md) | 无模型/资金旁路 |
| cddb120 | PUBLISH-02/03 | 00045，逐账号确认/组事务；[18](ITERATION_18_PUBLISH_GROUPS.md) | 成功项不重复派发 |
| 0dfaca7 | 商品真实来源/事务管理 | 00046，JSON-LD/私有图/CSV/版本；[19](ITERATION_19_PRODUCT_MANAGEMENT.md) | 撤销浏览器商品写入 |
| 43d6772 | CASH-01/02/OPS-01/BUDGET-01 | 00047/48，现金权益/可信运营/UTC预算；[20](ITERATION_20_CASH_OPERATIONS.md) | 原退款只查询，欠额保留 |
| 606eb08 | INTELLIGENCE-02/PRODUCT-TRANSLATE-01/NOTIFY-01 | 00049，图片搜索/12语言/真实通知；[21](ITERATION_21_TRANSLATION_NOTIFICATIONS.md) | 原商品/模型版本、cutoff |
| b10859b | CHECKOUT-02/FE-LOAD-01 | 00050，原订单收银/真实账单/懒加载；[22](ITERATION_22_CHECKOUT_LOADING.md) | 待支付10上限，原UUID |
| bcc1a93 | MEDIA-LIFECYCLE-01/VOICE-REVOKE-01/KNOWLEDGE-ERASE-01 | 00051，引用TTL/声纹删除/知识清除；[23](ITERATION_23_DATA_LIFECYCLE.md) | 墓碑/租约/unknown证据保留 |
| 7064b48 | WECHAT-TRANSACTION-01/WECHAT-CASH-REFUND-01 | 00052，签名查单/关单/退款；[24](ITERATION_24_WECHAT_TRANSACTIONS.md) | 原商户/期限，SUCCESS才回收 |
| 1337604 | EDIT-BEATS-01/EDIT-SUBTITLES-01/PERSON-MASK-01 | 00053，PCM节拍/Whisper时间段/alpha；[25](ITERATION_25_EDIT_ANALYSIS.md) | 固定模型，空间/时长有界 |
| 21ac3fe | MATERIAL-REGISTER-01/RECORDING-01/AUDIO-EDIT-01/MCP-EDIT-01 | 00054，存储登记/录音/音频效果；[26](ITERATION_26_EDITOR_ASSETS.md) | 原上传回执，render4 |
| 1cffa95 | BATCH-PIPELINE-01 | 00055，多镜头配音/字幕/工程/发布；[27](ITERATION_27_BATCH_PIPELINE.md) | 阶段原流水、edit2/MCP59/19 |
| 25645fb | SUPPORT-01/TENANT-OPS-01/RISK-DISPOSITION-01/SUPPLIER-CASH-01 | 00056，工单/租户/风险/现金成本；[28](ITERATION_28_OPERATIONS_WORKFLOWS.md) | 当前范围/版本/原UUID |
| 16975d3 | OPS-ALERT-01/RECOVERY-01 | 00057/58，锁序/持久告警/双PG恢复；[29](ITERATION_29_ALERTS_RECOVERY.md) | 心跳/持久卷/历史密钥 |
| bf7aaf5 | WORK-LIBRARY-01 | 真实分页/原上传/首页作品/去演示；[30](ITERATION_30_WORKS_LIBRARY.md) | 旧数据库记录不作成功证据 |
| 839143e | ACCOUNT-ISOLATION-01/PROFILE-OVERVIEW-01/STORYBOARD-FLOW-01 | 00059，本人聚合/时区/头像/脚本复用；[31](ITERATION_31_ACCOUNT_STORYBOARD.md) | 账号布局/缓存/路由输入隔离 |
| 92308b7 | REWARD-INVITE-01/REWARD-ACTIVITY-01/AUTH-RECOVERY-01/ERROR-REPORT-01 | 00060，验证奖励/原领取/密码恢复；[32](ITERATION_32_REWARDS_AUTH.md) | 旧邀请不补发，真实资格 |
| 79afcfb | CREDITS-AUTHORITY-01/AUTH-SMS-01/LEGAL-RESOURCE-01/NOTIFICATION-IDENTITY-01 | 00061，权威权益/SMS隔离/正式协议；[33](ITERATION_33_CREDITS_SMS.md) | 故障不降级，原手机/回执 |
| d7e3d38 | IMAGE-EDIT-01/TOOL-ENTRY-01 | 00062，扩图/矩形重绘/原价版本/入口；[34](ITERATION_34_IMAGE_EDITING.md) | probe22，固定JWT/迟到隔离 |

继承基线：原始`dd8fcab`；`374914b/4d707f2`资金/类型，`1928a72`视频队列，`712c8b7`调度，`276208c`官方接入，`5ba7466`火山适配，`ce90bfe`加密不可变模型配置。对应证据在 [01](ITERATION_01_FINANCE.md)、[02](ITERATION_02_TYPECHECK.md)、[03](ITERATION_03_VIDEO_JOBS.md)、[官方记录](DEPLOYMENT_AIGCP.md)和历史架构报告。

## 2. 六领域同步关系

| 主题 | 需求 | 方案/开发 | 测试 | 运营/财务 | 运维 |
| --- | --- | --- | --- | --- | --- |
| 身份/奖励/权益 | PRD身份与新增行 | API本人RPC、开发账号边界 | profile/rewards/account-credits与SMS页面 | 真实同意/验证/历史账/错误说明 | Auth配置/回跳/限流/原回执 |
| 模型/媒体/编辑/编排 | PRD模态与BATCH/优化A–D | 架构、MODEL_SETTINGS、AI、API | 原任务/attempt/共享查询/剪辑/受限媒体 | 价格/版权/质量/原UUID/真实现金 | probe24/render4/edit2/私有对象/可信出口 |
| 商品/知识/情报/观测 | PRD来源/版本/统计 | API与统一服务端报告 | products/translation/knowledge/intelligence/measurements | 数据口径/授权/成本/实验 | 留存/容量/来源/配置版本 |
| 支付/团队/运营 | PRD CASH/TEAM/SUPPORT | 后端、API/锁序/可信范围 | cash/wechat/checkout/access/operations | 两渠道对账/工单/风险/现金成本 | 原商户/预占/告警/审计 |
| 恢复/发布 | PRD OPS/RECOVERY、B1/B3/D3/S1 | 冻结锁、发布manifest/身份、keyring | 告警Relay/归档拉回/双PG/旧库接受 | 客户窗口/原事件回执/真实目标 | RUNBOOK/独立维护/异地备份/发布接受 |

## 3. 当前发布缺口

官方已记录00031/三旧函数成功及2026-10-22管理401，本轮未复核；当前源码须核对缺失至00068、43入口/冻结共享模块、生产/独立维护、FFmpeg/MCP/备份镜像与前端身份。火山/ECS资源、正式告警/异地调度、真实身份/供应商/商户/平台及容量见[待办](PENDING_CHANGES.md)。

历史Git交付见[2026-10-22报告](TEST_REPORT_20261022.md)和[版本管理](VERSION_MANAGEMENT.md)，本轮改动未commit/push；当前范围与新鲜证据见[实施台账](OPTIMIZATION_IMPLEMENTATION_20261027.md)及[当前状态](CURRENT_STATE.md)。

## 4. 后续变更记录要求

每次记录提交/需求ID/迁移/调用方、旧任务兼容、测试证据、价格提示、权限、监控与恢复。部署另记实际项目/迁移/函数/镜像/构建指纹与业务证据，不用本地提交或只读探针替代上线回执。
