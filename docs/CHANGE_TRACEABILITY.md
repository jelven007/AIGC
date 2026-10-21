# 变更、需求与文档追踪矩阵

更新：2026-10-21，最新业务源码 `53be501`，已推送GitHub。本文档同步不部署云端。需求编号前缀均为 `REQ-`，完整接受条件见 [PRD](prd/PRD.md)；原版功能覆盖与兼容缺口见 [专项核验](FUNCTION_COVERAGE_REVIEW_20261021.md)。

## 1. 迭代与实现

| 基线/提交 | 主要变化 | 需求 | 实现依据 | 验证 | 运维/发布影响 |
| --- | --- | --- | --- | --- | --- |
| dd8fcab 原始 | 多功能演示、浏览器模型调用/模拟、计费与权限缺口 | 历史问题基线 | `docs/ok` 历史报告 | 不作当前验收 | 演示配置不进入生产 |
| 374914b / 4d707f2 | 原子支付与权益、验签、逐笔补偿、RLS、类型与检查基线 | PAY-01、AUTH-01 | 00028/00029；支付函数、auth/billing 共享模块 | Finance/Payments | 支付函数与迁移一起发布；历史现金退款示例废弃 |
| 1928a72 | 服务端视频队列、租约、归档、未知核对、自动退积分 | VIDEO-01–04 | 00030、video-jobs、video-job-worker | Finance/Video | 调度须持续运行；unknown 不重提/不按超时退款 |
| 712c8b7 | Docker 调度、健康预检、Cron 派发 | VIDEO-02、OPS-01 | scripts/run_video_worker.py、manage_video_scheduler.py、supabase/ops | Scheduler/Cron | 10 秒/4 并发；选择一种调度 |
| 276208c | 官方项目接入、免费计划/赠分 | AUTH-01、OPS-01 | 00031、官方部署记录 | 既有真实 Auth/失败退款验收 | 官方环境为当前实际；免费版不等于所有最新函数上线 |
| 5ba7466 | 火山 BaaS/Pages/ECS 工具、方舟、MCP JWT、前端密钥清理 | TEXT-01、MCP-01、OPS-01 | 00032/00033、deploy/volcengine、text-generation、MCP | Volcengine/MCP | 火山资源未验收；ACL/协议迁移须先发布 |
| ce90bfe | 13 槽、管理员设置、AES-GCM 版本、视频绑定、真实图片/音频 | MODEL-01–03、VIDEO-05、IMAGE-01、AUDIO-01 | 00034、model-settings、model-registry/catalog、image/audio handlers | Finance/Models/Audio/Video | 主密钥备份、管理员授权、旧任务绑定；当前云端缺部署 |
| 53be501 | 私有媒体、图片恢复、FFmpeg、抖音/TikTok发布与官方指标 | ASSET-01、IMAGE-01、RENDER-01、PUBLISH-01、METRIC-01 | 00035/00036、production-jobs/worker、platform-*、worker/ | 33数据库/6FFmpeg测试、API夹具、UI恢复、类型/Deno/lint/build，见ITERATION_06 | 新函数、production调度、FFmpeg容器、私有迁移一起启用；云端/平台真实验收待执行 |
| 本轮任务中心修复 | 新协议合并、审核/未知/计费、取消与错误保留，移除旧重试/删除 | TASK-01 | TaskQueuePage、taskCenter、平台API类型，见ITERATION_07 | 8专项测试、真实UI夹具、视频/生产回归与lint/build | 无新迁移/后端接口；需既有production-jobs/platform-publish匹配部署 |

提交名与更详细时点见 [历史迭代](ITERATION_03_VIDEO_JOBS.md) 与 [架构对比](ARCHITECTURE_REVIEW_20261021.md)。旧审计的行号和未修复清单需结合此矩阵，不直接当作当前缺陷。

## 2. 六领域同步关系

| 变更主题 | 需求 | 方案/开发 | 测试 | 运营 | 运维 |
| --- | --- | --- | --- | --- | --- |
| 实际平台/发布差距 | OPS-01 | TECHNICAL_ARCHITECTURE、DEVELOPMENT_GUIDE | AT-01/19/20、Deploy | 发布范围/不夸大上线 | CURRENT_STATE、DEPLOYMENT_AIGCP、VOLCENGINE_DEPLOYMENT |
| 配置、密钥与管理员 | MODEL-01/02/03 | MODEL_SETTINGS、API_AND_DATA | AT-04/05/06、Finance/Models | 供应商准入与预算 | RUNBOOK 配置迁移/备份 |
| 幂等、关页与退款 | VIDEO-01/02/03/04/05 | API_AND_DATA、TECHNICAL_ARCHITECTURE | AT-07–13、Finance/Video/Scheduler | 状态说明、客服工单 | VIDEO_SCHEDULER、RUNBOOK 核对/恢复 |
| 文本/图片/音频 | TEXT-01/IMAGE-01/AUDIO-01 | ai/ai、MODEL_SETTINGS、API_AND_DATA | AT-14–16、Models/Audio/Volcengine | 质量评估/免费调用成本 | RUNBOOK 配额与同步超时 |
| 支付与积分 | PAY-01/AUTH-01 | plan/支付、API_AND_DATA | AT-02/17、Finance/Payments | 账单/现金退款区分 | RUNBOOK 差异对账 |
| 用户资产与 MCP | ASSET-01/MCP-01 | API_AND_DATA、mcp/mcp | AT-03/18、MCP | 素材准入/用户培训 | TLS/域名、公开存储边界 |

主文档统一从 [文档中心](README.md) 导航；[测试计划](TEST_PLAN.md) 与 [本轮报告](TEST_REPORT_20261021.md) 分离计划和实测。商业计划、竞品、演示材料只能引用已证实结果。

## 3. 当前发布缺口

| 项目 | 现状 | 下一步与负责领域 |
| --- | --- | --- |
| 官方后端升级 | 最近核验到 00031，3 个旧函数，缺 model_configs | 开发/运维核对并应用 00032–00036 与匹配函数/容器；前端最后发布 |
| 模型与旧任务 | 无真实供应商验收；旧任务版本迁移未执行 | 模型管理员/运维设置主密钥、授权、配置；核对原账号绑定；测试 AT-05/09/13–16 |
| 付费与预算 | 商户未验收，免费同步调用无金额预算系统 | 财务/运营验证实际成本、沙箱/回调、供应商额度与收费 |
| 现金退款 | 遗留 alipay-trade-ops 非原子资金/权益闭环，权限口径不同 | 开发/财务单独统一授权、退款额度/幂等/回收及专项回归，未纳入已交付 |
| 火山迁移 | 仅代码/工具适配 | 单独建资源和回执，迁 Auth/DB/Storage，验收后切连接 |
| 生产基础 | 私有素材、告警、备份恢复、正式域名未验收 | 按实际用户要求实施并演练；不从文档推断已具备 |
| 扩展业务 | FFmpeg/两平台/自然指标及新任务中心已有本地实现；批量/旧五步停用，其余尚有缺口 | 继续图库/素材删除/OpenAPI兼容，再补Sora/批量/数字人/团队/真实情报/广告及后台，见覆盖核验 |

## 4. 后续变更记录要求

每次状态/配置/计费/API 变更记录：提交、需求 ID、迁移与调用者、兼容/旧任务策略、测试证据、运营价格/用户提示、运维监控/恢复。发布再补项目与环境、实际迁移/函数、配置版本、构建校验值、云端接受条件和遗留项。

文档不是部署回执。缺证据时标为“待验收/未发布”；不把本地通过、健康探针、模型默认名称或页面数量换成上线和商业指标。

进行中源码的具体接受要求见 [PENDING_CHANGES](PENDING_CHANGES.md)；发布后以新提交与实测更新，不把工作区变动追记成 ce90bfe 的验证范围。
