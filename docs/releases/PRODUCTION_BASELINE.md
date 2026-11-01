# 生产版本基线

类型：reference。读者：发布、测试与运维维护者。责任：发布维护者。核验：2026-11-01。权威来源：固定Git版本、封存交付与各环境回执。每次晋级更新；没有当轮身份/业务/载荷证据不能标记完成。

当前两环境运行v1.1.0-compat-ed48a11e4025，源码SHA256为ed48a11e40259e6aeabcba49627b9adf73b27c831d7134b2a8abbd1780db0034；兼容与新卷恢复证据见[专项回执](COMPAT_RECOVERY_20261101.md)。v1.2.0整合候选正在按[发布方案](../plan/RELEASE_V1_2_0.md)验收，尚未晋级。实时阶段见[当前状态](../CURRENT_STATE.md)。

以下为v1.1.0初次正式发布的历史基线：标签固定7f6b99676cf838c1e36a4d41bbaac355bbe3edc8，源码SHA256为8d327ae40e7469de979de7e3b53b2003fa1dfaab17fa82b62209b73b214f0e45，原运行目录v1.1.0-8d327ae40e74。后续兼容交付与文档提交不移动该标签。

本地11、ECS26健康服务含16渲染器；原账号、余额、任务、私有视频、JWT、历史密钥与容量保持。三环境真实页面接受234次，零页面错误/失败响应。两架构各1151个交付文件，仅镜像清单有预期差异。完整包摘要、范围、事件、发布下载及保留结果见[正式回执](V1_1_0_EXECUTION_20261101.md)，公开结构化证据见[接受回执](release-acceptance-v1.1.0.json)。

本轮范围与门禁：[计划](../plan/PRODUCTION_REORGANIZATION_V1_1_0.md)、[目录回执](../development/DIRECTORY_MIGRATION_V1_1_0.md)、[测试计划](../testing/TEST_PLAN.md)。保留current及最多两历史；业务卷、私有配置与加密恢复材料独立管理，见[版本策略](VERSION_MANAGEMENT.md)。

原v1.0.1与未提交热修复的记录已归档。标签基于脱敏历史后SHA变化，原构建/附件摘要仍只证明原始字节，不能冒充新标签精确构建。说明见[历史清理](../CREDENTIAL_HISTORY_CLEANUP.md)。当前实时状态见[CURRENT_STATE](../CURRENT_STATE.md)。
