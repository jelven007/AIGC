# 团队、素材和开放接口生产化

日期：2026-10-21。本轮源码与本地验证记录；未执行云端部署。迁移 `00037_access_control.sql` 必须在 `00032–00036` 之后应用，并与所有相关前端、业务函数和生产 Worker 一起发布。

## 实际交付

- 开放 Key 由 `api-keys` 服务端签发，32 字节随机值，只存 SHA-256 摘要，只显示一次；设置权限与 1–365 天有效期。撤销成功才更新页面。旧密钥因来源和权限未受控，迁移统一停用，需重新签发。
- `video-jobs`、`production-jobs`、`platform-publish`、`text-generation` 同时支持有效用户 JWT 和按 Action 授权的 Key。数据库原子消费限额，每 Key 每分钟最多 100 次，记录鉴权通过次数，不等同供应商成功次数。账号封禁、过期、撤销、缺权限均拒绝。
- 团队创建与 owner 成员记录同事务；邀请接受核对已验证邮箱、期限、消费状态、成员容量及现有团队身份。并发创建不会留下孤立团队；旧允许自行加入任意团队的直写权限撤销。成员管理仅所有者执行。
- 团队页可明确共享个人素材、读取团队共享列表、撤销共享。Storage 和 Worker 使用同一访问规则，观察者仅能读取，管理员/编辑者可共享自己的素材。任务仍属于提交者，积分由提交者承担；团队共同预算和共同工程编辑仍在待办。
- 删除素材由服务端解析真实对象路径，签名 token 不进入删除请求，路径正确解码。业务记录删除与对象清理 outbox 同事务，存储故障后可重试；仍被作品/时间轴/商品/形象/任务使用时阻止删除。生产调度顺带执行清理。
- 私有形象新增 `user_id` 与 RLS，上传写入所有者；列表移除内置虚构使用量和客户端形象记录，删除/封面更新以数据库结果为准。这是形象库修复，独立口型、声纹克隆与数字人合成仍需后续实现。

## 接口和权限

| 接口 | Action | 身份 / 权限 |
| --- | --- | --- |
| api-keys | list/create/revoke | 仅用户 JWT；管理 Key 不接受另一 Key |
| team-space | get/create/invite/accept/remove/role | 仅 JWT；管理成员仅 owner；接受必须验证邮箱 |
| material-assets | shared/share/unshare/delete | 仅 JWT；共享自身素材；撤销仅素材 owner |
| video-jobs | create；list/query | video:create；video:read |
| production-jobs | image/render create；list/query | image:create / render:create；jobs:read |
| text-generation | messages / SSE 或 JSON | script:generate |
| platform-publish | create；list/query；metrics | publish:create；publish:read；metrics:read |

旧 `phase3-assistant` 的团队/Key Actions 返回 410，防止旧入口绕过签发版本、邮箱校验和团队事务。发布取消、同步指标、平台账号授权和管理配置继续仅接受 JWT，未开放对应 Key 权限。

共享撤销/移除成员后不能获取新的签名。已经发出的签名可用到过期：通常 15 分钟，正在运行的渲染素材签名最长 1 小时；不能承诺已发出的链接即时失效。对象清理不是业务可恢复回收站；删除请求被引用检查拒绝时不会清除记录或创建清理项。

## 验证证据

- `python3 tests/test_access_control.py`：5 项真实 PostgreSQL 测试，通过。覆盖 Key 摘要列权限、撤销/到期、并发限流、团队事务/重复邀请/容量、越权加入、Storage 共享撤销、私有形象及清理领取恢复。
- `node tests/access_control.test.mjs`：3 组真实服务端模块回归，通过。上游 SDK/Storage 使用夹具，验证 Key 路由权限、创建/撤销失败、路径解析和清理重试。
- `node tests/browser_access_control.mjs`：2 组真实浏览器页面 + 本地 API 夹具，通过。覆盖读失败/重试/空态、失败不伪造 Key、撤销冲突、团队邀请与共享、390px 无横向溢出、无页面运行错误、无旧表直接写入。
- 既有 33 项资金/任务 PostgreSQL 回归、6 组生产 API 回归通过。类型、Deno 关键入口检查及 lint/build 见本轮验证日志；不将夹具测试当作托管 Auth、平台或供应商验收。

## 发布与运维

1. 先应用数据库增量，再发布 `api-keys`、`team-space`、`material-assets` 与新的共享 auth/private-media 模块。
2. 四个 Key 业务入口设置 `verify_jwt=false`，函数内继续验证 JWT/Key；否则托管网关会先拒绝非 JWT 的 Key。两份发布配置已同步，不适用于管理接口。
3. 更新 `production-worker` 并保持 production 调度运行；仅旧 video Cron 不会执行对象清理。
4. 最后发布前端；旧本地团队/Key 缓存不再读取。通知使用旧 Key 的客户端重新签发并按真实端点迁移。
5. 云端以两账号验证团队加入/拒绝、共享/撤销、对象实际删除重试，以及 Key 创建/撤销/限流。记录任务标识和脱敏回执；不在报告中记录原密钥。

## 当前总任务的后续范围

用户要求补齐全系统生产能力，本轮只完成访问基础。批量父子任务与预算、Sora/导出规格、数字人/音频任务、真实视频分析/情报、Embedding/RAG、多账号多平台、广告归因与实验、现金退款事务、运营后台、观测/备份/真实环境部署验收均继续推进。完整历史缺口见 `FUNCTION_COVERAGE_REVIEW_20261021.md`，本轮变化优先采用本文的交付事实。
