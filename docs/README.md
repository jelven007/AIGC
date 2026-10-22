# 项目文档中心

更新：2026-10-22，功能基线`d7e3d38`，迭代01–34。本次按31个尚未同步Gitee的提交统一需求、方案、开发、测试、运营和运维。先读 [全生命周期发布基线](RELEASE_BASELINE_20261022.md) 和 [当前状态](CURRENT_STATE.md)；当前源码00062/probe22/render4/edit2、MCP59/19、模型20槽，官方最新全栈未部署。

## 按职责阅读

| 领域 | 主文档 | 内容 |
| --- | --- | --- |
| 产品 | [PRD](prd/PRD.md)、[计划书](prd/计划书.md)、[竞品](prd/竞品.md) | 当前完整接受条件、商业假设与未覆盖范围 |
| 方案 | [技术架构](TECHNICAL_ARCHITECTURE.md)、[业务后端](后端.md) | 账号边界、服务端事务、队列/编排、运营和恢复架构 |
| 开发 | [开发指南](DEVELOPMENT_GUIDE.md)、[API与数据](API_AND_DATA.md) | 环境、修改入口、当前契约、兼容与检查 |
| 模型 | [模型设置](MODEL_SETTINGS.md)、[AI方案](ai/ai.md) | 20槽不可变配置、图片编辑、实际协议、质量和成本 |
| 测试 | [测试计划](TEST_PLAN.md)、[2026-10-22报告](TEST_REPORT_20261022.md) | 迭代验证索引、本轮文档检查与真实目标待验收 |
| 运营 | [运营手册](OPERATIONS_GUIDE.md)、[商业化](plan/商业化.md) | 用户培训、工单/风险/租户、权益、实际经营口径 |
| 财务 | [支付与积分](plan/支付.md) | 收银、两渠道验签/退款、权益/欠额、供应商现金成本 |
| 运维 | [运行手册](RUNBOOK.md)、[调度](VIDEO_SCHEDULER.md)、[备份恢复](BACKUP_RECOVERY.md) | probe22、独立FFmpeg、持久告警、原任务核对、加密恢复 |
| 部署 | [官方记录](DEPLOYMENT_AIGCP.md)、[火山方案](VOLCENGINE_DEPLOYMENT.md) | 实际00031旧回执、00032–00062升级、独立迁移工具 |
| MCP | [接入指南](../mcp/mcp.md)、[工具目录](../mcp/tools.json) | 59真实工具、19权限、原请求/预算/身份/传输边界 |
| 发布 | [追踪矩阵](CHANGE_TRACEABILITY.md)、[待办](PENDING_CHANGES.md)、[版本管理](VERSION_MANAGEMENT.md) | 全部提交对照、目标差距、Gitee合并和两个历史标签 |
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
