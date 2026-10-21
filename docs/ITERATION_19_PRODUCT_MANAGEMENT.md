# 迭代19：商品事实导入与事务管理

2026-10-22，本地源码与隔离环境验证。目标云端最近回执仍为00031；本轮没有线上部署或真实商家账号验收证据。

## 需求与交付

对应商品管理/链接导入需求：两个入口共用一个导入组件，删除模型猜测、解析失败后的默认商品、虚构价格/库存/销量、推荐分类照片、本地隐藏删除和首页导入后挂示例视频。真实保存失败必须保留输入与原请求，不能显示导入成功。

- `product_import`使用现有持久化队列、租约、证据和恢复机制。免费，网页读取单个JSON-LD Product，文本提取明确“商品名称：…”或【标题】并保留原文。网页声明不是独立经营事实；用户确认后保存，缺失数值保留null，InStock不推算库存，单Offer价格不标成优惠价。
- 请求GET不携带用户Cookie/认证头；每跳校验公网HTTPS、DNS、凭据和最多3次重定向。网页1MB、每张图片5MB、最多8张，单次连接15秒；登录/限制页、非网页、多商品、格式错误明确拒绝。失败读取最多三次。
- 来源图片经魔数校验后复制到私有materials；页面使用实际照片或“尚未上传/暂不可用”的状态文本。本地照片限制JPEG/PNG/WebP及5MB，保留稳定对象引用，读取短效签名。原解析源保存SHA256、观测时间和字段事实，永久已导入商品保留来源。
- 00046撤销浏览器商品写入、删除演示读取策略，保存/删除由服务端用户身份执行。每批1–100条，账户锁、来源授权/只导入一次、版本检查、整批回滚、回执与审计同事务。原UUID绑定规范化请求哈希；来源删除留标识，重试不能复活旧商品。上架也是版本化保存。
- 首页只读取本人商品；商品页50条分页、服务器筛选/排序，导出明确当前页。CSV统一11列，支持引号/逗号/多行、非负两位金额/整数/原币种、公式文本保护；任何一条无效整批不保存，最多1MB。
- 保存/删除/提取回执未知锁定编辑，持久化原UUID与内容，刷新后恢复。明确拒绝可纠正；查询失败显示错误。源提取结果在任务中心可查看，最近20条可恢复，结案30天后清理原文/证据/结果副本，已保存商品来源与幂等回执保留。
- MCP新增商品列表、提取记录、来源提取、整批保存/删除5工具，合计52工具、18权限。业务白名单新增product-management，产品读写权限独立；网页、API与MCP复用相同事务。
- 修复常驻调度器将production-worker当旧version1检查的故障。当前probe要求version8、render_version2与00046；目标发布核验同时检查迁移和版本。

## 契约

`POST product-management`接受本人JWT或相应API Key，网关JWT关闭，函数内鉴权。用户限流60次/分钟，请求正文最多1MB。不可用数据库写入返回503/outcome unknown；明确参数拒绝、权限、404、版本409返回rejected。客户端不得按HTTP503更换UUID。

| action | 参数 | 结果 |
| --- | --- | --- |
| list | search/category/status/sort/offset/limit≤100 | products、total、offset |
| imports | 无 | 最近20个安全任务，短效素材地址 |
| extract | request_key、input.mode=url或text、input.content | 202 job、outcome |
| save | request_key、items[].draft；编辑加id/expected_updated_at，首次来源导入加import_job_id | ids、count、products、outcome |
| delete | request_key、items[].id/expected_updated_at | ids、count、outcome |

draft含name/category/sub_category/description、original_price/sale_price/currency、stock/sales_count、selling_points/specs/images/cover_image/status。图片上限8、卖点6、规格20；设置金额必须提供三位币种，封面必须属于图片列表。商品容量2000；商品提取与情报共享4个未结案任务，unknown占用。

## 验证与发布

执行入口`npm run test:products`、`tests/browser_products.mjs`和现有finance/intelligence/production/MCP/scopes/调度/部署工程回归。测试结果记录在本轮提交报告；受影响PG/RLS/RPC用隔离Postgres16，HTTP用契约夹具，浏览器用真实Chromium/390px，不访问线上商家或扣费。

本地回归：商品PG7项、HTTP/CSV/解析及Worker私有图片6组、移动页面3组，情报PG8项、资金33项、MCP13项/52工具、18权限/25操作、任务中心10项、生产6组、调度9项/部署9项；Deno入口、真实typecheck/Biome/lint及Vite构建另执行。页面截图检查了滚动表单与固定操作栏，未发现390px横向溢出。

发布需00032–00046、product-management、production-worker及匹配共享模块/前端/调度器/MCP镜像。必须在目标验证RLS、签名上传/过期恢复、真实JSON-LD商家页面及短链、CSV/版本冲突、关页恢复、私有图片留存/备份和服务吞吐。不要只发布新版前端。

## 剩余范围

商品图片搜索、翻译及竞品视觉、通知、剪辑资源商城/人物语义抠像/真实鼓点/精确字幕/自动配音多镜头编排、现金退款权益事务/运营后台、媒体临时对象TTL/声纹撤销、预算告警/备份、真实广告电商数据/实验分流/经营成本和所有云端供应商验收继续执行。链接导入仅支持公开结构化商品页或用户资料；未接通的原生电商接口不声称支持。
