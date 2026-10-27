# 告警投递与离线故障记录

更新：2026-10-27，`00068 / probe24 / render4 / edit2`。本地真实HTTP演练已通过；正式渠道、值班责任和目标送达尚未验收。

`00067`增加`operations_alert_deliveries`，按原`(event_id,channel)`唯一。每次领取补齐所有未登记的事件，不以时间游标假设提交顺序；同渠道只有一个90秒租约，领取递增尝试数。失联、超时、错ID或非确认响应保留原事件，30秒开始指数退避、最多1小时；旧租约无法结案新租约。保存回执只有`accepted:true`和原`event_id`。

`production-worker`新增`alert_claim`与`alert_finish`，只接受通用Worker专用密钥。媒体密钥不能读取或结案告警，也不因此领取生产任务。事件载荷保留告警UUID、事件版本、规则、时间、原对象UUID、标题与严重性；用户原文、接手备注、用户ID和凭据不发送。

独立`alert_delivery.py`先处理调度持久卷，再从Worker领取事件。即使Worker/数据库不可达，离线故障及恢复事件仍可投递。文件锁、原子替换和fsync保护调度/发送并发；未确认事件完整保留，只有已确认历史保留最近100条，序号不会因裁剪重置。修改目标应使用对应环境独立卷，目标不匹配时拒绝复用，不清空旧待送事件。

## Relay协议

配置固定HTTPS地址和独立Token，禁止跳转。发送`POST`，`Authorization: Bearer <relay token>`，`Idempotency-Key`为原事件UUID，JSON载荷包含`event_id`。Relay必须先持久化并按该UUID去重，再返回HTTP 2xx及：

```json
{"accepted": true, "event_id": "原事件UUID"}
```

这是至少一次投递。HTTP成功但响应不明会重试同一事件；Relay必须实现持久去重，不能据此重复通知。已确认回执与事件关联，故障、恢复和接手是不同原事件。连接端`isolated:true`仅供本地localhost/127.0.0.1 HTTP演练。

复制[配置模板](../deploy/video-scheduler/alert-delivery.example.json)为`deploy/video-scheduler/alert-delivery.json`，设0600；`relay_secret`设0600。文件映射为Compose secrets，发送容器与调度共用命名持久卷：

```sh
PRODUCTION_WORKER_ENABLED=true docker compose --profile production --profile alerts \
  -f deploy/video-scheduler/compose.yaml --env-file deploy/video-scheduler/.env up -d
```

正式启用前应先完成[发布验收](RELEASE_ACCEPTANCE.md)，用受控演练事件核对Relay回执和最终值班送达。容器限制128MiB/0.25CPU/64PID、非root/只读/去cap；错误写结构化计数，容器运行不代表渠道已送达。数据库故障期间的离线待送卷也纳入宿主备份和磁盘观测。

测试入口：`pnpm test:alert-delivery`。真实PG覆盖并发、原UUID、晚提交与退避/旧租约；真实本地HTTP覆盖错ID、302、原幂等键、凭据权限、离线重启、已确认留存及超过100条未确认事件。未发送正式外部消息。
