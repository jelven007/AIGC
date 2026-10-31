# 迭代15：可追溯的竞品统计与多市场选品

2026-10-21，迁移00044。本轮移除CompetitorPage和ProductSelectionPage的预置账号、商品、销量、排行与固定分析方案。两页共用业务API、生产队列、配置版本、财务事务和用户隔离。本地验证通过，未连接真实供应商账号、未部署目标云端。

## 能力与边界

| 数据源 | 实现 | 必须具备的权限与事实边界 |
| --- | --- | --- |
| YouTube Data API v3 | channels → uploads playlistItems → videos，最多20条近期视频 | Google API Key、API配额；接受UC频道ID或@handle，只取公开数据，隐藏/缺失指标为空 |
| eBay Browse | 应用Basic凭据 → client_credentials OAuth → item_summary/search | 正式应用及Buy API访问权限；US/GB/DE/FR/IT/ES/AU/CA；Best Match搜索不是销量排行榜，Sandbox不能用于生产数据 |
| intelligence-v1数据商 | GET账号快照与商品搜索、响应校验与来源保存 | 运营方与数据商确有合同和平台采集权限；schema/licensed声明只验证技术契约，不代替授权证据 |

YouTube订阅数按官方规则舍入；2025-03-31后Shorts viewCount含开始播放与重播。不能从20条近期上传数据推断全频道均值、最佳发布时间、画面风格、销售转化或收入。

eBay仅保留标价、原币种、标题、卖家和原网页。销量、佣金、库存、收入未返回时保持空值，价格不含运费/税费。数据商近7天销量必须声明七天窗口。没有接入全网销量榜、图片搜商品、自动翻译、视频画面拆解或选品自动投放。

## 设置与发布

统一设置页新增三个情报槽，当前总计20槽。沿用AES-GCM加密、服务端管理员、不可变版本；情报不需要模型ID，每个HTTP请求最多30秒。

- `intelligence.youtube`：地址固定为`https://www.googleapis.com/youtube/v3`；`x-goog-api-key`、raw；填写Google API Key。
- `intelligence.ebay`：地址固定为`https://api.ebay.com/buy/browse/v1`；Authorization、Basic；填写Base64编码的应用ID与应用密钥组合。Basic只发到官方OAuth地址，签发的Bearer token不入库、不回传浏览器。
- `intelligence.licensed`：填写公网HTTPS网关基础地址与真实凭据，协议为intelligence-v1。各平台、各市场是否可用由合同与真实业务验收决定。

需要数据库00032–00044、market-intelligence、新model-settings/production-jobs/production-worker/phase3-assistant及匹配共享模块和前端一起发布。Worker探针v6要求00044；不能只发布前端。旧phase3的add_competitor/crawl_competitor返回410。旧competitor表只读，正式页面不自动迁入其未知来源数据。

## API与数据

业务入口POST `/functions/v1/market-intelligence`，只接受用户JWT，拒绝service_role与无权限Key；16KB正文、每用户每分钟60次、限流失败关闭。

| action | 关键字段 | 行为 |
| --- | --- | --- |
| catalog | kind | 用户对象、最新快照/最近30次粉丝历史、价格/数据源可用性、最近30任务 |
| save_target | request_key/name/kind/source_slot/params | 最多50个对象；原UUID幂等，相同UUID不同内容409 |
| collect | request_key/target_id/confirmed_credit_cost | 默认每次2积分，单对象1个活跃任务、每用户4个；原UUID恢复不重复扣费 |
| schedule | request_key/target_id/runs/budget/confirmed_credit_cost | 0停止、1–30次，每24小时一次；独立计划回执保证旧启动请求重放不会覆盖新停止 |
| import_product | sample_id/item_id | 按本人已采集的产品快照入库；同来源重复导入只创建一个商品，分类/卖点待用户确认 |
| delete | target_id | 活跃任务禁止删除；删除快照与任务中复制的来源正文，保留资金流水和任务状态 |

`intelligence_targets`保存用户对象与计划；`intelligence_samples`存任务关联、来源版本、观测时间、定义和最多20条结果；`product_intelligence_links`记录入库关联；`intelligence_schedule_receipts`仅服务端访问。用户不能直接写快照、积分预算或启用计划。产品入库不编造卖点、功效或折扣。

## 队列、预算与恢复

创建事务先锁用户套餐，再锁对象、核对价格/配置/并发额度、扣积分并插任务。结果入库与任务结案在同一事务中；确定失败用原charge_id退积分，重复回执无重复退款。

自动监控的上限是本次授权的次数×积分价格，逐次扣费，不预占整期资金，不等于供应商实际成本。余额不足、权限失败、价格或配置版本变化时停止；队列拥堵延后15分钟。调度使用确定性UUID和对象锁，多个Worker不能为同一时点重复创建。用户停止计划只影响后续采集，已创建任务继续按原版本执行。

采集只有GET；eBay POST仅签发应用token。暂时错误最多三次采集尝试，每次YouTube最多三个GET；第四次崩溃恢复领取直接结案释放。结果checkpoint后数据库暂时失败继续原证据，不重取供应商；正常结案清掉evidence/resolution中的重复正文。

每次常驻Worker调度执行留存清理：统计快照超过30天删除，终态任务的结果/证据/来源参数同时清理，资金流水保留。删除/过期后无法再次用旧快照导入；已经创建的商品保留。此实现仍需目标环境的数据规模、平台条款和清理运行验收。

## 前端与验证

两页支持空态/未配置说明、保存对象、价格确认、预算计划、查询失败保留上次快照、503刷新后按原请求恢复、后台状态、来源CSV、真实标题引用到脚本；选品支持来源校验的单个/批量入库。CSV防公式注入；不显示外部示例图片。任务中心区分竞品采集/商品搜索并返回对应页面。

- 8项真实PostgreSQL测试：迁移、并发一次扣费、价格/归属/版本、来源结案、重复导入、三次失败退款、计划重放/并发/停止、余额不足、30天各副本清理和RLS。
- 7组实际共享模块协议测试：官方YouTube调用、eBay OAuth和市场头、授权网关校验、checkpoint恢复、崩溃读取上限及业务鉴权。
- 390px真实浏览器：两页空态与未配置、长商品名/缺失销量、503刷新同UUID恢复、来源入库及读取失败保留结果。
- 类型/Biome/规则、四个Deno入口、生产构建及模型/任务中心/财务回归，结果同步[测试报告](../reviews/TEST_REPORT_20261021.md)。

官方参考：[频道查询](https://developers.google.com/youtube/v3/docs/channels/list)、[上传列表](https://developers.google.com/youtube/v3/docs/playlistItems/list)、[视频统计](https://developers.google.com/youtube/v3/docs/videos)、[eBay商品搜索](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)、[eBay应用OAuth](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html)。

## 数据商契约

基础地址追加`accounts/snapshot`（platform/account_id）或`products/search`（platform/query/market），只读GET。必须返回：

```json
{
  "schema": "intelligence-v1",
  "environment": "production",
  "licensed": true,
  "platform": "tiktok",
  "observed_at": "供应商实际观测ISO时间",
  "metric_definition": "统计范围、累计/窗口与限制",
  "items": []
}
```

观测须在72小时内、不能超前5分钟；items最多20条，不重复ID。账号响应还需account的id/name/url/followers，ID与请求一致；视频item包括id/title/url，views/likes/comments/shares/duration/published_at可缺失。商品响应还需query/market与请求一致，item包括id/title/url/price十进制字符串/currency三位币种；seller/sold_7d/stock可缺失。提供sold_7d时须声明sales_window_days=7。URL仅公开HTTPS无凭据，不接受带token/key/signature的链接。

技术校验通过仍须真实供应商联调及运营授权验收；该协议没有替代平台正式授权机制，也不意味着抖音/TikTok等数据已经可采集。
