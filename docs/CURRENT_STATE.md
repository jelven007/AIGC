# 当前版本与运行状态

核验日期：2026-10-31。当前发布目标`v1.0.0`。源码整理、测试、合并、发布与环境升级回执以[生产基线](releases/PRODUCTION_BASELINE.md)为准；未完成的执行步骤不能视为成功。

| 项目 | 已核对事实 |
| --- | --- |
| 应用仓库 | `shoproai`为独立Git仓库，GitHub`jelven007/AIGC`、`master`；本次重新fetch远端`63ff09910869990a84f7cb4e626c602a0737e63e` |
| 当前运行 | ECS`https://118.196.122.161`、`shopro-ecs`、11类服务/26容器，其中16媒体执行器；本地自托管11服务，开发入口5173 |
| 源码覆盖 | 48路由页面/13领域、68迁移文件/66生产迁移、43生产Edge入口、20模型槽、MCP59工具/19权限 |
| 运行契约 | required_migration=00068、probe24、render4、edit2，共用runtime-contract.json |
| 界面与功能 | 分镜、素材/媒体库、模型与第三方集成分工、积分动作、运营真实统计/筛选/会话隔离、全站鲜明浅/深主题与响应式 |
| 目录与文档 | 旧后台/API/实验和重复技能工具退出当前源码；Git祖先保留，运行数据/产物/备份独立生命周期；七类权威文档来源见[lifecycle.json](lifecycle.json) |
| 容量证据 | 100真实账号五分钟29044业务请求/0错/P95 17.52ms，100份10秒720p成片74.768秒排空；MCP/100条Realtime及原实例恢复见[容量验收](testing/SELF_HOSTED_CAPACITY_100_20261031.md) |
| 恢复证据 | 冷快照/新卷恢复、原UUID/余额/成片与历史密钥验收见[自托管验收](testing/SELF_HOSTED_ACCEPTANCE_20261031.md)；本次升级再做快照和原数据核对 |
| 原官方环境 | 独立保留，最近00031/三旧函数，管理401；不以ECS验收代表该目标升级 |

任务保持原账号、UUID、价格/配置、账务/租约/未知请求证据。当前ECS原数据卷和容量profile保留；本地数据迁出源码前先快照。原身份、余额、文件差异会阻止清理与发布验收。

未接入的真实模型、支付、短信、邮件和外部平台权限需要经营配置与独立接受。公网IP为自签证书，正式域名证书、外部值班通知和异地备份调度继续列为接入条件。当前单机没有多机高可用或实测SLA承诺。

阅读顺序：[需求](prd/PRD.md)→[技术架构](architecture/TECHNICAL_ARCHITECTURE.md)→[开发](development/DEVELOPMENT_GUIDE.md)→[测试](testing/TEST_PLAN.md)→[运营](operations/OPERATIONS_GUIDE.md)→[运维](deployment/SELF_HOSTED_ECS_RUNBOOK.md)→[版本与保留](releases/VERSION_MANAGEMENT.md)。
