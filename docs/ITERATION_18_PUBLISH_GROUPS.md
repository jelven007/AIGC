# 迭代18：多平台、多账号发布组

2026-10-22。本地新增00045、发布组API、网页和两个MCP工具。复用原production_jobs与两平台Worker；未新增另一套上传/发布队列。需要目标部署与真实抖音/TikTok应用验收，不能据此宣称全系统已生产上线。

## 需求与实际行为

REQ-PUBLISH-02：用户预览已完成成片，一次选择1–10个自有授权账号；各账号独立选择可见范围、互动/商业/AIGC选项并明确确认。共同标题、简介、标签、时间或账号集合改变时，旧确认失效。账号权限来自正式creator接口；不提供自动勾选发布确认。

同组内容/源地址/真实时长/定时发布绑定原UUID。全组数据库事务创建，任一账号失效、来源变化或容量不足，任务、组和审计一起回滚。保存成功后各账号独立领取/上传/审核/结案，单项取消不影响其他项。整组创建成功不等于所有平台发布成功。

REQ-PUBLISH-03：发起前持久化请求回执。断线/503/鉴权失败/幂等冲突保留原参数，刷新查询或按原UUID重试。仅参数拒绝或数据库确定回滚后解锁编辑。升级前单账号回执保持create旧action与原UUID，不转换为新组。

## API与数据契约

platform-publish POST新增create_group、query_group。前者需要publish:create，后者publish:read；现有16权限目录不增加宽泛授权。账号OAuth/撤销/应用密钥仍只允许用户JWT。

create_group参数：

```json
{
  "action": "create_group",
  "request_key": "用户生成并保存的UUID",
  "project_id": "已完成作品UUID",
  "source_url": "预览成片的稳定私有对象地址",
  "duration": 30,
  "title": "确认的标题",
  "description": "",
  "tags": [],
  "scheduled_at": null,
  "targets": [{
    "connection_id": "自有授权账号UUID",
    "options": {
      "privacy_level": "SELF_ONLY",
      "consent": true,
      "disable_comment": true,
      "disable_duet": true,
      "disable_stitch": true,
      "brand_content_toggle": false,
      "brand_organic_toggle": false,
      "is_aigc": true
    }
  }]
}
```

源URL与duration必须匹配当前作品；浏览器使用canonicalMedia去掉短效签名，数据库事务再验证读取后未被替换。账号顺序不影响请求身份，所有其他参数必须一致。标题≤150字符、简介≤1000、标签≤10个且每个≤30字符，时间为未来30天内。各账号共享24个pending/running/unknown名额，unknown仍占用；发布当前应用价格为0，不等于上游服务无成本。

create_group返回202 `{group:{id,request_key,request,created_at,tasks}}`；query_group按原request_key返回同结构或group:null。list兼容原tasks并新增最近20组完整tasks，单项最近100条。公开任务字段去掉source_url/publish_options等内部引用；组的request仍是用户自己确认的参数。单项cancel只允许未提交上游阶段。

请求流最多32KB；新组每用户每分钟最多12次，限流故障拒绝调用平台。已经保存的原组恢复不消耗新组限额，避免网络故障后被创建限流阻断核对。

数据库publish_groups仅service_role可读写；两个创建RPC也只授予service_role，用户身份必须经业务API验证。锁顺序为用户套餐→作品→账号/任务；单账号与组共用配额。组创建写一次审计，每账号独立随机子请求UUID与原Worker证据。不增加“失败自动重发整组”。

错误400表示参数校验拒绝；409/publish_group_rejected表示数据库确定拒绝且没有新建组；409/publish_group_conflict保持回执；数据库超时、网络或结果查询失败503必须查询原请求。不能把未知结果当作未受理。

## 验证与发布要求

AT-PUBLISH-02–06：真实PG五项通过（15.493s），覆盖中途失败整组回滚、五并发同UUID、账号排序/撤销后恢复、用户/源/时间/确认边界、单账号与组共享24容量、unknown占用及独立取消/失败。四组实际Edge模块通过，验证权限/源预览、原组重放不再调用平台、跨用户、安全字段和确定回滚/未知区别。

实际网页四组通过：逐账号确认、共用内容修改后撤销确认、平台禁用互动、503后锁原参数/刷新/同UUID重试、分项取消、390px无横向溢出、旧单账号回执协议兼容。SDK12项通过（0.436s），47工具目录已重新导出；22种业务操作的缺权限拒绝通过。类型与两入口Deno检查通过。此处使用隔离数据库和API夹具，没有对真实账号执行发布。

先发布缺失00032–00045，再更新platform-publish/production-worker及共享模块、重建47工具MCP镜像，最后更新前端。production probe v7要求publish_groups和publish_tasks.group_id，render_version仍2。部署清单自动包含新迁移。真实验收记录每账号权限、媒体读取、原平台ID、审核终态、撤销/限流、定时执行和指标来源。

后续继续商品导入与图片选品/翻译、剪辑商城/语义抠像/鼓点/自动编排、现金退款与运营后台、媒体留存/声音撤销、预算告警/备份，以及实际云端与供应商验收。
