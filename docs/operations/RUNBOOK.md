# 运维运行手册

类型：how-to，operational。读者：运行、值班与发布维护者。责任：运维维护者。核验：2026-11-01。来源：scripts/self_hosted.py、scripts/runtime-contract.json、infra/self-hosted/compose.yaml和当轮环境接受。每次部署、故障或30天复核；服务、协议、容量或挂载变化未同步即过期。

实际版本从受控SOURCE_DIR和HTTPS公开身份核对，以[当前状态](../CURRENT_STATE.md)和[生产基线](../releases/PRODUCTION_BASELINE.md)为准；协议00068/probe24/render4/edit2、66生产迁移、43Edge、MCP59工具/19权限保持。本地11服务，ECS26容器含16渲染器。v1.2.0接受顺序见[发布方案](../plan/RELEASE_V1_2_0.md)。原官方Supabase独立保留，各环境版本和原业务数据须单独验收。

## 日常检查与身份

本地状态在工作区源码外`.local/shopro-production/state`，ECS为`/opt/shopro/state`；受控runtime.env记录真实SOURCE_DIR、Compose项目和容量。current只指向接受过的交付。私有配置、TLS材料、管理员初始化与凭据普通文件为0600，不从公开Git、截图或日志读取密钥。

源内容清理不重命名现有state、Compose卷、数据库schema或Cron。新运行配置写入 `__AIGC_RUNTIME__`，前端兼容旧配置；不要用清空用户缓存或改UUID恢复请求。发布时另核对邮件发送方、MCP镜像/独立Compose名称、410演示入口及当前模型显式地址，见 [清理记录](../releases/SOURCE_CLEANUP_20261101.md)。

```sh
python3 /opt/shopro/releases/current/scripts/self_hosted.py status --state-dir /opt/shopro/state
python3 /opt/shopro/releases/current/scripts/self_hosted.py check --state-dir /opt/shopro/state
```

status核对运行组件；check核对66迁移摘要、43入口、Auth/RLS/Storage、权益和完整worker契约。检查公开release-identity.json与固定交付一致，再核对本人原任务和资产。技术探针通过不表示真实经营模型、支付或SMS送达已接受。业务写入测试只在新隔离实例显式启用SELF_HOSTED_ISOLATED_ACCEPTANCE=true。

监控数据库连接、Auth/REST池、Edge和渲染器CPU/内存/PID、媒体磁盘、队列等待/租约/UNKNOWN、告警spool与归档结果。ECS保持DB240、Auth20、REST48、Edge8CPU/16GiB及16渲染器；本地使用原小实例配置，不能套用100人profile。历史压测见[容量回执](../testing/SELF_HOSTED_CAPACITY_100_20261031.md)，不能据此新增SLA。

## 异常处置

| 症状 | 核对与处置 |
| --- | --- |
| 登录或权限失败 | 先核对规范HTTPS地址、CA、Auth健康、原UUID与app_metadata权限；不补建同名账号，不重置余额 |
| 新任务不能领取 | 比较数据库/Edge/执行镜像的完整probe、迁移和源码身份，检查租约、公平预算及磁盘；不跳过协议拒绝 |
| 上游受理UNKNOWN | 保留原请求键、供应商账号/版本和请求记录，查询原ID；不自动重发、伪造失败退款或补发收费 |
| 成片或素材不可读 | 以原UUID核对私有对象、引用/MIME/大小和Storage健康；404重新选择原文件，不覆盖原对象 |
| 账务或权益不一致 | 以原不可变流水、预占/结算/逐笔退款和团队预算核对，交运营处置；页面缓存不是资金事实源 |
| 模型保存冲突/失败 | 409读取原服务端版本后重新确认；失败保留页面草稿，不将本地缓存当作服务端成功 |
| 告警/归档未送达 | 核对原事件、spool、独立维护进程与回执，区分本地生成和外部确认；保留重试/去重身份 |
| 发布身份或原数据漂移 | 停止后续晋级/清理；按旧交付兼容性与原数据比较决定回退，数据恢复只能到新卷 |

执行诊断使用受控容器日志和当轮回执，输出不包含JWT、模型密钥、初始化密码或客户素材。操作记录原事件/任务/对象、处置人、时间、范围、版本及复核结果；涉及资金结论由运营维护者按[运营手册](OPERATIONS_GUIDE.md)处理。

## 升级、回退与恢复

升级先调用当前已接受交付的快照脚本，再调用新冻结交付升级入口。目录迁移期间，新检出脚本不能用于重启旧SOURCE_DIR。分别认证加密对象、原身份/余额/任务/私有视频与历史密钥；先本地接受，再ECS晋级同一前端/Edge。具体命令与本次已纠正事件见[升级恢复手册](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)。

代码回退先核对旧镜像与现有数据库/契约兼容，恢复受控运行配置及载荷副本。业务恢复到不存在的新卷、独立项目，维持原UUID、规范地址和完整历史密钥；禁止覆盖原卷或down -v。本次升级前每环境5个加密对象认证通过，完整新卷演练沿用历史时点，见[备份恢复](BACKUP_RECOVERY.md)。

## 专项操作与保留

调度/公平/独立维护见[运行编排](WORKER_SCHEDULING.md)与[任务调度](VIDEO_SCHEDULER.md)；媒体磁盘与容器预算见[媒体资源](MEDIA_WORKER_RESOURCES.md)；主密钥和旧任务见[轮换](KEY_ROTATION.md)；外部接手/去重见[告警投递](ALERT_DELIVERY.md)；异地归档/新卷恢复见备份恢复；数据库检索及预算见[数据库容量](DATABASE_CAPACITY.md)。

每环境保留current及最近最多两个已接受历史交付。清理前核对全部活动/停止容器bind挂载及当前/历史镜像依赖；业务卷、私有配置、素材、历史密钥与加密快照独立保管。不得全局prune、删卷或重写Git历史，见[版本管理](../releases/VERSION_MANAGEMENT.md)。

运行与回退由运维维护者接手；发布维护者提供固定身份和接受回执。当前入口采用自签CA，正式域名证书、经营接入、外部值班与异地备份调度按[待办](../PENDING_CHANGES.md)独立接受。最迟2026-12-01或相关变更时复核本手册。原历史增量保留在[归档](../archive/before-v1.1.0/docs/operations/RUNBOOK.md)，旧probe和旧目标状态不用于当前操作。
