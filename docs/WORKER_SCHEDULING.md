# 执行、维护与能力探针

运行契约：`00068 / probe24 / render4 / edit2`，调度与维护预算由00065引入。先应用兼容迁移、发布匹配的 Edge 与调度镜像，执行[只读发布验收](RELEASE_ACCEPTANCE.md)，再启动唯一调度部署。

`production-worker` 的 `run` 只处理已经入队的任务。一次只读 `worker_due_lanes()` 返回到期类别，空队列只执行这一条数据库请求，没有模型调用。非空队列通过 `claim_worker_dispatch` 获得持久配额，再调用原任务领取事务。所有租约和计费结果仍由原业务事务维护；UNKNOWN 任务与预占不因调度配额释放而清除。

全局同时执行最多8个请求，普通类别最多6个，每类最多2个。剩余2个只供支付宝退款、微信查单/退款；资金类别权重2，其余权重1。虚拟服务进度和分配计数位于数据库，多个进程共享，不依赖秒数取模。一次运行中空类别只探测一次；未启用供应商返回无任务，不阻断其他类别。额度到期180秒后可以恢复，原令牌不能结案替代额度。

`maintenance` 每次只领取一个到期维护项目：计划入队、7类留存/删除或指标采集。独立全局维护租约、低频间隔、失败退避与最后成功时间保存在 `worker_maintenance_state`，维护错误不阻断 `run`。生产模式应同时运行 `video-scheduler` 和 `maintenance-scheduler`，每个有独立健康文件/持久故障记录。Docker Compose 的 `production` profile 提供维护进程，手动启动：

```sh
PRODUCTION_WORKER_ENABLED=true docker compose --profile production \
  -f deploy/video-scheduler/compose.yaml --env-file deploy/video-scheduler/.env up -d
```

`pnpm scheduler:start` 读取Compose解析后的生产开关，预检通过后在生产模式同时启动两个进程；`scheduler:stop` 同时停止两个进程。旧视频模式保留单进程。两个服务使用同一匹配镜像。

维护调度使用同一专用密钥，不持支付/供应商凭据。日常 `VIDEO_WORKER_CONCURRENCY` 默认4，数据库额度是多个调度误启动时的保护，不表示已测得生产可承受8并发。

| 操作 | 用途 | 数据库请求 |
| --- | --- | --- |
| `alive` | 执行入口可响应，专用身份认证 | 0 |
| `ready` | 数据库和运行配额就绪 | 1 |
| `probe` / `capabilities` | 发布前完整迁移/字段/价格/函数权限/业务语义 | 1 |

完整能力RPC保留原46项读取的校验内容，并增加脚本尝试及调度结构检查；缺失项通过 `missing` 返回。`ready` 不声称所有业务能力可用。调度启动执行完整预检，随后每60秒只做轻量检查；发布工具仍拒绝版本不匹配。FFmpeg保持render4/edit2原工程契约。

最新完整探针同时要求知识预存范数、原告警事件及持久投递字段/RPC。调度、发布工具和镜像共用`scripts/runtime-contract.json`；完整能力响应可携带匹配发布的`RELEASE_SOURCE_SHA256`。外部投递采用独立`alerts` profile，离线故障记录与维护记录分别保留，见[告警投递](ALERT_DELIVERY.md)。

本地验证：`python3 tests/test_worker_fairness.py` 包含真实PG全量兼容迁移、并发额度、资金机会、150次持续分配、过期令牌、能力缺失及未知任务快照；`worker_isolation.test.mjs` 执行真实Edge入口并注入维护失败；`test_video_scheduler.py` 验证独立进程状态。150次分配测试最大类别间隔不超过23次分配，测的是可验证的服务机会。真实供应商服务时间、队列最老等待秒数和生产吞吐应在目标环境观测。
