# 可复现安装与全栈发布回执

2026-10-30新增[固定开发环境](../development/DEVELOPMENT_GUIDE.md#固定开发入口与环境矩阵)及[官方Supabase专用发布](OFFICIAL_SUPABASE_DEPLOYMENT.md)：禁网冻结构建、完整静态资源指纹、源码/前端归档SHA、四镜像实际源码核对、原迁移摘要账保护与目标运行接受。下文火山流程仍单独用于火山BaaS，不操作官方旧库。

使用 Node `22.23.4`、pnpm `10.34.5` 和 Deno `2.2.6`。前端只使用根目录 `pnpm-lock.yaml`；`archive/legacy-backend/`保留历史独立锁，不属于当前运行和安装入口。npm仅用于安装明确版本的命令行工具，不用于项目依赖安装。生产安装执行`pnpm install --frozen-lockfile`，规则工具已作为精确版本开发依赖固定在权威锁中。

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm build
deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts
pnpm test:release
pnpm test:safety
python3 tests/test_ai_requests.py
```

`pnpm build` 使用原生 ES module 配置及 Vite API；与开发构建共用插件、环境密钥检查和分包设置。该入口避免本轮本机 Vite 5 配置预打包持续等待，未跳过生产编译。构建仍需要自己的公开 `VITE_SUPABASE_URL` / anon 或 publishable key。测试里的 `fixture` 地址与密钥仅用于隔离验证。

Edge 的 `deno.json` 将 SDK 固定到 `2.103.1`，显式固定 Node 兼容类型，`deno.lock` 保留整个 npm 依赖图。部署函数时必须携带公共配置与锁；绕过锁的单文件发布不能被视作同一发布。

Python 的 `services/mcp/requirements.lock`、`services/media-worker/requirements.lock`、`infra/backup/requirements.lock` 固定完整传递图和发行包SHA-256；API复用MCP锁。镜像安装使用 `pip install --require-hashes` 并运行 `pip check`。对应 `.txt` 为直接依赖输入，不能绕过锁安装。锁由 `uv 0.9.30` 生成，目标Python3.12并包含平台条件。Docker基础镜像固定到已通过仓库核验的摘要，当前本机为arm64；CI的Edge和媒体使用arm64 runner。其他目标架构需先核对对应清单与构建，不能直接推导对等。

```sh
docker run --rm -i --entrypoint uv \
  ghcr.io/astral-sh/uv:0.9.30-python3.11-bookworm-slim@sha256:4f5d923c9dcea037f57bda425dd209f3ec643da2f0b74227f68d09dab0b3bb36 \
  pip compile --python /usr/local/bin/python3 --python-version 3.12 --no-python-downloads \
  --universal --generate-hashes --no-emit-index-url --no-emit-find-links - \
  < services/media-worker/requirements.txt > services/media-worker/requirements.lock
```

同一命令可对MCP和备份输入生成各自锁。显式使用已有解释器，避免无关解释器下载阻断锁生成。基础镜像/系统包更新时重新构建、记录最终镜像身份与系统包清单并运行协议测试；源码和Python锁不替代镜像系统包核对。Worker人物模型仍核对固定SHA-256。本机BuildKit读取元数据持续等待，本轮使用经典构建器验证相同Dockerfile与已核验摘要。四套最终镜像已完成：媒体44组及真实短成片、MCP21组/59工具、备份双PG/归档/旧库接受、调度/投递源码与probe24；ID和实际边界见[实施台账](../archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)。备份为PG16系统Python3.13.5，哈希锁安装和pip check通过；不把本机ID写成远端digest。

`python3 scripts/deploy_volcengine.py prepare --skip-build` 在 `.volcengine-build/manifest.json` 生成本地全栈回执：Git SHA、源码内容摘要、迁移、函数及共享模块、前端、Worker/MCP 源码、锁、工具目录和 render/edit 协议。包括未提交的源码内容，Git SHA 相同不代表产物相同。普通 `prepare` 还绑定目标公开配置、法律文档和前端归档摘要。

普通prepare还把release-identity.json写入前端归档，绑定Git/实际源码/Worker契约。函数或Pages发布前检查回执，源码、锁、配置或归档漂移则重新准备；Edge注入本次RELEASE_SOURCE_SHA256并与实际部署材料共同核对。目标接受见[RELEASE_ACCEPTANCE](RELEASE_ACCEPTANCE.md)，本地源码回执不替代云端迁移、最终digest、只读能力或真实业务验收。

GitHub workflow 已加入冻结安装、类型/规则/构建、API 回归、关键资金/权限/脚本SQL、Edge冻结图以及隔离Worker/MCP验证。该流水线尚未在远端运行；本地验证记录见[实施台账](../archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)。其他领域的SQL与浏览器验收仍需按变更范围运行；不得把没有运行的用例标记为通过。

# 脚本接口与尝试台账

`ai-assistant` 的 `generate_script_four_layer` 需要由调用者在首次提交前保存的 UUID `request_key`。同账号相同 key、相同规范化输入只创建一份请求和原扣费流水；相同 key 不同输入拒绝。模型结果需严格校验非空场景、顺序、整数时长、四层枚举、文本和整体提示词。

生成响应带 `request_id`，成功保存时带 `script_id`。保存故障或连接异常返回HTTP 202和`result_ready`，可使用`recover_script_four_layer`加原`request_id`恢复，只保存原结果，不再次调用模型或扣费；恢复不经过新任务限流。`started`、`unknown`、`invalid`不会因重放生成请求而调用模型。检查点错误/异常返回`result_persisted:false`及原文，调用者保留原结果等待核对。

无效结构/空正文的原结果与逐笔积分补偿在同一数据库事务保存。明确HTTP拒绝通过专用RPC检查原尝试状态后补偿；有任何`started`、`unknown`、`interrupted`或成功尝试时不能按拒绝结案。连接超时、台账结案失败、保存未知保留原回执和原流水。付费脚本与浏览器自由文本/SSE编辑是不同入口，后者保留已有原UUID保存回执。

`model_attempts`保存每次真实文本及Reader供应商尝试的账号、request UUID、配置版本、prompt/RAG版本信息、时间、供应商ID和可取得的token usage。主备共用默认60秒总预算；开始台账失败不调用供应商，结案台账失败保留`started`供核对并禁止因此调用fallback。SSE缺少正常结束或消费中断记录为`interrupted`。实际现金成本缺失保持NULL，积分和token估算不会自动变成真实现金支出。

`00064`把尝试接入运营“模型调用核对”和“待核对现金用量”。使用原attempt ID登记 `job_type:model_attempt`，供应商槽、配置版本及上游ID从原记录取得，复用原UUID、分币种整数现金、不可修改账单、冲销及当前运营范围权限。现金登记不会把受理未知改成成功，也不修改积分。版本化样本与比较工具见[模型评估](../ai/EVALUATION.md)。

图像审核保存实际读取字节的 SHA-256、request UUID和判定；审核证据写入失败不能放行。原文、JWT、API Key和完整签名URL不写入模型尝试日志。
