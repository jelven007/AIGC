# 测试与验收计划

新增 [迭代28专项](ITERATION_28_OPERATIONS_WORKFLOWS.md)：`test:operations`执行真实PG8项工单归属/内部消息/处理人/版本/容量、租户所有权/成员/暂停/并发预算/固定归因、风险与原退款、原账单币种/版本/零凭证/一次冲销；Edge4组个人身份/原参数/16KB/拒绝与未知。浏览器覆盖工单503刷新原UUID/真实回复、租户暂停/预算/成员/冲突、风险限制和实际文件指纹/1.23分币种入账，原现金16PG/8接口与团队权限6PG回归。最终压缩构建、Deno、lint、probe17/00056/render4/edit2与调度/发布检查同步；目标仍需真实角色/账单/共享链接过期/容量和全栈验收。

新增 [迭代27专项](ITERATION_27_BATCH_PIPELINE.md)：test:pipeline验证真实PG8项整批预算/原阶段/模型/流水/依赖/共享配额、退款故障回滚、未知保护、跨账户不变、测量/字幕/合成/发布及无字幕免费测量，实际PCM/FFmpeg2项验证完整配音和多镜头。浏览器覆盖390px必填/预算、503刷新原UUID、原发布入口、逐账号确认和旧回执兼容；旧批次/发布/剪辑、MCP16项/59目录/19权限、Deno、lint/build、调度9/部署9回归。目标补真实供应商/账号、多语言质量、长任务容量与probe16/00055/render4/edit2全栈验收。

新增 [迭代26专项](ITERATION_26_EDITOR_ASSETS.md)：test:assets覆盖真实PG5项原登记并发/Storage证据/权属/声明/墓碑/RLS、素材接口3组和音频协议，实际PCM/FFmpeg3项频段比例/机器人边带/淡变回声。browser_editor_assets覆盖真实播放/团队503/原2.5秒时长、上传503刷新原UUID、音频工程恢复、实际MediaRecorder/390px；开发与独立压缩页面及原剪辑、MCP16项/58目录/18权限、调度9/部署9通过。目标补真实设备、长素材内存、Storage元数据、共享撤销、供应商及probe15/00054/render4/edit1全栈验收。

新增 [迭代25专项](ITERATION_25_EDIT_ANALYSIS.md)：test:edit执行真实PG7项原请求/价格/模型/配额/工程归属/RLS/阶段/租约/未知保护/单退款及协议6组，含源素材清理后终态回执；实际PCM/FFT/固定人物模型/FFmpeg5项验证120→240 BPM/裁剪hash/静音、人物alpha/原音轨/手机旋转、取消和字幕边界。browser_edit_analysis覆盖503刷新同UUID、真实字幕偏移/重复应用拒绝、节拍切分/人物设置恢复、无回执任务链接/390px与压缩页面；原FFmpeg12项、任务中心、情报PG/调度/部署回归。目标补真实Whisper、分割质量、多语言、长素材CPU/临时空间与关页验收；probe14/00053/render3/edit1与匹配全栈。

新增 [迭代24专项](ITERATION_24_WECHAT_TRANSACTIONS.md)：test:wechat覆盖13项真实PG单租约/原商户/期限/关闭与迟到支付、原退款/通知竞争/额度/比例欠额/365天/50次/一分钟限制/已验签不存在才恢复，真实RSA/AES协议8组及基础验签。回归cash/checkout，390px订单与微信/支付宝运营恢复和压缩页面；目标补真实Native付款/回调/丢通知/原路退款到账/异常退款/历史绑定/账单对账。probe13/00052/render2与全部匹配函数同窗发布。

新增 [迭代23专项](ITERATION_23_DATA_LIFECYCLE.md)：test:lifecycle验证17项真实PG媒体引用/TTL竞争/墓碑/清理租约、声纹撤销与单退款/未知受理保护、知识正文/向量/检索副本和晚到回执、终态证据/正式文件；清理协议4组、媒体/知识/权限/MCP及既有访问回归。browser_data_lifecycle在390px开发与minified服务验证503同UUID撤销恢复、供应商状态及知识删除结果/引用按钮；目标补真实Storage/供应商删除、容量和备份恢复。

新增 [迭代22收银/加载专项](ITERATION_22_CHECKOUT_LOADING.md)：test:checkout验证真实PG同UUID并发、改价原快照、终态、账号/RLS/封禁和十待支付配额；协议验证两渠道精确金额/签名表单/原订单/未知回执/未开通，browser_checkout覆盖空账单/读取失败/总额使用率/订单分页、503刷新原请求、金额冲突重选、微信QR与支付宝NOT_EXIST/退款终态、积分不足事件和390px。构建按静态依赖闭包与旧提交同环境对比；目标补真实商户、CDN/Web Vitals、微信查单/过期和退款。

新增 [迭代21专项](ITERATION_21_TRANSLATION_NOTIFICATIONS.md)：test:translation执行PG原商品版本/价格/共享并发/指纹/原结果核对/退款和通知隔离/终态/去重/cutoff/偏好/TTL，协议验证私有图片/流量上限与翻译未知不重发。browser_translation_notifications验证同UUID关页恢复、JSON/编辑版本、图片地址指纹、竞品使用权、真实通知分页/铃铛同步/偏好失败和390px；MCP/任务中心/调度/部署/工程同步。目标补eBay图片权限、视觉模型质量/费用、真实触发/清理及吞吐。

新增REQ-CASH-01–02/OPS-01/BUDGET-01对应 [迭代20](ITERATION_20_CASH_OPERATIONS.md)：真实PG16验证现金预占/并发/原参数/查询节流/崩溃租约、签名到账绑定/权益/欠额/旧周期/加油包与事务回滚，可信角色/客户范围/安全分页/角色撤销、日预算并发和版本回执；8组Edge/调度协议，4组390px退款/预算503原UUID刷新、确定拒绝与权限UI。`npm run test:cash`、browser_operations与资金/支付/调度/部署/工程检查；目标补真实支付宝签名/退款字段/到账、历史账与权益规则，微信退款仍待实现。

新增 [迭代19专项](ITERATION_19_PRODUCT_MANAGEMENT.md)及test:products/browser_products：PG身份/回执并发/整批回滚/版本冲突/删除重放/来源墓碑/队列/留存，真实HTTP解析/内网重定向拒绝/空值/币种/CSV多行引号、后台证据恢复、页面503刷新恢复和390px布局。同步finance/intelligence/production/MCP/scopes与调度/部署；目标补真实商家页、图片签名/存储留存/备份/吞吐。仅本地通过不证明云端生产可用。

新增AT-PUBLISH-02–06，见 [迭代18](ITERATION_18_PUBLISH_GROUPS.md)：中途账号失败整组回滚、并发同UUID/排序/权限撤销后恢复、预览源/用户/日期/确认边界、单账号与组共享24容量与unknown、独立执行/取消。页面验证各账号确认/内容变化撤销确认、503锁定参数/刷新同UUID重试、旧单账号回执、390px布局。MCP新增两工具/47目录与22操作权限拒绝；目标必须用真实账号验证定时、审核终态与原平台ID。

新增AT-MCP-02–05，见 [迭代17](ITERATION_17_MCP_PRODUCTION.md)：真实SDK45工具清单/旧配音参数拒绝、多模态与批量/发布/知识/情报业务载荷、并发JWT/Key隔离、响应丢失原键恢复/跨用户拒绝、HTTP错误脱敏/不重发/重定向/正文上限。`npm run test:mcp`与真实PG `test:access`核验16权限、撤销/限额/归属及账号管理旁路拒绝；目标仍需TLS/域名和真实供应商/平台验收。

新增AT-RENDER-03–06，见 [迭代16](ITERATION_16_RENDER_EFFECTS.md)：十二转场像素/时长与打乱输入顺序，RGB混合参考/空间时间边界、色键前景及透明度、非法参数计费前拒绝、效果保存刷新/稳定URL和390px控件。`test:render`覆盖协议和真实FFmpeg；真实4K/长工程、多编码/透明素材、租约失效与供应商/云端容量仍需上线验收。

新增AT-INTELLIGENCE-01–04，见 [迭代15](ITERATION_15_MARKET_INTELLIGENCE.md)：正式协议/加密凭据目的地、原请求与计划并发、一次扣费退款及来源入库、有限采集恢复、用户隔离和30天所有副本清理；移动端空态、缺失指标、原UUID刷新及读取失败。目标环境必须验收YouTube配额/隐私口径、eBay正式访问和市场、数据商合同/时效、每日预算与真实清理；协议夹具不计为供应商上线。

新增AT-KNOWLEDGE-01–04，见 [知识迭代14](ITERATION_14_KNOWLEDGE_RETRIEVAL.md)：真实PG验证列权限/用户、同请求并发单扣、正文与配置版本失效、有限非零向量与整批事务、unknown禁止重发及失败一次退款；真实模块检查Unicode分块/响应序号和checkpoint恢复；移动页面验证空库、真实AI失败保留输入/成功待保存、索引503刷新同UUID、引用进入脚本、取消不成功。目标云端需实际Embedding配置、质量/费用/延时、正文删除与备份恢复；精确扫描容量必须按真实语料压测，不用本地夹具推断。

00042接受项见 [观测实验迭代13](ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)：并发来源/回执、跨用户/版本/批次回滚、缺失/零、匿名分组及事件去重/时窗、双尾/Holm/Wilson/缺样本、HMAC原文与过期/体积/停用、三看板同口径/Excel及503刷新原请求。目标环境还需实际授权采集、真实分流、归因窗口、盐策略、留存/规模/告警；不把合成夹具指标当成经营实绩。

新增00041接受项见 [分析迭代12](ITERATION_12_GROUNDED_ANALYSIS.md)：5项PG/4组协议/2项FFmpeg及移动页面恢复，覆盖两段领取、版本/价格/配额、原退款、字幕边界/越界、源指纹、静音及无时间戳、私有抽帧、真实MP4。云端还需验证视觉模型与Whisper权限、旧租约、实际成本、10分钟边界和上线后对象生命周期。

版本：2026-10-21，源码 `ce90bfe`。与 [PRD](prd/PRD.md)、[接口](API_AND_DATA.md) 对应。已执行结果独立记录在 [验证报告](TEST_REPORT_20261021.md)，此处列出的云端用例不代表已执行。

## 1. 测试层次与环境

| 层次 | 环境/手段 | 能证明什么 | 不能证明什么 |
| --- | --- | --- | --- |
| 事务与权限 | Docker PG16，真实业务迁移，Auth/Storage/角色替身 | 并发扣费、RPC/表权限、配置版本、退款原子性 | 托管 Auth、PostgREST、云端扩展/RLS 整体配置 |
| API/上游协议 | Node/Deno 受控 fetch、Storage、SDK 替身 | 请求协议、错误分类、输入与鉴权、失败补偿 | 真实模型权限、速度、画质、供应商账单 |
| 调度/发布/MCP | Python、本地 HTTP、真实 MCP SDK、数据库替身 | 退避、并发、回执、防漂移、JWT 传递 | ECS 在线稳定性、Pages 重写、正式 TLS |
| 浏览器 | 对目标环境实际操作、双用户、移动宽度 | 设置页、刷新/关页恢复、提示与交互 | 不能用页面截图替代数据库/资金证据 |
| 云端与业务 | 隔离验收账号、真实已开通模型、支付沙箱 | 部署兼容、成片可播放、真实账单/回调 | 小样本不证明规模 SLA 或商业转化 |

正式业务环境不用演示用户和演示数据迁移。真实生成使用明确预算的验收账号；保存任务/订单/配置版本与脱敏结果，清理时先完成终态和对账，不删除未核对任务。

## 2. 自动回归入口

| 用例组 | 入口 | 主要对应需求 |
| --- | --- | --- |
| DB-01 | `npm run test:finance` | AUTH-01、MODEL-02、VIDEO-01/03/04/05、PAY-01 |
| PAY-01 | `npm run test:payments` | PAY-01、AI Action 补偿 |
| VID-01 | `npm run test:video` | VIDEO-01–04、OPS-01 |
| MOD-01 | `npm run test:models` | MODEL-01–03、IMAGE-01、AUDIO-01 |
| DEP-01 | `npm run test:volcengine` | OPS-01、TEXT-01、Ark 协议 |
| SCH-01 | `npm run test:scheduler` | VIDEO-02、OPS-01 |
| MCP-01/02–05 | `npm run test:mcp`，先构建shoproai-mcp:local | MCP-01–04、OPENAPI-02 |
| ACCESS-01 | `npm run test:access`；`node tests/browser_access_control.mjs`（本地UI夹具） | OPENAPI-01、TEAM-01、ASSET-02 |
| BATCH-01 | `npm run test:batch`；`node tests/browser_batch_video.mjs`（本地UI夹具） | BATCH-01/02；整批回滚/预算/套餐/并发恢复/暂停/取消退款与领取竞态 |
| EXPORT-01 | `npm run test:exports`、`npm run test:render`、`node tests/browser_render_exports.mjs` | RENDER-02、MODEL-04；全批回滚/并发/配额/源删除恢复、4:5像素尺寸/滤镜强度、刷新/旧回执兼容 |
| MEDIA-01 | `npm run test:media`、`node tests/browser_media_jobs.mjs` | AUDIO-02、AVATAR-01；版本/价格/声纹权限/配额、原受理未知、归档恢复、照片口播/口型、同请求刷新 |
| ENG-01 | `npm run typecheck`、关键函数 `deno check`、`npm run build` | 编译与打包，不替代业务验收 |

MCP 需安装 `mcp/requirements_mcp.txt`。按实际修改选择回归：计费/RPC 跑真实 DB；提交/查询跑 VID；配置跑 DB+MOD；调度跑 SCH；发布脚本跑 DEP。文档更新做链接、事实和差异检查，无需反复全量测试。

## 3. 云端验收用例

多规格导出启用还需验证：00039与匹配API/FFmpeg镜像已部署，私有源作品六画幅/三分辨率实际编码和下载播放，关页同键恢复、部分失败/独立发布、队列容量429、旧回执恢复。Sora按官方退役信息检查，不调用关闭API。新增要求对应REQ-RENDER-02/REQ-MODEL-04；本地夹具不代替此验收。

00040媒体启用还需验收真实OpenAI/Step配音/识别、ElevenLabs即时声纹及验证、D-ID/Sync私有签名输入与可播放MP4，双用户访问、同请求账单、换价拒绝、关页恢复、旧配置/旧声纹账号、未知核对与自动返还。production-worker probe版本2需ready且required_migration=00040；专业训练与动作控制不在本地已交付范围。对应REQ-AUDIO-02/REQ-AVATAR-01，见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)。

| ID | 前置与操作 | 预期结果/证据 | 需求 |
| --- | --- | --- | --- |
| AT-01 | 记录 URL、迁移、函数、Git、Cron/容器；调用 probe | 00034 所需字段存在；函数与源码匹配；probe 不消费任务 | OPS-01 |
| AT-02 | 新邮箱注册、验证与登录；重复回调/初始化 | 一份用户套餐，默认 20 赠分一次；未登录无法读业务 | AUTH-01 |
| AT-03 | A/B 两用户读取修改商品、素材、任务与订单 | B 无法读取/覆盖 A；关键 RPC 不能由普通用户执行 | ASSET-01 |
| AT-04 | 普通用户、伪造 user_metadata、真实管理员访问设置 | 仅管理员可 list/save/import/test；任何响应无 Key/密文 | MODEL-01 |
| AT-05 | 首次保存、留空 Key、两管理员同时保存、启停 | 版本追加；保留 Key；一个冲突 409；无原地改删 | MODEL-02 |
| AT-06 | 配置只读 test 地址；检查调用与供应商账单 | 仅 GET，不生成收费任务；健康检查不改变“权限待实测” | MODEL-03 |
| AT-07 | 创建视频，重复/并发同键；不同参数复用键 | 一任务一扣费；不同参数 409；未配置/禁用扣费前拒绝 | VIDEO-01 |
| AT-08 | 创建响应丢失后用同 request_key 找回 | 原任务/配置/扣费不变；无需新键 | VIDEO-01 |
| AT-09 | 提交真实模型后关闭页面，重新登录查询作品 | 后台完成；Storage 实际可播放/下载；结算只一次 | VIDEO-02 |
| AT-10 | 查询与调度并发、Worker 中断、租约过期 | 不重提已受理 POST；暂时错误恢复；不多扣多退 | VIDEO-02/03 |
| AT-11 | 注入 POST 超时/5xx/成功无 ID | unknown、needs_attention、积分保留；有核对记录 | VIDEO-03 |
| AT-12 | 明确拒绝/上游失败；注入退款事务故障再恢复 | 证据持久化；终态/作品/原流水退款原子恢复一次 | VIDEO-04 |
| AT-13 | V1 提交后切 V2/禁用；核对并绑定旧任务 | V1 任务仍读 V1；V2 新任务规则生效；绑定有审计 | VIDEO-05 |
| AT-14 | 真实图片两协议、封面、非法/空图片、页面关闭 | 正常图片归档；失败报错；不伪造 CTR；关页不承诺恢复 | IMAGE-01 |
| AT-15 | 文本 SSE/JSON、主模型失败备用、中断和限流 | 实际输出；无模拟成功；429；缓存不串用户 | TEXT-01 |
| AT-16 | TTS 音色、ASR 上传、Step SSE、20MB 边界 | 真实可播/可识别；错误脱敏；JWT 与频控有效 | AUDIO-01 |
| AT-17 | 支付沙箱验签、错金额/渠道、重复通知、权益故障 | 错误不入账；正确通知权益一次；恢复后可重试 | PAY-01 |
| AT-18 | MCP SDK 两用户并发；视频重复 UUID/查询 | JWT 不串用；任务与页面一致；无 Key 旁路 | MCP-01 |
| AT-19 | Pages/正式托管深链接刷新、Auth 回调、失效 JWT | 正确 SPA fallback；过期会话提示重登 | OPS-01 |
| AT-20 | 备份恢复到隔离环境，并核对队列/密文/Storage | 可解密旧版本、资金一致；恢复阶段不自动重提上游 | OPS-01 |
| AT-21 | 有效/到期套餐、两用户、重复批次、配置改动、价格与预算不足 | 1–50商品整批事务，失败零预占/零孤立作品；同键找回/参数冲突 | BATCH-01 |
| AT-22 | 批次关页、暂停/恢复、领取与取消并发、退款写入故障、未知核对 | 已受理继续；仅queued原流水返还一次；进度/终态/账单汇总一致 | BATCH-02 |

AT-11/12 等故障注入优先隔离环境，不通过反复请求真实收费服务制造失败。正式上线保存每个必需用例的环境、执行时间、操作者、输入标识、预期/实际与证据路径。

## 4. 质量与性能验证

生成质量分模态评估：文本商品事实/目标语言/禁用夸大措辞；图片商品外观与参考一致；视频主体稳定、运动、时长、比例与画质；音频可懂度、商品名、音色、发音与语言。固定样本、相同输入和配置版本，记录人工是否接受及原因；样本量和阈值由试点确定，不编造通过率。

性能分开记录排队时间、供应商受理至完成时间、转存时间、总耗时与同步 API 首字/首音时间。不同模型/规格/负载分组统计 P50/P95；Worker HTTP 超时、租约回收和限流也单独统计。调度默认 10 秒/4 并发是配置值，不是吞吐承诺。

在隔离环境逐级加压，检查 PG 锁等待、连接数、函数运行限制、Storage 下载内存与供应商配额。先确认单用户基线再升并发；出现资金不一致、身份串用或不确定 POST 重提立即停止。当前没有已验收的 TPS、99.9% SLA、RPO/RTO。

## 5. 发布接受与缺陷管理

P0：越权/资金错误/密钥泄漏/重复受理/配置串账号，发布阻断。P1：主链路不可用/长期无法恢复/计费无法核对，发布阻断相关能力。P2：辅助交互、性能、文案，记录影响与替代路径。

发布必需 AT-01–13（启用视频时）、相应模态用例（启用时）、AT-17（开支付时）、AT-18（公开 MCP 时）、AT-19/20（正式托管与恢复）。不启用的能力保持关闭并标明范围；私有素材需求未实现前不接受该承诺。

缺陷记录包含复现条件、环境与提交、request_key/job/order/version、脱敏日志、资金影响、负责人、修复提交和回归证据。上线后用 [运维手册](RUNBOOK.md) 监控和核对，需求覆盖见 [追踪矩阵](CHANGE_TRACEABILITY.md)。
