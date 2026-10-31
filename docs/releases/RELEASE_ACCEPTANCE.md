# 匹配版本与目标环境接受

更新：2026-10-27。当前68个迁移文件、排除两份演示后66个生产迁移，`00068 / probe24 / render4 / edit2`。当前代码已在本地旧库升级和HTTP平台替身通过；正式目标接受需要该目标的独立回执。

## 发布顺序与核对

1. 核对目标平台、备份、迁移账和Auth/Storage权限。官方Supabase、火山BaaS及自托管使用独立迁移流程；已初始化但无部署摘要账的库禁止用火山工具盲重放。历史迁移只追加，原UUID、不可变配置、UNKNOWN及原扣费流水保留。
2. 使用冻结依赖与[全栈回执](REPRODUCIBLE_RELEASE.md)执行`prepare`。完整构建把`release-identity.json`放入前端归档，绑定Git SHA、实际源码摘要及Worker契约；`--skip-build`只生成源码/迁移材料，不能用于前端发布接受。
3. 应用匹配迁移、43个生产Edge入口及共享锁，把回执中的`release.source_sha256`注入Edge的`RELEASE_SOURCE_SHA256`；匹配部署操作和产物摘要要共同核对，该环境字段本身不能证明运行源码。部署对应前端归档及Worker/MCP/调度镜像，再执行只读接受。
4. 通过后启动唯一生产和维护调度，核对实际容器摘要、运行限制、Auth会话与跨账号RLS、Realtime、私有上传/读取/清理及原任务重启恢复。正式外部业务逐项获得原回执，不以能力探针代替。

## 只读接受工具

[accept_release.py](../../scripts/accept_release.py)读取0600配置与本次prepare清单，检查迁移版本/原SHA-256、PG能力、Edge源码声明与完整协议、Auth设置、指定私有Storage桶和前端发布身份。数据库使用只读可重复读事务；HTTP只执行设置/桶查询和`probe`，不创建用户、对象、任务或交易。HTTPS及禁止跳转保护专用凭据。

复制[配置模板](../../deploy/backup/acceptance.example.json)为`acceptance.json`，映射真实的只读密钥文件，运行备份/验收镜像：

```sh
docker run --rm --read-only --cap-drop ALL \
  -v "$PWD/deploy/backup:/run/config:ro" -v "$PWD/.volcengine-build:/release:ro" \
  -v "$PWD/restore-results:/receipts" \
  --entrypoint python shoproai-backup:local /app/scripts/accept_release.py \
  --config /run/config/acceptance.json --release /release/manifest.json \
  --output /receipts/目标名称-本次接受.json
```

模板中的`/run/secrets`须独立映射，结果目录须预先授予65534写权限。输出0600，`technical_ready`仅说明这些只读检查通过，`production_accepted`始终为false。运行镜像、身份会话/RLS/Realtime、真实平台/模型/商户、容量和目标异地恢复需另附证据。`isolated_fixture`回执只能作为本地测试。

本地`pnpm test:acceptance`实际执行原生产迁移SQL：先部署到00065、创建原受理未知任务与扣费，再通过发布事务追加00066–00068，核对原UUID/配置/一次扣费及完整迁移摘要。真实HTTP替身和CLI核对六项只读接受，并拒绝错源码、公开桶和漂移迁移。`test_final_contract.py`验证新字段/RPC缺失不能被旧probe误报就绪。

## ECS对等运行选择

默认ECS承载生产/维护调度、FFmpeg和MCP，前端静态托管，Auth/PostgreSQL/Storage/Edge/Realtime仍使用已经接受的托管服务。媒体可以独立迁移主机，仍使用原租约和私有对象契约；[资源边界](../operations/MEDIA_WORKER_RESOURCES.md)、[网络与密钥](../operations/KEY_ROTATION.md)、[告警](../operations/ALERT_DELIVERY.md)及[异地恢复](../operations/BACKUP_RECOVERY.md)提供操作入口。

完整ECS自托管需要同时维护下面的对等组件，不能用单个PostgreSQL代替：

| 组件 | 迁移/核对内容 | 接受证据 |
| --- | --- | --- |
| Auth与网关 | 用户UUID、可信claims、验证/恢复、签名轮换、重定向、API路由 | 本人登录/过期/恢复及跨账号拒绝 |
| PostgreSQL/PostgREST | 支持的PG/扩展、追加迁移、权限/RLS/RPC、预算与持久租约 | 完整摘要账、原UUID/UNKNOWN/原流水、并发权限 |
| Storage | 私有桶、元数据/实物映射、owner、签名路径、引用/墓碑 | 原对象摘要、授权隔离、清理与恢复 |
| Edge Runtime | SDK冻结图、全部入口/共享模块、模型目录和历史密钥 | 匹配协议/源码产物、真实原回执 |
| Realtime与静态前端 | 账号订阅、重连/权威查询、发布身份/公开配置 | 切账号、关页/重启、订阅权限、前端摘要 |
| 执行与运维 | 唯一调度、媒体/MCP资源、HTTPS出口、外部告警、异地恢复 | 最终运行digest、真实队列/磁盘/RSS与恢复回执 |

目标按实测负载配置CPU/内存/磁盘，媒体本地短样本不作为整机容量承诺。单机中的备份盘仍与服务同属故障域，归档必须送到独立存储并拉回空环境恢复。切换域名和入口前暂停派发，核对旧租约和在途受理，保留回滚配置与隔离备份；目标未完成以上接受时继续使用原已核验基础服务。
