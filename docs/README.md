# 项目文档中心

本项目是以视频生成为核心的创作平台，覆盖创意、分镜、素材、配音、剪辑、导出与发布。商品资料为产品展示类创作提供辅助输入。

更新：2026-10-31。当前完整应用已在`https://118.196.122.161`单台ECS自托管运行，默认`admin/<REDACTED_CREDENTIAL>`。先读[当前状态](CURRENT_STATE.md)、[技术架构](architecture/TECHNICAL_ARCHITECTURE.md)、[ECS运行手册](deployment/SELF_HOSTED_ECS_RUNBOOK.md)和[实际验收](testing/SELF_HOSTED_ACCEPTANCE_20261031.md)。当前契约00068/probe24/render4/edit2、66生产迁移、43生产入口、MCP59/19、模型20槽。原官方云端与历史记录按原时点阅读。

方案：[2026-10-25 项目全面分析与优化方案](archive/reviews/PROJECT_ANALYSIS_OPTIMIZATION_20261025.md)。以当时`9099386`源码为依据，包含正确性问题、目标架构、ECS取舍、工作量与验收条件；当前实施结果以台账为准，云端现状未在本轮重新核验。

实施进度：[2026-10-27 全面优化实施与验证](archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)。记录逐项代码改动、本地回归及未完成事项；优化方案中的历史状态不代表当前实施进度。

开发与发布入口：[固定开发环境](development/DEVELOPMENT_GUIDE.md#固定开发入口与环境矩阵)、[生产基线](releases/PRODUCTION_BASELINE.md)、[版本保留](releases/VERSION_MANAGEMENT.md)。ECS自托管已上线；原官方托管目标独立保留，管理401且未升级。当前文档事实来源、责任、核验日期与刷新触发见[生命周期登记](lifecycle.json)。

执行入口：[调度与独立维护](operations/WORKER_SCHEDULING.md)、[媒体与MCP资源边界](operations/MEDIA_WORKER_RESOURCES.md)。包括持久公平预算、单任务空间/下载缓存、退出恢复和受限协议运行。

运维与测量：[密钥轮换](operations/KEY_ROTATION.md)、[告警投递](operations/ALERT_DELIVERY.md)、[异地备份恢复](operations/BACKUP_RECOVERY.md)、[数据库容量](operations/DATABASE_CAPACITY.md)、[模型评估](ai/EVALUATION.md)。本地结果与真实目标接受分别记录。

## 按职责阅读

| 领域 | 主文档 | 内容 |
| --- | --- | --- |
| 产品 | [PRD](prd/PRD.md)、[计划书](prd/计划书.md)、[竞品](prd/竞品.md) | 当前完整接受条件、商业假设与未覆盖范围 |
| 方案 | [技术架构](architecture/TECHNICAL_ARCHITECTURE.md)、[业务后端](architecture/后端.md) | 账号边界、服务端事务、队列/编排、运营和恢复架构 |
| 开发 | [开发指南](development/DEVELOPMENT_GUIDE.md)、[API与数据](development/API_AND_DATA.md) | 环境、修改入口、当前契约、兼容与检查 |
| 模型 | [模型设置](development/MODEL_SETTINGS.md)、[AI方案](ai/ai.md) | 20槽不可变配置、图片编辑、实际协议、质量和成本 |
| 测试 | [测试计划](testing/TEST_PLAN.md)、[2026-10-27实施证据](archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md) | 本地专项、最终检查和真实目标待验收 |
| 运营 | [运营手册](operations/OPERATIONS_GUIDE.md)、[商业化](plan/商业化.md) | 用户培训、工单/风险/租户、权益、实际经营口径 |
| 财务 | [支付与积分](plan/支付.md) | 收银、两渠道验签/退款、权益/欠额、供应商现金成本 |
| 运维 | [运行手册](operations/RUNBOOK.md)、[调度](operations/VIDEO_SCHEDULER.md)、[备份恢复](operations/BACKUP_RECOVERY.md) | probe24、独立维护/FFmpeg、告警回执、原任务核对、异地恢复 |
| 部署 | [官方记录](releases/DEPLOYMENT_AIGCP.md)、[火山方案](releases/VOLCENGINE_DEPLOYMENT.md)、[发布接受](releases/RELEASE_ACCEPTANCE.md) | 00031历史回执、目标缺失至00068、独立迁移与ECS对等 |
| MCP | [接入指南](../mcp/mcp.md)、[工具目录](../mcp/tools.json) | 59真实工具、19权限、原请求/预算/身份/传输边界 |
| 发布 | [追踪矩阵](CHANGE_TRACEABILITY.md)、[待办](PENDING_CHANGES.md)、[版本管理](releases/VERSION_MANAGEMENT.md) | 全部提交对照、目标差距、GitHub合并和两个历史标签 |
| 历史 | [2026-10-21测试](archive/reviews/TEST_REPORT_20261021.md)、[当日覆盖核验](archive/reviews/FUNCTION_COVERAGE_REVIEW_20261021.md)、[当日架构对比](archive/reviews/ARCHITECTURE_REVIEW_20261021.md) | 保留原核验时点；当前范围以本次综合基线为准 |

## 迭代记录

| 迭代 | 内容 |
| --- | --- |
| 01–03 | [资金事务](archive/iterations/ITERATION_01_FINANCE.md)、[类型与检查](archive/iterations/ITERATION_02_TYPECHECK.md)、[视频租约队列](archive/iterations/ITERATION_03_VIDEO_JOBS.md) |
| 04–05 | 调度/官方接入/火山适配/统一模型，提交及证据在 [追踪矩阵](CHANGE_TRACEABILITY.md)；未另建同号报告 |
| 06–08 | [私有生产链](archive/iterations/ITERATION_06_PRODUCTION_PIPELINE.md)、[任务中心](archive/iterations/ITERATION_07_TASK_CENTER.md)、[Key/团队共享](archive/iterations/ITERATION_08_ACCESS_CONTROL.md) |
| 09–11 | [批量视频](archive/iterations/ITERATION_09_BATCH_VIDEO.md)、[多规格导出](archive/iterations/ITERATION_10_RENDER_EXPORTS.md)、[语音数字人](archive/iterations/ITERATION_11_AUDIO_AVATAR_JOBS.md) |
| 12–14 | [真实素材分析](archive/iterations/ITERATION_12_GROUNDED_ANALYSIS.md)、[观测实验](archive/iterations/ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)、[私有知识](archive/iterations/ITERATION_14_KNOWLEDGE_RETRIEVAL.md) |
| 15–17 | [正式情报](archive/iterations/ITERATION_15_MARKET_INTELLIGENCE.md)、[剪辑效果](archive/iterations/ITERATION_16_RENDER_EFFECTS.md)、[MCP生产链](archive/iterations/ITERATION_17_MCP_PRODUCTION.md) |
| 18–20 | [发布组](archive/iterations/ITERATION_18_PUBLISH_GROUPS.md)、[商品管理](archive/iterations/ITERATION_19_PRODUCT_MANAGEMENT.md)、[现金/运营](archive/iterations/ITERATION_20_CASH_OPERATIONS.md) |
| 21–23 | [翻译通知](archive/iterations/ITERATION_21_TRANSLATION_NOTIFICATIONS.md)、[收银加载](archive/iterations/ITERATION_22_CHECKOUT_LOADING.md)、[数据生命周期](archive/iterations/ITERATION_23_DATA_LIFECYCLE.md) |
| 24–26 | [微信交易](archive/iterations/ITERATION_24_WECHAT_TRANSACTIONS.md)、[音轨与人物蒙版](archive/iterations/ITERATION_25_EDIT_ANALYSIS.md)、[素材录音](archive/iterations/ITERATION_26_EDITOR_ASSETS.md) |
| 27–29 | [多镜头编排](archive/iterations/ITERATION_27_BATCH_PIPELINE.md)、[运营持久流程](archive/iterations/ITERATION_28_OPERATIONS_WORKFLOWS.md)、[告警恢复](archive/iterations/ITERATION_29_ALERTS_RECOVERY.md) |
| 30–32 | [作品库](archive/iterations/ITERATION_30_WORKS_LIBRARY.md)、[账号分镜](archive/iterations/ITERATION_31_ACCOUNT_STORYBOARD.md)、[奖励恢复](archive/iterations/ITERATION_32_REWARDS_AUTH.md) |
| 33–34 | [积分短信](archive/iterations/ITERATION_33_CREDITS_SMS.md)、[图片编辑](archive/iterations/ITERATION_34_IMAGE_EDITING.md) |

## 使用约定

源码实现、隔离验证、仓库同步和目标部署分别记录。历史迭代中的数量、未实现项与旧部署要求按记录时点阅读，不用于当前操作。没有实际证据的成功率、转化、现金成本、SLA与RPO/RTO保持未知。

旧后台/API/实验已退出当前源码，完整Git祖先保留；当前运营入口为React `/operations`和Supabase事务。演示[提纲](ppt/ppt.md)、[答疑](archive/presentations/答辩.md)按记录时点阅读。历史审计和研究位于`docs/archive/`，不替代当前验收。

变更涉及身份、状态、价格、权限、配置或API时同步主文档和对应专项。凭据、JWT、密文及全量生产日志不得进入文档；实际环境地址可以记录，秘密材料只保存在受控系统。
