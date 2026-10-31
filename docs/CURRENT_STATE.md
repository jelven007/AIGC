# 当前版本与运行状态

核验日期：2026-10-31。当前版本`v1.0.1`，运行源码`d7766b4`。源码整理、测试、合并、发布与环境升级回执以[生产基线](releases/PRODUCTION_BASELINE.md)为准。

| 项目 | 已核对事实 |
| --- | --- |
| 应用仓库 | `shoproai`为独立Git仓库，GitHub`jelven007/AIGC`、`master`；生产标签固定`d7766b493a62978da4c15e705b9027ecb4c42f76`，后续主线文档提交只追加验收回执 |
| 当前运行 | ECS示例地址`https://ecs.example.com`、`shopro-ecs`、26健康容器/16媒体执行器；本地自托管11健康服务；两环境同一v1.0.1前端/Edge、架构分别为AMD64/ARM |
| 开发入口 | 5173经仅本机54329网关连接ECS，严格校验上游TLS；真实登录与20项响应式页面检查通过 |
| 源码覆盖 | 48路由页面/13领域、68迁移文件/66生产迁移、43生产Edge入口、20模型槽、MCP59工具/19权限 |
| 运行契约 | required_migration=00068、probe24、render4、edit2，共用runtime-contract.json |
| 界面与功能 | 紧凑左导航、私有管理员初始化、服务端用户名登录、公开配置脱敏；分镜、媒体库、积分动作、运营查询/会话隔离、鲜明浅/深主题 |
| 目录与文档 | 旧后台/API/实验和重复技能工具退出当前源码；Git祖先保留，运行数据/产物/备份独立生命周期；七类权威文档来源见[lifecycle.json](lifecycle.json) |
| 容量证据 | 100真实账号五分钟29044业务请求/0错/P95 17.52ms，100份10秒720p成片74.768秒排空；MCP/100条Realtime及原实例恢复见[容量验收](testing/SELF_HOSTED_CAPACITY_100_20261031.md) |
| 恢复证据 | 本次两环境5份加密冷快照完成；升级与清理后原UUID/余额/私有成片SHA256/密钥/容量均一致，历史新卷恢复见[自托管验收](testing/SELF_HOSTED_ACCEPTANCE_20261031.md) |
| 原官方环境 | 独立保留，最近00031/三旧函数，管理401；不以ECS验收代表该目标升级 |

任务保持原账号、UUID、价格/配置、账务/租约/未知请求证据。本地状态和备份独立于源码；ECS原数据卷与容量profile保持。本次仅保留当前发布，旧发布和历史代码在新发布验收后清理，数据与加密快照独立保留。当前源码、文档和交付不包含部署凭据；完整Git祖先与作者元数据尚未重写，不能称为已脱敏。

未接入的真实模型、支付、短信、邮件和外部平台权限需要经营配置与独立接受。公网IP为自签证书，正式域名证书、外部值班通知和异地备份调度继续列为接入条件。当前单机没有多机高可用或实测SLA承诺。

阅读顺序：[需求](prd/PRD.md)→[技术架构](architecture/TECHNICAL_ARCHITECTURE.md)→[开发](development/DEVELOPMENT_GUIDE.md)→[测试](testing/TEST_PLAN.md)→[运营](operations/OPERATIONS_GUIDE.md)→[运维](deployment/SELF_HOSTED_ECS_RUNBOOK.md)→[版本与保留](releases/VERSION_MANAGEMENT.md)。
