# 迭代21：图片选品、商品翻译、竞品视觉入口与真实通知

2026-10-22，本地源码与隔离环境交付。新增00049；最近已核验的官方云端仍为00031和三个旧函数，不能据本地测试宣称生产上线。

## 功能与约束

- 图片选品：智能选品支持关键词/图片切换。图片由本人上传私有materials，限制5MB、JPEG/PNG/WebP并校验实际文件头；稳定对象引用与SHA-256绑定保存对象/原请求。仅eBay官方Browse `POST search_by_image`，传纯base64及Bearer；返回普通在售搜索结果、原币种及缺失指标，不推断热卖/销量。恢复原对象先核对原参数，不要求过期预览或已删除原图仍可访问；执行时重新读取并核对指纹，图像变化拒绝处理。
- 商品翻译：`product_translate`沿原production队列，支持简体中文、英、日、韩、法、德、西、葡、阿、泰、越、印尼12语言。默认2积分，明确确认当前价格，绑定商品updated_at、原文字快照SHA-256及不可变文本模型版本。可选主图OCR仅返回文字对照，不修改图片。字段数量/结构/长度与原商品对应，不增加价格、优惠或经营事实。
- 原翻译请求先恢复，配置禁用/版本改变不创建替代任务。模型响应有效后先保存证据；归档失败复用原结果，不再调用模型。执行中丢失受理证据进入unknown，需服务端凭原结果或明确拒绝证据核对；结构非法且已响应则失败退款。商品提取/翻译/竞品/选品共享4个未结案槽，unknown继续占用。
- 商品页翻译记录可关闭/刷新恢复、查看结果、复制和导出JSON。译文先进入编辑草稿；保存仍使用source_updated_at，版本冲突拒绝覆盖。任务中心通过原job ID打开对应记录，超过最近20条的任务单独按本人ID查询。译文结案30天后清理原文/结果/证据副本，原请求和计费记录保留。
- 竞品条目可进入风格分析并关联sample_id/item_id；必须上传本人有使用权的视频并勾选确认。服务端从本人正式竞品快照读取标题、统计和来源，独立保存引用，拒绝浏览器自填统计或其他用户快照。结果注明“未验证上传素材与原平台视频为同一作品”；不把平台网页当视频、不声称自动下载原作品。关联副本结案30天后清理。
- 通知由生产任务、视频任务及平台发布真实终态/unknown触发，按用户/来源/状态去重。通用publish completed不是公开发布成功，只有publish_tasks published产生发布成功消息。原硬编码活动、系统升级和虚构作品通知删除。
- 通知页和铃铛共享按用户/分类/页缓存的React Query，真实未读、已读、删除、分页、空态/错误与成功通知偏好；写入后统一失效刷新。批量已读/清已读使用已读取列表cutoff，保护随后到达的消息；失败/unknown通知不可关闭。站内通知保留180天，不声称已开通邮件或浏览器推送。
- MCP新增translate_product/list_product_translations，共54工具，仍18权限；商品写/读分别使用products:write/read。视频分析工具支持结构化竞品引用和必须为true的使用权确认；后端继续校验本人来源。通知RPC仅authenticated可调用，不对API Key开放。

## 接口与架构

`product-management`新增translations（最近20任务和cost）与translate（原UUID及input，202 job）。input包含product_id/expected_updated_at/target_language/include_image/confirmed_credit_cost；原版本/价格冲突409、积分不足402、未配置424、容量429、未知503/outcome unknown。

`market-intelligence save_target`的eBay图片params为search_mode=image/image_url/image_hash/market，默认采集价格仍2积分。目标catalog只给稳定引用/原指纹；采集结果不暴露私有图地址。API与Worker分别核对授权、格式、大小、内容指纹。

`production-jobs create analysis`新增可选competitor_reference={sample_id,item_id,rights_confirmed:true}，仅mode=style；引用由SQL事务核验。公开结果只有安全来源，没有租约/供应商凭据。

通知采用现有Auth/RPC/RLS，`read_notifications(category,offset,limit)`返回items/total/unread/unread_all/cutoff/preferences；25默认、50最大，offset≤10000。`mutate_notifications`支持read/delete/read_all/clear_read/preferences；只操作当前用户，批量ID≤100，批量时间不得晚于服务器当前时间。

00049的结果校验函数共用于自动结案和service-only人工核对，避免两条路径接受不同来源/字段。调度和部署要求probe v10、required_migration=00049、render_version=2，同时执行翻译、通知及关联副本清理。

## 验证与发布

入口：`npm run test:translation`、`tests/browser_translation_notifications.mjs`、商品/情报/分析协议、MCP SDK/权限、任务中心、调度/部署、Deno check及工程lint/build。PG测试使用隔离PostgreSQL16，浏览器用真实Chromium 390px、受控HTTP夹具；不向供应商调用或真实扣费。

已验证：12项真实PG（26.781秒；原版本、退款、并发槽、图片指纹、真实来源、原结果核对、通知隔离/去重/发布公开态/cutoff/偏好/TTL）；7组翻译及私有图片协议、8组情报协议、4组分析协议；原商品7项PG、商品和情报移动端回归；MCP14项/54工具/18权限与27动作、任务中心11项、生产调度/部署各9项。综合Chromium390px四组验证翻译/图片503原请求恢复、JSON导出/原版本保存、竞品权利确认、真实通知分页/铃铛同步/新消息保护/偏好失败与恢复/删除空态；页面无横向溢出或运行错误。Deno四入口、工程lint/type/Biome及Vite构建通过，主包645.57KB/gzip194.38KB，后续继续拆包优化。

发布必须同窗口应用00032–00049及匹配product-management/market-intelligence/production-jobs/production-worker、共享模块、调度器、MCP镜像和前端。需目标验收eBay search_by_image权限/配额与真实返回、视觉模型图片支持/语言质量/费用、商品版本竞争、原请求恢复、竞品来源隔离、通知真实触发和清理。不能单独发布新版页面。

## 继续执行

剪辑资源/语义抠像/鼓点/精确字幕/多镜头配音混剪编排、媒体TTL/声纹撤销/知识副本删除、告警/备份/容量优化、微信退款与工单/完整租户/风控处置/供应商成本，以及全栈目标部署和真实供应商验收仍需交付。
