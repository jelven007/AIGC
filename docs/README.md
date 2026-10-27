# 项目文档中心

更新：2026-10-27，迭代01–34加本轮本地优化。先读[当前状态](CURRENT_STATE.md)和[实施台账](OPTIMIZATION_IMPLEMENTATION_20261027.md)；当前源码00068/probe24/render4/edit2、66生产迁移、43生产入口、MCP59/19、模型20槽。最新全栈未部署，2026-10-22历史基线保留原时点。

方案：[2026-10-25 项目全面分析与优化方案](PROJECT_ANALYSIS_OPTIMIZATION_20261025.md)。以当时`9099386`源码为依据，包含正确性问题、目标架构、ECS取舍、工作量与验收条件；当前实施结果以台账为准，云端现状未在本轮重新核验。

实施进度：[2026-10-27 全面优化实施与验证](OPTIMIZATION_IMPLEMENTATION_20261027.md)。记录逐项代码改动、本地回归及未完成事项；优化方案中的历史状态不代表当前实施进度。

开发与发布入口：[可复现安装、全栈回执及脚本恢复](REPRODUCIBLE_RELEASE.md)、[全栈接受与ECS对等运行](RELEASE_ACCEPTANCE.md)。单一pnpm锁、冻结Edge图、Python哈希锁及前端发布身份，包含新增00063–00068。

执行入口：[调度与独立维护](WORKER_SCHEDULING.md)、[媒体与MCP资源边界](MEDIA_WORKER_RESOURCES.md)。包括持久公平预算、单任务空间/下载缓存、退出恢复和受限协议运行。

运维与测量：[密钥轮换](KEY_ROTATION.md)、[告警投递](ALERT_DELIVERY.md)、[异地备份恢复](BACKUP_RECOVERY.md)、[数据库容量](DATABASE_CAPACITY.md)、[模型评估](ai/EVALUATION.md)。本地结果与真实目标接受分别记录。

## 按职责阅读

| 领域 | 主文档 | 内容 |
| --- | --- | --- |
| 产品 | [PRD](prd/PRD.md)、[计划书](prd/计划书.md)、[竞品](prd/竞品.md) | 当前完整接受条件、商业假设与未覆盖范围 |
| 方案 | [技术架构](TECHNICAL_ARCHITECTURE.md)、[业务后端](后端.md) | 账号边界、服务端事务、队列/编排、运营和恢复架构 |
| 开发 | [开发指南](DEVELOPMENT_GUIDE.md)、[API与数据](API_AND_DATA.md) | 环境、修改入口、当前契约、兼容与检查 |
| 模型 | [模型设置](MODEL_SETTINGS.md)、[AI方案](ai/ai.md) | 20槽不可变配置、图片编辑、实际协议、质量和成本 |
| 测试 | [测试计划](TEST_PLAN.md)、[2026-10-27实施证据](OPTIMIZATION_IMPLEMENTATION_20261027.md) | 本地专项、最终检查和真实目标待验收 |
| 运营 | [运营手册](OPERATIONS_GUIDE.md)、[商业化](plan/商业化.md) | 用户培训、工单/风险/租户、权益、实际经营口径 |
| 财务 | [支付与积分](plan/支付.md) | 收银、两渠道验签/退款、权益/欠额、供应商现金成本 |
| 运维 | [运行手册](RUNBOOK.md)、[调度](VIDEO_SCHEDULER.md)、[备份恢复](BACKUP_RECOVERY.md) | probe24、独立维护/FFmpeg、告警回执、原任务核对、异地恢复 |
| 部署 | [官方记录](DEPLOYMENT_AIGCP.md)、[火山方案](VOLCENGINE_DEPLOYMENT.md)、[发布接受](RELEASE_ACCEPTANCE.md) | 00031历史回执、目标缺失至00068、独立迁移与ECS对等 |
| MCP | [接入指南](../mcp/mcp.md)、[工具目录](../mcp/tools.json) | 59真实工具、19权限、原请求/预算/身份/传输边界 |
| 发布 | [追踪矩阵](CHANGE_TRACEABILITY.md)、[待办](PENDING_CHANGES.md)、[版本管理](VERSION_MANAGEMENT.md) | 全部提交对照、目标差距、GitHub合并和两个历史标签 |
| 历史 | [2026-10-21测试](TEST_REPORT_20261021.md)、[当日覆盖核验](FUNCTION_COVERAGE_REVIEW_20261021.md)、[当日架构对比](ARCHITECTURE_REVIEW_20261021.md) | 保留原核验时点；当前范围以本次综合基线为准 |

## 迭代记录

| 迭代 | 内容 |
| --- | --- |
| 01–03 | [资金事务](ITERATION_01_FINANCE.md)、[类型与检查](ITERATION_02_TYPECHECK.md)、[视频租约队列](ITERATION_03_VIDEO_JOBS.md) |
| 04–05 | 调度/官方接入/火山适配/统一模型，提交及证据在 [追踪矩阵](CHANGE_TRACEABILITY.md)；未另建同号报告 |
| 06–08 | [私有生产链](ITERATION_06_PRODUCTION_PIPELINE.md)、[任务中心](ITERATION_07_TASK_CENTER.md)、[Key/团队共享](ITERATION_08_ACCESS_CONTROL.md) |
| 09–11 | [批量视频](ITERATION_09_BATCH_VIDEO.md)、[多规格导出](ITERATION_10_RENDER_EXPORTS.md)、[语音数字人](ITERATION_11_AUDIO_AVATAR_JOBS.md) |
| 12–14 | [真实素材分析](ITERATION_12_GROUNDED_ANALYSIS.md)、[观测实验](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)、[私有知识](ITERATION_14_KNOWLEDGE_RETRIEVAL.md) |
| 15–17 | [正式情报](ITERATION_15_MARKET_INTELLIGENCE.md)、[剪辑效果](ITERATION_16_RENDER_EFFECTS.md)、[MCP生产链](ITERATION_17_MCP_PRODUCTION.md) |
| 18–20 | [发布组](ITERATION_18_PUBLISH_GROUPS.md)、[商品管理](ITERATION_19_PRODUCT_MANAGEMENT.md)、[现金/运营](ITERATION_20_CASH_OPERATIONS.md) |
| 21–23 | [翻译通知](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)、[收银加载](ITERATION_22_CHECKOUT_LOADING.md)、[数据生命周期](ITERATION_23_DATA_LIFECYCLE.md) |
| 24–26 | [微信交易](ITERATION_24_WECHAT_TRANSACTIONS.md)、[音轨与人物蒙版](ITERATION_25_EDIT_ANALYSIS.md)、[素材录音](ITERATION_26_EDITOR_ASSETS.md) |
| 27–29 | [多镜头编排](ITERATION_27_BATCH_PIPELINE.md)、[运营持久流程](ITERATION_28_OPERATIONS_WORKFLOWS.md)、[告警恢复](ITERATION_29_ALERTS_RECOVERY.md) |
| 30–32 | [作品库](ITERATION_30_WORKS_LIBRARY.md)、[账号分镜](ITERATION_31_ACCOUNT_STORYBOARD.md)、[奖励恢复](ITERATION_32_REWARDS_AUTH.md) |
| 33–34 | [积分短信](ITERATION_33_CREDITS_SMS.md)、[图片编辑](ITERATION_34_IMAGE_EDITING.md) |

## 使用约定

源码实现、隔离验证、仓库同步和目标部署分别记录。历史迭代中的数量、未实现项与旧部署要求按记录时点阅读，不用于当前操作。没有实际证据的成功率、转化、现金成本、SLA与RPO/RTO保持未知。

`backend/`保留历史规格；当前运营入口为React `/operations`和Supabase事务。演示 [提纲](ppt/ppt.md)、[答疑](ok/答辩.md) 引用本次事实。历史`docs/ok`、`doc`审计与研究不替代当前验收。

变更涉及身份、状态、价格、权限、配置或API时同步主文档和对应专项。凭据、JWT、密文及全量生产日志不得进入文档；实际环境地址可以记录，秘密材料只保存在受控系统。
