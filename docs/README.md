# AIGC 项目文档中心

核验：2026-11-01。读者：产品、开发、测试、运营、运维和发布维护者。责任：仓库维护者。每次发布复核；目录、契约或运行回执变化未同步即过期。

每个系统只有一个权威位置。重复说明指向主文档；历史资料在 archive 中标明原核验时点，不作为当前操作依据。完整登记见[lifecycle.json](lifecycle.json)。

项目目录与包名统一为 `aigc`，平台名称为「内容创作平台」。v1.2.0整合命名、来源、素材复用、控件与兼容恢复，当前晋级阶段见[当前状态](CURRENT_STATE.md)，执行条件见[发布方案](plan/RELEASE_V1_2_0.md)。各专项记录保留原核验时点。

原源仓库远端、演示服务、固定账号和公开截图的清理，以及许可证/任务回执/持久数据标识的保留边界，见 [源内容清理记录](releases/SOURCE_CLEANUP_20261101.md)。源码清理与线上发布分开验收。

平台显示名称统一为「内容创作平台」。上次移出的35个旧图片和6个宣传组件见 [逐项明细与缩略图](releases/SOURCE_CLEANUP_INVENTORY_20261101.md)。

按后续要求已复用35张裁剪/优化的衍生图，并重构全部六个宣传组件接回介绍页；功能名统一为「爆款风格复刻」。逐图位置、图库交互、原件摘要与发布边界见 [素材复用记录](releases/ASSET_REUSE_20261101.md)。

| 阶段 | 当前权威文档 | 使用目的 |
| --- | --- | --- |
| 需求 | [PRD](prd/PRD.md) | 功能范围、接受条件、经营接入与未交付项 |
| 方案 | [架构](architecture/TECHNICAL_ARCHITECTURE.md)、[目录](development/PROJECT_STRUCTURE.md) | 边界、依赖、持久状态、协议与迁移责任 |
| 开发 | [指南](development/DEVELOPMENT_GUIDE.md)、[API](development/API_AND_DATA.md)、[页面规范](development/UI_STANDARDS.md) | 固定环境、源码入口、接口和页面一致性 |
| 测试 | [计划](testing/TEST_PLAN.md)、[目录迁移证据](development/DIRECTORY_MIGRATION_V1_1_0.md)、[环境接受回执](releases/V1_1_0_EXECUTION_20261101.md) | 受影响门禁、依赖、真实页面与数据验收 |
| 运营 | [手册](operations/OPERATIONS_GUIDE.md)、[支付](plan/支付.md) | 用户培训、工单、原任务/账务核对、指标口径 |
| 运维 | [ECS升级恢复](deployment/SELF_HOSTED_ECS_RUNBOOK.md)、[运行](operations/RUNBOOK.md) | 身份、容量、快照、升级、回退与处置 |
| 发布 | [当前状态](CURRENT_STATE.md)、[生产基线](releases/PRODUCTION_BASELINE.md)、[版本管理](releases/VERSION_MANAGEMENT.md) | 固定版本身份、两环境晋级和保留 |

专项入口：[模型配置](development/MODEL_SETTINGS.md)、[MCP接入](../services/mcp/mcp.md)与[59工具目录](../services/mcp/tools.json)、[持久调度](operations/WORKER_SCHEDULING.md)、[媒体资源](operations/MEDIA_WORKER_RESOURCES.md)、[密钥轮换](operations/KEY_ROTATION.md)、[告警](operations/ALERT_DELIVERY.md)、[备份恢复](operations/BACKUP_RECOVERY.md)、[数据库容量](operations/DATABASE_CAPACITY.md)、[模型评估](ai/EVALUATION.md)。

v1.2.0源码范围：48页面/13业务域、223源码模块、43生产入口、68迁移文件/66生产迁移、16模型接口+4第三方槽、MCP59/19、00068/probe24/render4/edit2。源码、测试和线上启用状态分别记录，旧官方托管环境不由本轮ECS升级代替。

v1.1.0整理计划和执行边界见[本轮计划](plan/PRODUCTION_REORGANIZATION_V1_1_0.md)，实际两环境升级与发布结果见[正式回执](releases/V1_1_0_EXECUTION_20261101.md)。过往迭代和旧权威文档位于 archive；旧公开凭据历史的处理边界见[清理说明](CREDENTIAL_HISTORY_CLEANUP.md)。发布截图和回执不得暴露密码、JWT、模型密钥或真实客户数据。

每次文档变更随源码提交接受 pnpm check:structure 的链接、来源与依赖检查，CI同步运行。过期文档先标注再归档，当前文档不得用历史测试结果宣称新版部署完成。
