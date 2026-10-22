# Shopro AI

最新本地交付见 [迭代32奖励与账号恢复](docs/ITERATION_32_REWARDS_AUTH.md)：00060正式邀请迁移/验证赠分/历史不补发、活动真实资格/原UUID领取恢复、密码恢复入口与受控异常上报。匹配发布要求probe20/00060/render4/edit2及00032–00060全栈，MCP保持59工具/19权限。官方管理访问401，尚未发布；当前事实见 [运行状态](docs/CURRENT_STATE.md)，下文按原记录时点阅读。

最新本地交付见 [迭代28运营流程](docs/ITERATION_28_OPERATIONS_WORKFLOWS.md)：00056、客户工单与处置、租户策略/成员/所有权/团队预算、风险核对/计费限制、原账单现金/币种/冲销。匹配发布要求probe17/00056/render4/edit2及00032–00056全栈，MCP仍59工具/19权限。告警/备份恢复、企业统一账套、供应商账单连接器与真实目标验收继续执行；当前事实统一见 [运行状态](docs/CURRENT_STATE.md)，下文保留历史时点。

最新本地交付见 [迭代26真实资源与私有录音](docs/ITERATION_26_EDITOR_ASSETS.md)：00054、上传登记原UUID/权属/存储证据与删除墓碑，真实资源库/录音/音频效果和有界媒体缓存，MCP58工具/18权限。发布需probe15/00054/render4/edit1与00032–00054全部匹配服务；目标云端仍为最近00031证据，自动编排、完整运营、告警备份和真实部署继续执行。下文较早迭代保留历史时点。

最新本地交付见 [迭代25真实音轨与人物分割](docs/ITERATION_25_EDIT_ANALYSIS.md)：00053、后台节拍/原裁剪变速/时间分段字幕/原请求恢复、固定模型逐帧透明蒙版和真实成片校验。发布要求probe14/00053/render3/edit1及00032–00053全栈；最近云端仍00031，真实供应商/部署、批量编排与运营剩余功能继续执行。当前事实以 [运行状态](docs/CURRENT_STATE.md) 为准，下文保留历史时点。

最新本地交付见 [迭代24微信交易链](docs/ITERATION_24_WECHAT_TRANSACTIONS.md)：00052、官方签名查单/二维码到期关单、原路退款/通知与两渠道共用资金权益事务。发布要求probe13/00052/render2及00032–00052全栈；最近云端仍00031旧基线，真实商户/部署、剪辑编排和运营剩余功能仍继续开发验收。当前事实以 [运行状态](docs/CURRENT_STATE.md) 为准，下文较早范围保留历史时点。

新增 [可追溯竞品统计与多市场选品](docs/ITERATION_15_MARKET_INTELLIGENCE.md)：20槽、YouTube官方公开统计、eBay官方商品搜索、授权数据商契约、每日预算监控、来源商品入库/CSV和30天清理。移除两页预置数据；已通过本地数据库、协议和移动端验证，真实供应商待验收。当前发布范围00032–00044及market-intelligence/匹配函数，探针v6；下文较早范围按各轮记录阅读。

新增 [私有知识索引与脚本引用](docs/ITERATION_14_KNOWLEDGE_RETRIEVAL.md)：17槽含独立Embedding，知识库统一真实存储，后台分块/语义查询/版本与正文失效/积分，流式及四层脚本服务端加载引用；移除假整合、假训练和默认脚本结果。最新源码部署范围00032–00043及knowledge-base/匹配Worker与文本函数，尚未部署云端。

新增 [统一观测与对照实验](docs/ITERATION_13_MEASUREMENTS_EXPERIMENTS.md)：三个看板统一官方数据，支持签名授权观测、分源币种CTR/CVR/ROAS、固定匿名分组与真实统计，移除随机预测/固定提升。最新源码要求00032–00042及匹配函数，尚未部署；下文较早部署范围由此更新。

面向商家的商品脚本与 AI 短视频创作工具。当前实际连接官方 Supabase，仍依赖 Supabase Auth、数据库、Storage 与 Edge Functions。火山引擎 BaaS、Pages、ECS 和方舟已有适配与部署方案，尚未切换运行环境。

- [文档中心：需求、方案、开发、测试、运营、运维](docs/README.md)
- [当前代码与云端部署差距](docs/CURRENT_STATE.md)
- [最新技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [改造前后对比与遗漏检查](docs/ARCHITECTURE_REVIEW_20261021.md)
- [统一模型接口设置](docs/MODEL_SETTINGS.md)
- [火山引擎部署指南](docs/VOLCENGINE_DEPLOYMENT.md)
- [视频任务与积分结算](docs/API_AND_DATA.md)
- [后台调度](docs/VIDEO_SCHEDULER.md)
- [私有素材、图片恢复、剪辑与平台发布](docs/ITERATION_06_PRODUCTION_PIPELINE.md)
- [多规格事务导出、4:5与供应商退役管理](docs/ITERATION_10_RENDER_EXPORTS.md)
- [后台配音、识别、即时声纹、照片口播与口型](docs/ITERATION_11_AUDIO_AVATAR_JOBS.md)

2026-10-21 云端核验基线仍为旧部署：官方环境只有迁移到 00031 和三个已部署函数。当前源码新增了 00035/00036 私有素材与生产队列、FFmpeg剪辑、抖音/TikTok OAuth发布与官方指标，已完成本地回归；00032–00036及匹配函数、容器、平台应用仍需部署与真实联调。当前前端不能单独代表最新全栈版本可用。详见 [本轮生产链路及验证边界](docs/ITERATION_06_PRODUCTION_PIPELINE.md)。

后续源码已到00040：团队/Key/私有形象、批量事务、多规格导出和五类媒体任务均已本地交付；最新16槽与数字人后台链通过7项PG/8组协议/2组移动页面及工程检查。发布须覆盖缺失00032–00040、匹配API与生产调度，真实供应商/平台/支付/云端仍待验收。

## 技术栈

| 层级 | 组成 |
|---|---|
| 商家前端 | React 18、TypeScript、Vite、Tailwind、Radix、React Query |
| 后端 | Supabase 协议的 Auth、Deno Edge Functions、PostgreSQL/RLS/RPC；当前为官方托管 |
| 视频执行 | 数据库队列、租约、有限时长 Worker；当前官方 Cron，火山方案用 ECS Docker |
| 模型 | 统一设置页管理文本主备、七类视频、图片、TTS/ASR、网页 Reader；方舟优先 |
| 素材 | 私有 Storage、用户RLS、稳定引用与限时签名；云端待迁移 |
| 剪辑与发布 | Python/FFmpeg Worker、抖音/TikTok OAuth与发布队列、官方累计指标；云端待验收 |
| 支付 | 支付宝/微信回调验签与原子订单权益入账 |
| MCP | FastMCP，用户 JWT 复用业务 API、视频幂等提交 |

视频任务在一个事务中创建作品、预占积分和流水。成功转存后结算，确定失败按原流水退积分；未知提交结果进入核对流程。页面关闭后的处理依赖常驻后台调度。

## 本地开发

```sh
pnpm install --frozen-lockfile
test -f .env.local || cp .env.example .env.local
# 填当前目标环境的 URL 与 anon/publishable key
pnpm dev
```

前端仅允许公开后端 URL 与 anon key。模型在 `/settings/models` 统一配置；加密主密钥、支付、Worker 和 service_role 密钥配置到服务端，构建拒绝敏感 `VITE_*` 变量。设置页需要匹配的 00034 迁移和函数，首次管理员授权见模型配置指南。本地启动与无 Node 时的容器方式见 [开发指南](docs/DEVELOPMENT_GUIDE.md)。

## 验证

```sh
pnpm typecheck
pnpm test:video
pnpm test:models
pnpm test:media
pnpm test:knowledge
pnpm test:intelligence
pnpm test:payments
pnpm test:volcengine
pnpm test:finance
pnpm test:scheduler
pnpm build
```

数据库测试需要 Docker，使用隔离 PostgreSQL 与平台替身；模型协议测试不产生实际供应商用量。

## 目录

```text
src/                         商家端与业务 API 客户端
supabase/functions/          Deno 业务函数与 Provider 适配
supabase/migrations/         数据库增量变更
scripts/deploy_volcengine.py 火山部署准备、迁移、函数与 Pages
deploy/volcengine/           生产部署清单与 Secrets 模板
deploy/video-scheduler/      ECS Docker 后台调度
mcp/                        用户 JWT 的 MCP 服务
tests/                      资金、支付、视频与部署回归
docs/                       技术架构和操作指南
backend/                    历史运营后台规格，核心源码尚缺失
```

私有素材、媒体任务、多镜头配音字幕合成、两平台发布、视频分析和知识检索已有本地实现，云端与真实业务仍待验收。工单/租户策略/风险处置与人工现金账单已本地交付；告警/备份恢复、企业统一账套、自动供应商账单和更多平台继续开发。应用积分和供应商现金分开核算，收费范围见 [运营手册](docs/OPERATIONS_GUIDE.md)。

历史 [真实素材分析与高光MP4](docs/ITERATION_12_GROUNDED_ANALYSIS.md)记录私有视频抽帧/转录、版本与源指纹、真实字幕段裁剪和分镜变体。后续知识、情报、观测及编排的覆盖和发布条件统一见 [当前状态](docs/CURRENT_STATE.md)。

MIT License，见 [LICENSE](LICENSE)。
