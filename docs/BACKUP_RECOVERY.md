# 备份与隔离恢复操作

更新：2026-10-27，当前`00068/probe24/render4/edit2`。最终锁依赖备份镜像、加密归档上传/拉回及双PG16隔离恢复已在本地通过；目标备份调度/独立故障域、托管系统迁移及生产容量仍须独立验收。

本地流程已在双PG16和HTTP对象服务执行，详见 [迭代29](ITERATION_29_ALERTS_RECOVERY.md)。目标平台尚未执行备份调度或恢复验收，不承诺生产RPO/RTO。

1. 核对实际平台、数据库直连、PG主版本、Storage URL、迁移回执和凭据负责人。使用PG16镜像只处理支持的源/目标版本；官方托管平台Auth/Storage系统迁移另走官方流程。
2. 将 [配置模板](../deploy/backup/config.example.json)复制为deploy/backup/config.json并设0600，secrets目录0700、每个文件0600。备份加密密钥为独立32字节hex；使用单主密钥时保留model_master_key并移除尚不存在的model_keyring项，使用版本目录时备份完整model_keyring。轮换与只读历史预检见 [密钥轮换](KEY_ROTATION.md)。将商户证书/私钥、签名Key、历史主密钥等所有运行必需材料按secrets名称加入，归档不替代凭据系统。
3. 停止对象上传/覆盖/删除和清理派发，等在途请求结束。数据库使用导出快照，Storage必须保证备份窗口内对象不变；变化或大小不符整份拒绝。unknown与原现金交易证据完整保留。
4. 执行backup和verify，结果保管到独立受控存储；备份密钥另存，不与归档一起上传。定期调度由目标运维系统执行此命令，只有退出码0/verify通过才算成功，失败纳入值班流程。
5. 恢复必须准备新空隔离PG及隔离Storage，isolated=true并核对域名，源生产配置不能用于restore。认证材料后恢复扩展/DB/Storage，核对回执/内容/历史解密；FAILED存在时保持环境隔离，另建空目标排查，不直接重放到部分恢复库。
6. 记录receipt、恢复时间、数据量、对象数和版本，核对恢复点之后的商户与供应商受理。unknown/submitting不能退回queued重发。真实Auth会话、平台schema、角色和Storage权限按平台迁移材料验收，再配置匹配函数及唯一调度器。

当前归档还须覆盖：00055原阶段UUID/依赖/预算流水、00056/57团队归因/工单内部消息/租户版本/风险/供应商现金账本、00058原对象告警/接手事件、00059头像引用、00060邀请版本/验证唯一奖励/活动回执、00061权益/周期、00062图片原价/版本/私有原图掩码及checkpoint。原收银/微信商户期限/退款申请、对象引用/墓碑/声纹历史版本不能漏备。

恢复验收按 [测试计划](TEST_PLAN.md) AT-20/28核对这些数据与Storage实物，先保持隔离和停派发，再对渠道/供应商恢复点后的真实交易。两个Git历史标签只用于源码恢复，不能代替数据库/实物/历史密钥，见 [版本管理](VERSION_MANAGEMENT.md)。

构建与执行示例：

```sh
docker build -t shoproai-backup:local -f deploy/backup/Dockerfile .
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v "$PWD/deploy/backup:/run/backup:ro" -v "$PWD/backups:/backups" \
  shoproai-backup:local backup --config /run/backup/config.json --output /backups/发布前归档
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v "$PWD/deploy/backup:/run/backup:ro" -v "$PWD/backups:/backups:ro" \
  shoproai-backup:local verify --config /run/backup/config.json --artifact /backups/发布前归档
```

容器以65534运行，backups目录须事先授予该运行身份写权限。模板路径/run/secrets应映射至实际只读凭据文件，示例目录映射本身不会创建密钥。verify会临时解密数据库/对象，请配置足够的受控临时盘，16MB仅是小样本示例，正式容量按备份大小设置。

隔离恢复使用独立target配置与可写restore-results：

```sh
docker run --rm --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -v "$PWD/deploy/backup:/run/backup:ro" -v "$PWD/backups:/backups:ro" \
  -v "$PWD/restore-results:/restore-results" \
  shoproai-backup:local restore --config /run/backup/target.json \
  --artifact /backups/发布前归档 --output /restore-results/本次演练
```

测试入口：`pnpm test:keyring`（先构建备份镜像）。双PG16演练覆盖原两段/新版本密文、完整目录、历史模型版本、停用平台与OAuth快照及Measurement凭据；恢复回执包含各表和各key_id验证数量。原格式归档继续读取，按归档自身记录的计数/摘要核对。测试临时密钥与对象只存在隔离容器或Git忽略目录，演练结束删除容器、网络和临时材料。

## 加密归档上传与拉回

配置`archive.url`为独立故障域HTTPS网关，`archive.secret_file`为0600文件。`backup_archive.py upload`先认证全部密文，只把`.enc`文件打成确定性tar；路径固定为`backups/<原备份ID>/<sha256>.tar`，幂等键为`<原ID>:<sha256>`。网关接收流式PUT并持久保存对象后，须返回HTTP 200/201和`{"accepted":true,"backup_id":"原ID","sha256":"实物摘要","size":实物字节数}`。未知或错回执不能记录上传成功，重试保持同一对象键。

```sh
docker run --rm --entrypoint python \
  -v "$PWD/deploy/backup:/run/backup:ro" -v "$PWD/backups:/backups" \
  shoproai-backup:local /app/scripts/backup_archive.py upload \
  --config /run/backup/config.json --artifact /backups/发布前归档 \
  --receipt /backups/归档回执.json
docker run --rm --entrypoint python \
  -v "$PWD/deploy/backup:/run/backup:ro" -v "$PWD/backups:/backups" \
  shoproai-backup:local /app/scripts/backup_archive.py pull \
  --config /run/backup/config.json --receipt /backups/归档回执.json --output /backups/异地拉回
```

路径和运行身份要求同上，须配置足够的受控暂存盘。传输禁止重定向；拉回核对原大小/摘要、拒绝路径穿越/链接/重复项，重新认证全部加密文件和原备份ID，成功后才生成新归档目录。随后用独立空目标执行`restore --artifact /backups/异地拉回`。解密密钥独立保管，不包含在发送的tar中；加密后的历史业务密钥随归档保留。

新增00063/64原请求与尝试、00065公平/维护预算、00066预存范数及00067告警投递回执都随数据库dump恢复；关键计数/行摘要额外覆盖原告警事件和投递表。最新双PG测试通过本地真实网关上传/拉回后恢复原UNKNOWN、预占、扣费ID、3历史模型版本、8条跨用途凭据及原告警/确认回执；另测错ID、篡改和恶意tar。入口`pnpm test:backup`。这证明工具闭环，不证明正式网关、独立故障域或生产RPO/RTO；目标定时调度、保留策略、值班失败通知和恢复窗口按真实数据量验收。
