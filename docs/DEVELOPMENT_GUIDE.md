# 开发指南

更新：2026-10-21，源码基线 `ce90bfe`。先读 [当前状态](CURRENT_STATE.md) 与 [PRD](prd/PRD.md)。本地源码比当前官方 Supabase 云端新，启动前端成功不代表新版接口已部署。

## 1. 环境与首次启动

推荐 Node.js 22+、pnpm 10.34.5、Python 3.12、Docker Compose、Git；Edge Functions 使用 Deno，当前验证使用 Deno 2.2.6。数据库隔离测试依赖 Docker PostgreSQL 16。包版本以 [package.json](../package.json) 和锁文件为准。

从仓库根目录执行：

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

复制配置仅用于首次初始化；已有 `.env.local` 时直接编辑，保留目标环境配置。浏览器使用 `http://localhost:5173`；Auth 站点和重定向地址必须允许该地址。

前端仅配置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。anon/publishable key 是公开客户端凭据，访问权限依赖 Auth、GRANT 和 RLS。模型 Key、service_role、Worker、支付私钥和加密主密钥只进入服务端；构建会拒绝敏感 `VITE_*KEY/SECRET/TOKEN/PASSWORD`。

没有本机 Node 时可用开发容器：

```sh
docker run --rm -it -p 127.0.0.1:5173:5173 \
  -v "$PWD:/app" -w /app node:22-alpine \
  sh -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm dev'
```

容器和宿主若架构不同，不共享安装后的 `node_modules`；安装依赖应在实际执行环境进行。本轮测试使用 Node 20 Alpine，补装其 arm64/musl 原生依赖后构建通过，不代表必须降级开发环境。

## 2. 后端初始化

| 环境 | 管理工具与入口 | 注意 |
| --- | --- | --- |
| 当前官方 Supabase | 官方管理面及受控迁移流程，[部署记录](DEPLOYMENT_AIGCP.md) | 已到 00031，00032–00034 与配套函数尚未发布 |
| 火山 BaaS Supabase 版 | `byted-supabase-cli`，[火山指南](VOLCENGINE_DEPLOYMENT.md) | 独立 workspace/branch；不能沿用官方管理令牌或推断已迁移 |
| 隔离测试数据库 | `tests/test_finance.py` 创建 PG16 与平台替身 | 不提供真实 Auth、Storage SDK、PostgREST 或云端函数运行环境 |

新库按顺序执行生产迁移，排除 00018/00019 演示数据/访问策略。已有库只应用核对后缺失的迁移；不把全量迁移和 `schema.sql` 再跑一次。火山脚本使用私有 SHA-256 回执，拒绝自动重放没有该回执的旧业务库。

新版模型服务要求 00034、`MODEL_CONFIG_ENCRYPTION_KEY`、匹配的函数与共享模块。通过 Auth 管理面授权真实管理员后，在 `/settings/models` 配置接口；不能通过 `profiles.role` 或 `user_metadata` 提权。完整步骤见 [模型设置](MODEL_SETTINGS.md)。

访问控制增量要求00037及 `api-keys/team-space/material-assets`，业务Key入口与production Worker同步更新。团队成员/Key不能再从Data API直接写入；素材删除使用持久化outbox，客户端统一 `src/api/accessControl.ts`。专项入口 `npm run test:access`，页面夹具 `tests/browser_access_control.mjs`；兼容与网关要求见 [访问控制迭代](ITERATION_08_ACCESS_CONTROL.md)。

批量增量要求00038、batch-video-jobs和匹配共享视频Worker，客户端 `src/api/batchVideoJobs.ts`。父子创建/套餐/价格/预算统一事务；暂停与取消用父锁，已提交不停止查询。调用端不得直接写批次表；专项 `npm run test:batch`，页面夹具 `tests/browser_batch_video.mjs`，见 [批量迭代](ITERATION_09_BATCH_VIDEO.md)。

多规格增量要求00039、production-jobs与更新的FFmpeg镜像；沿既有production调度。客户端createRenderExport只提交源作品ID/规格/原UUID，禁止先写占位作品。共享队列配额/旧回执兼容见 [迭代10](ITERATION_10_RENDER_EXPORTS.md)。专项 `npm run test:exports`、`npm run test:render`、`tests/browser_render_exports.mjs`。`npm run lint`要求PATH可找到ast-grep；缺工具或规则失败会终止，不再记录为通过。

媒体增量要求00040及匹配production-jobs/production-worker/model-settings，16槽包括D-ID/Sync/ElevenLabs；新types为tts/asr/voice_clone/avatar/lipsync，统一原流水计费、版本、租约和证据。客户端MediaJobsPanel及原services/audio调用后台任务，先持久化原UUID/确认价格，503不换键；旧同步入口410。专项`npm run test:media`和`tests/browser_media_jobs.mjs`，完整协议、声纹版本、输入/响应限制与真实验收见 [迭代11](ITERATION_11_AUDIO_AVATAR_JOBS.md)。

## 3. 目录与修改位置

| 目录 | 职责 |
| --- | --- |
| `src/pages`、`src/components` | 页面、业务交互、生成任务恢复和模型设置 |
| `src/db`、`src/lib` | Supabase 客户端、任务 API、模型目录及输入转换 |
| `supabase/functions/_shared` | 身份验证、协议、配置加解密、计费补偿、视频状态处理 |
| `supabase/functions/*/index.ts` | HTTP 入口；输入/身份校验与业务调用 |
| `supabase/migrations` | 递增数据库迁移、权限、资金事务、队列与配置版本 |
| `supabase/ops` | Cron 安装、状态与停用脚本 |
| `scripts`、`deploy` | 发布预检、后台调度、Docker 与配置模板 |
| `mcp` | 共用用户 JWT 与业务 API 的 7 个工具 |
| `tests` | 真实事务、受控上游协议、调度与发布回归 |
| `backend` | 缺少核心源码；不作为现有可运行后台 |

## 4. 实现约束

- 关键财务与视频状态只走服务端 RPC；Data API CRUD 同时核对显式权限和 RLS。不接受客户端传来的退款金额、用户 ID 或终态作为证据。
- 新视频使用显式 UUID 幂等键；同一逻辑请求重试复用键和全部参数。创建响应丢失先找回，不能换键重提。
- 配置保存追加不可变版本；新任务事务绑定版本。改账号、停用或换 Key 不改变旧任务；主密钥轮换需专门密文迁移。
- Worker 一次有限处理，不在 Edge Function 内持续轮询。上游 POST 受理未知时暂停核对；查询/转存错误重试，明确失败才退款。
- 用户界面如实区分排队、生成、待核对、成功、退款。模拟数据不能包装成真实模型、真实销量或已发布结果。
- 添加供应商时新增/扩展协议适配器并验证素材、规格、ID 和失败语义；修改地址本身不能兼容新协议。
- 日志使用任务 ID、订单号、配置版本和错误分类，不输出 Key、JWT、私钥、上游完整正文或私有素材。

## 5. 检查与变更交付

```sh
npm run typecheck
npm run test:finance
npm run test:payments
npm run test:video
npm run test:models
npm run test:scheduler
npm run test:volcengine
python3 tests/test_mcp_backend.py
npm run build
git diff --check
```

MCP 测试先在虚拟环境安装 `mcp/requirements_mcp.txt`。Deno 检查从仅挂载 `supabase` 的运行目录执行，避免根目录 npm 配置干扰。`npm run lint` 包含历史 `.rules` 工具和固定路径，不能据类型检查通过宣称整个 lint/CI 已通过；本轮执行范围见 [验证报告](TEST_REPORT_20261021.md)。

涉及 API/状态/权限/收费变更时同步 [接口与数据](API_AND_DATA.md)、[测试计划](TEST_PLAN.md)、[运维手册](RUNBOOK.md) 与 [追踪矩阵](CHANGE_TRACEABILITY.md)。提交说明用中文概括实际变更，先本地提交，远端名称与内容确认后再推送。

## 6. 发布顺序

先保存数据库/Storage/密钥恢复材料并记录版本，再冻结新生成入口、停止后续调度并等待在途请求结束。应用核对后的新增迁移，部署匹配的函数与共享模块，配置 Secrets/管理员/模型版本，绑定核对过的旧任务，执行只读 probe 与隔离权限检查，恢复一种调度器，完成真实业务验收后发布前端。

不单独部署依赖新 RPC 的前端，不将函数 `version:1` 或健康检查结果当作 Git 提交证明。不可变配置与新增数据库字段优先向前修复；回滚函数前核对签名兼容性，不能删除任务、资金流水或旧密文。
