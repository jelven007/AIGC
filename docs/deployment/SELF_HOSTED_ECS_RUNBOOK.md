# 自托管升级与恢复手册

类型：how-to，operational。读者：运维与发布维护者。责任：运维维护者。核验：2026-11-01。来源：scripts/self_hosted.py、scripts/self_hosted_snapshot.py、infra/self-hosted/compose.yaml、infra/self-hosted/capacity-100.json和真实状态回执。每次部署/故障/依赖变更或30天复核；挂载、协议、恢复步骤或容量漂移即过期。

## 状态与前提

本地state位于工作区源码外 .local/shopro-production/state，ECS为 /opt/shopro/state。保持原Compose项目与命名卷。本地11服务/linux/arm64，ECS26容器含16渲染器/linux/amd64。实际SOURCE_DIR由受控runtime.env读取，current仅在接受后切换；不硬编码旧版本路径。

安装Docker Engine/Compose v2和Python3；固定源码、锁、公开载荷与架构镜像必须核验。小实例不能套用100人profile。生产入口仅HTTPS/SSH，数据库和执行器不公开。IP当前用自签CA，正式域名/证书需维护者配置。

## 升级

先使用当前已接受发布目录中的快照脚本；完成备份后，在封存并验证的新交付根执行升级。兼容修复版按目标 SOURCE_DIR 解析新旧 Compose 布局；修复前脚本固定绑定自身目录，不可混用跨布局版本。参数仅示例，快照目录必须新建；密钥为源码外0600普通文件：

```sh
python3 /opt/shopro/releases/current/scripts/self_hosted_snapshot.py backup   --state-dir /opt/shopro/state --key-file /opt/shopro/private/snapshot.key   --output /opt/shopro/backups/before-v1.2.1-publication
python3 scripts/self_hosted.py upgrade   --release "$PWD" --state-dir /opt/shopro/state
python3 scripts/self_hosted.py check --state-dir /opt/shopro/state
python3 scripts/self_hosted.py status --state-dir /opt/shopro/state
```

升级验证完整文件清单、镜像ID/架构及实际服务源码；保留原前端/Edge和runtime.env回退副本，更新SOURCE_DIR与镜像，保持身份/容量/数据卷。bootstrap只核对已应用迁移摘要并追加缺失项，不重置管理员、账务或旧任务。v1.2.1新增00069自建模型配置，生产迁移为67条；已部署00069的实例仅核对摘要，执行任务协议保持00068/probe24/render4/edit2。

先本地接受再线上晋级同一前端/Edge。各环境比较升级前后原UUID、权威余额、原完成任务/私有视频SHA256、JWT与历史密钥摘要、容量和全部健康容器；读取HTTPS release-identity.json并与冻结文件逐项比较。真实登录验证桌面/手机关键页面和操作区。ECS保持DB240、Auth20、REST48、Edge8CPU/16GiB、16渲染器。

所有接受通过后原子更新releases/current，再核对活动/停止容器挂载与镜像依赖，保留当前加最多两份历史交付。更早代码/重复包/失败候选可清理；业务卷、私有配置、历史密钥与认证加密快照独立保管。

v1.2.1正式发布从固定提交使用新空目录构建前端/43Edge并封存完整清单，两架构核对原生镜像实际源码。SOURCE_DIR和current必须指向同一已接受交付；Git SHA、source_sha256及页面实际响应分别核对。新版本接受后保留v1.2.0及最新已接受v1.1.0兼容交付两个历史，移除同版本未提交候选、旧buttons目录和重复临时包；操作顺序见[发布方案](../plan/RELEASE_V1_2_1.md)。

## 回退与恢复

代码失败先停止新执行进程，核对旧代码/镜像与当前迁移兼容性，再恢复受控runtime.env和前端/Edge副本，以旧SOURCE_DIR执行up并复核原数据。旧路径已清理时不能使用过时回执直接回退，应采用经验证的兼容修复版本。

业务数据损坏仅恢复到新目录、新项目和不存在的数据卷。同一数据库版本/架构、原规范HTTPS地址、有效证书和完整历史密钥必须保持。先认证所有加密文件和摘要：

```sh
python3 scripts/self_hosted_snapshot.py restore   --state-dir /opt/shopro/state --key-file /opt/shopro/private/snapshot.key   --artifact /opt/shopro/backups/before-v1.1.0   --output /opt/shopro/restored-v1.1.0 --project shopro-restored-v110   --origin https://ecs.example.com --bind 0.0.0.0 --subnet 172.31.241.0/24   --tls-cert /opt/shopro/tls/fullchain.pem --tls-key /opt/shopro/tls/privkey.pem
```

示例网段仍需实测不重叠。规范IP无法同机同时指向两实例，须安排入口切换；异机域名恢复通过DNS保持原地址。容量恢复使用scripts/self_hosted_capacity_recovery.py，异常时停辅助实例并恢复原服务。禁止down -v或覆盖原卷。

恢复器同时还原`initial-admin.json`、`login-identity.json`和存在的媒体验收夹具，保留初始化文件字节及0600权限，并在Linux上设置bootstrap身份属主。缺少用户名映射时，仅由快照中的初始化身份生成映射；映射与初始化身份不一致、身份文件无效或权限错误会在创建新目标/数据卷前拒绝。恢复不会重新创建账号或重置密码、角色及积分。

旧快照没有私有初始化文件时，须显式补充源码外普通0600文件：

```sh
python3 scripts/self_hosted_snapshot.py restore \
  --state-dir /opt/shopro/state --key-file /opt/shopro/private/snapshot.key \
  --artifact /opt/shopro/backups/legacy-snapshot \
  --output /opt/shopro/restored-legacy --project shopro-restored-legacy \
  --origin https://ecs.example.com --subnet 172.31.241.0/24 \
  --initial-admin-file /opt/shopro/private/legacy-initial-admin.json \
  --tls-cert /opt/shopro/tls/fullchain.pem --tls-key /opt/shopro/tls/privkey.pem
```

补充文件只用于缺失的旧快照身份材料，不能覆盖快照已有身份。应核对它对应原数据库账号；旧快照恢复到新项目后仍须运行`up/check`、真实用户名与邮箱登录、原UUID/余额/私有实物及历史密钥检查。`snapshot-restore.json`中的`application_start_checked=false`表示仅完成认证导入和状态恢复，不能作为完整应用已可用的结论。

准备恢复验收材料时，成片须属于原账号、仍有作品等业务引用、结果包含有效媒体地址，并可从Storage下载；在备份前记录任务UUID、结果和实物SHA256。不能仅选择最早的completed任务：既有生命周期会清理超过24小时且没有引用的素材，并保留`media_deleted`终态回执。已删除回执按原值比较，下载与哈希接受使用快照中仍存在的原成片，不重建或复活已删除素材。

Compose操作按目标`runtime.env`的`SOURCE_DIR`选择唯一存在的`infra/self-hosted`或历史`deploy/self-hosted`布局；没有兼容布局时，在调用Docker前拒绝。冷备份还在停机前运行Compose配置校验，避免新脚本为旧目录建立错误挂载。

## 构建与离线交付

```sh
docker build -f infra/video-scheduler/Dockerfile -t aigc-video-scheduler:local .
docker build -f services/media-worker/Dockerfile -t aigc-render-worker:local .
docker build -f services/mcp/Dockerfile.mcp -t aigc-mcp:local services/mcp
docker build -f infra/backup/Dockerfile -t aigc-backup:local .
```

Python依赖按--require-hashes及pip check，人物模型/许可证/NOTICE按固定摘要随services/media-worker/model-assets交付。ECS可用scripts/build_self_hosted_ecs.py原生构建。源码/前端/Edge附件不包含镜像二进制，不可直接交install；首次完全离线安装必须生成self_hosted_release.py create的对应架构完整包，核对全部摘要后install。

## 日常运行与配置

```sh
python3 scripts/self_hosted.py status --state-dir /opt/shopro/state
python3 scripts/self_hosted.py check --state-dir /opt/shopro/state
python3 scripts/self_hosted.py up --state-dir /opt/shopro/state
docker compose --env-file /opt/shopro/state/runtime.env   -f "$SOURCE_DIR/infra/self-hosted/compose.yaml" --profile execution stop
```

check核对67迁移摘要、Auth/权限/权益、43入口、probe24/render4/edit2、RLS与真实Storage往返。业务写入测试仅限新隔离实例显式SELF_HOSTED_ISOLATED_ACCEPTANCE=true。全停机必须包含execution profile；快照工具会停全部常驻组件并恢复。

初始化文件仅源码外普通0600，字段username/password/email，Linux副本归属固定bootstrap身份65534。重复初始化不重置密码/角色/禁用/赠分。明确更新邮箱才用--sync-initial-email；保留原UUID与资产。配置原子更新后重建functions刷新挂载，尤其Docker Desktop。

原ECS EIP回环DNAT、精确TLS/出口白名单、Docker动态地址池、Storage流式HTTP/1.1、PostgREST线程/PID预算和Auth空闲池20均需保持。证书续期后受控更新TLS材料并重新初始化专用资源卷、重建依赖CA的组件；不能只改公开URL。

当前上线结果由[生产基线](../releases/PRODUCTION_BASELINE.md)、[兼容恢复回执](../releases/COMPAT_RECOVERY_20261101.md)和[当前状态](../CURRENT_STATE.md)记录。历史100人压测/新卷恢复保留原时点；本轮不宣称重新完成SLA、RPO/RTO或经营接入。专项：[运行](../operations/RUNBOOK.md)、[告警](../operations/ALERT_DELIVERY.md)、[备份](../operations/BACKUP_RECOVERY.md)、[版本](../releases/VERSION_MANAGEMENT.md)。
