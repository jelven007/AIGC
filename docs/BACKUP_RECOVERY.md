# 备份与隔离恢复操作

更新：2026-10-22，功能基线`d7e3d38`，当前00062/probe22/render4/edit2。源码和恢复材料必须匹配；目标备份调度/异地保管、托管系统迁移及生产容量未验收。

本地流程已在双PG16和HTTP对象服务执行，详见 [迭代29](ITERATION_29_ALERTS_RECOVERY.md)。目标平台尚未执行备份调度或恢复验收，不承诺生产RPO/RTO。

1. 核对实际平台、数据库直连、PG主版本、Storage URL、迁移回执和凭据负责人。使用PG16镜像只处理支持的源/目标版本；官方托管平台Auth/Storage系统迁移另走官方流程。
2. 将 [配置模板](../deploy/backup/config.example.json)复制为deploy/backup/config.json并设0600，secrets目录0700、每个文件0600。备份加密密钥为独立32字节hex；model_master_key为原MODEL_CONFIG_ENCRYPTION_KEY。将商户证书/私钥、签名Key、历史主密钥等所有运行必需材料按secrets名称加入，归档不替代凭据系统。
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

测试入口：`npm run test:backup`（先构建镜像）。测试临时密钥与对象只存在Git忽略的隔离目录，演练结束删除容器、网络和临时材料。
