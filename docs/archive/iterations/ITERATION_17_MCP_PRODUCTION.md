# 迭代17：MCP接入完整业务任务链

本地实现45个真实FastMCP工具，覆盖文本、七协议视频、图片/封面、渲染/多规格导出、五媒体模态、素材分析、商品批次、两平台发布/指标、知识索引/检索/引用及市场情报。修复配音仍调用已410同步接口的问题，创建改为原UUID/确认价格/后台任务，不返回模拟音频或等待上游完成。

## 需求与架构

- REQ-MCP-02：MCP生产工具与网页共用API、配置版本、任务/积分/私有归档；媒体、分析、知识和情报须确认价格，批次须确认预算。
- REQ-OPENAPI-02：16种业务权限统一目录，知识读/写、情报读/写、指标读/同步独立；即使持有全部业务权限仍不能签发Key、OAuth授权/撤销、修改平台应用或操作支付。
- REQ-MCP-03：HTTP每请求ContextVar、无状态SDK、返回后reset；stdio沿用SUPABASE_USER_JWT，可配置用户JWT或业务Key，拒绝明显service_role/anon凭据。
- REQ-MCP-04：八个固定业务函数白名单、HTTPS根地址、禁止重定向、响应上限2MB；网络中断保留原request_key且不自动重发POST，错误不携带上游正文或密钥。

知识/情报接口新增scopes，调用仍由当前账号归属的RPC检查对象与预算，不改变数据库权限模型。平台账号接口仅list/creator接受publish:read；platform-publish的cancel复用publish:create，sync独立metrics:sync。共享`api-scopes.ts`同时用于签发、业务路由和开放接口页面。production-jobs支持按情报kind过滤。没有新迁移，当前schema仍到00044。

完整工具参数与调用顺序见 [MCP指南](../../../mcp/mcp.md)，[tools.json](../../../mcp/tools.json)从实际SDK导出。新配音必填request_key/confirmed_credit_cost，旧客户端必须升级；空音色由管理员配置决定。原视频工具保留，并新增provider/尾帧/参考素材和按原UUID恢复。

## 开发与验收

先构建`docker build -t shoproai-mcp:local -f mcp/Dockerfile.mcp mcp`，再运行`npm run test:mcp`。工具变更运行`python mcp/export_tools.py`生成目录，`--check`发现漂移则失败。生产Docker使用Python3.12及非root用户。

AT-MCP-02–05覆盖实际SDK初始化/调用、旧配音参数拒绝、各模态/导出/批量/发布/知识/情报载荷、并发用户与Key隔离、跨用户拒绝、响应丢失后原请求恢复、权限拒绝及传输边界。后端/上游依赖在夹具中替代；幂等扣费及Key限流另由实际PG迁移测试验证。

实测结果：

- 实际MCP SDK 11项测试通过；45个工具目录校验通过。
- 新scopes接口4组测试通过，覆盖20种操作计费前拒绝、账号管理旁路拒绝、所属用户绑定、业务价格/幂等/状态校验。
- 真实PostgreSQL访问控制6项通过（22.856s），原访问接口3组、知识6组、情报7组协议通过。
- 部署工具9项测试通过，platform-accounts网关例外及已有观测/知识/情报签名入口清单一致。
- 六入口Deno检查、TypeScript、Biome与实际规则lint通过；生产构建8.15s通过，MCP镜像已重建。

## 发布与运营

先应用00032–00044及匹配knowledge-base/market-intelligence/production-jobs/api-keys/platform-publish/platform-accounts和共享模块，再部署MCP/前端。`config.toml`及火山manifest将platform-accounts网关JWT关闭，由函数内JWT/Key验证；OAuth操作仍在函数内拒绝Key。旧Key不会自动获得新增权限。

HTTP需真实TLS反代和MCP_ALLOWED_HOSTS；握手不证明业务权限/上游授权有效。上线测试真实用户JWT过期/Key撤销、私有素材签名、真实各模态结果、两平台用户确认/上传/审核及后台恢复。浏览器/Agent不得自动代替用户确认形象授权、发布可见范围及预算。

客服记录本地job.id/request_key/状态/积分流水，媒体输出签名过期重新查询。unknown保持原任务/预占，按原供应商证据核对，不建议用户换UUID重提。监控401/403/409/429/503、请求延迟、队列年龄和撤销生效，不保存Authorization或完整上游响应。部署/公网TLS/真实供应商与平台验收尚未完成，本轮不是全系统生产上线。

后续继续：多账号派发、商品导入演示清理、真实鼓点与字幕导入、人物语义抠像/自动多镜头混剪、现金退款原子权益、运营后台/预算/风控、媒体TTL/声纹生命周期、告警备份及云端全链路验收。
