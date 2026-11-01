# 测试与发布接受计划

类型：how-to。读者：开发、测试与发布维护者。责任：测试维护者。核验：2026-11-01。来源：tests、package.json、scripts/test_browser_flows.mjs、.github/workflows/ci.yml和当轮命令回执。每次发布复核；只有历史证据或遗漏变更路径即过期。

## 门禁与依赖

| 门禁 | 执行入口 | 依赖与覆盖 |
| --- | --- | --- |
| 目录/文档/源码 | pnpm check:structure、pnpm typecheck、pnpm lint、pnpm build | 固定Node22/pnpm10.34.5；224模块、8纯契约、链接/生命周期、规则与生产编译 |
| Node契约 | for suite in tests/*.test.mjs; do node "$suite" || exit; done | 锁定依赖；原UUID/资金/权限/任务/页面规则；Excel往返另需Python |
| 发布闭包 | pnpm test:release | Python；新目录、指纹、静态文件、迁移/Edge/源码交付 |
| Python/数据库 | tests/test_*.py按模块执行 | Docker隔离PG；真实事务、旧库升级、幂等、账务/租约/权限/配置 |
| 媒体 | render/edit/analysis/batch/editor_audio/worker_resources专项 | 锁定Python/FFmpeg镜像与真实短素材；画面、音频、蒙版、出口/磁盘边界 |
| MCP | pnpm test:mcp | SDK/HTTPX镜像；权限、Host、身份隔离、59实际工具目录 |
| 浏览器 | pnpm test:browser | Playwright1.60.0、Chromium、5197专用配置及内存后端；不连接开发/生产数据 |
| Edge | deno check --frozen、scripts/build_self_hosted_edge.mjs | Deno2.2.6与固定依赖；43生产入口离线bundle，远程模块为零 |
| 敏感内容 | python3 scripts/check_sensitive_content.py | 无生产密钥的CI；私有初始化专项在受控环境另行检查 |

目录/源码测试先确认旧布局失败，再验证新路径。文档与CI属于交付闭包，必须通过链接与来源检查。

来源清理随 `check:structure` 检查推广/演示地址、固定账号、公开旧截图和分散旧浏览器键。`tests/project_storage.test.mjs` 验证两代前缀/旧别名、原UUID/参数、跨账号与写入失败；`tests/source_cleanup.test.mjs` 验证显式模型地址导入及410演示入口；`backend_config`与实际浏览器核对新/旧运行配置优先关系。验收状态见 [清理记录](../releases/SOURCE_CLEANUP_20261101.md)。

素材复用门禁增加35张衍生图的存在、摘要和目录完整性检查。`pnpm test:asset-reuse-ui` 覆盖1440/390/844px全部图加载、五类筛选、预览/复制/Escape/焦点恢复，以及参考、套餐、支持的登录恢复；确认参考选择未上传素材或创建任务。发布前分别核对开发、本地构建、自托管及线上载荷，证据见 [复用记录](../releases/ASSET_REUSE_20261101.md)。

## v1.2.1当轮门禁

模型页专项运行`pnpm test:models`、`pnpm test:custom-model-db`，浏览器总入口包含`browser_custom_model_settings.mjs`。覆盖13个内置入口、分类/文案、六类创建/保存/刷新、手机弹窗、失败稳定UUID重试、管理员权限、并发创建幂等、创建后修改再重试、旧版本保留与跨scope拒绝。CI显式运行版本策略与真实PostgreSQL自建配置测试。

固定提交构建后先发布，再按[本轮方案](../plan/RELEASE_V1_2_1.md)本地升级接受、ECS晋级同一载荷。三环境分别验证1440px/390px页面与实际响应摘要；线上创建SQL用事务回滚，生产不持久化验收配置，不触发付费供应商任务。成功创建/保存API的夹具覆盖与线上事务覆盖分别标明，不能把夹具结果说成生产真实写入。

## v1.2.0历史门禁

`pnpm test:browser`统一执行12组流程，包含新增图库；按钮高度、数字人工具栏、原回执恢复另作受影响专项。所有Node契约逐文件执行，Excel往返必须有Python，不得跳过。Python通过`tests/run_python_regressions.py --group host|media|mcp --output-dir <已存在目录>`分别运行；宿主组需要Docker/PG/备份镜像，媒体/MCP组使用对应锁定镜像。

本轮从最新源码重新取得lint/build、Node、Python/PG、媒体、MCP实际59工具目录、43Edge和敏感检查证据。随后开发、本地自托管、ECS分别真实登录验证桌面/手机页面、35图实际HTTPS摘要、参考/套餐/工单导航、原UUID/余额/作品和历史密钥；独立记录数据与载荷。操作和停止条件见[发布方案](../plan/RELEASE_V1_2_0.md)。下述v1.1.0数据仅为历史证据。

发布QA补充图库几何回归：在1440/390/844px核对35张参考图相互不重叠，预览操作位于完整图片下方。先复现全局32px按钮规则压缩整张卡片行高，再将图片容器与预览按钮分开布局；保留32px/44px操作目标和原预览/复制/焦点/登录流程。

## v1.1.0源码阶段证据

58组Node契约、320项Python/数据库回归（52模块，零失败/跳过）、MCP测试与59工具目录通过。媒体52项中51项首次通过；1项公开样本下载失败，经固定SHA-256样本核验后仅复验失败项通过。最终媒体回执记录首次失败与复验原因，不抹去限制。

11组隔离浏览器流程通过：模型/集成、商品、分镜提醒、页头、导航、编辑器、图片与账户；页头测量39入口、1440/1024/390/320px。类型/规则/生产构建通过，43Edge离线打包、远程模块零。源码阶段证据索引见[目录迁移回执](../development/DIRECTORY_MIGRATION_V1_1_0.md)。

## v1.1.0当轮环境接受

固定构建提交7f6b99676cf838c1e36a4d41bbaac355bbe3edc8，源码摘要8d327ae40e7469de979de7e3b53b2003fa1dfaab17fa82b62209b73b214f0e45。开发、本地自托管和ECS实际登录后各检查1440/390px下39个一级入口，共234次页头/操作区检查。商品弹窗、模型/集成刷新、无内容草稿静默、有内容草稿恢复与浮层关闭、导航键盘和剪辑均通过，页面错误及失败响应为零。

本地11、ECS26健康服务；各环境原账号UUID、余额、完成任务、私有视频字节与摘要、JWT、历史密钥、容量均与升级前相同。每环境5个加密快照对象认证通过。两架构各1151个交付文件，唯一预期差异为runtime-images.json；各11个原生镜像和26个执行源码文件独立核验，241个实际挂载载荷文件、9个实际HTTPS文件与固定交付一致。

本地首次备份使用新目录脚本恢复旧SOURCE_DIR时，旧Compose路径不匹配导致服务中断；恢复旧交付后原数据复核通过，再以旧交付脚本备份并完成新版本升级。此问题和正确操作顺序已写入[升级恢复手册](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)。本轮认证快照材料，未重新执行全量新卷恢复演练。发布、下载核验和历史清理结果见[正式回执](../releases/V1_1_0_EXECUTION_20261101.md)。

固定构建的云端前端/API和Edge通过；初次媒体CI暴露干净临时目录缺失，标签浏览器暴露瞬时提醒断言问题。测试脚本与隔离夹具另提交修正，已部署生产实现不变；复现、覆盖、版本边界和云端跟踪见[CI修正回执](CI_GATE_CORRECTIONS_20261101.md)。最终报告记录实际最新主线CI运行，旧失败记录保持。

## 环境接受

1. 从固定Git提交核对源码摘要、版本、依赖锁与架构镜像中的真实Python源码。
2. 分别捕获本地与ECS原账号UUID、权威余额、原完成任务、私有成片字节/SHA256、JWT/历史密钥摘要、容量和挂载，生成新的加密快照。
3. 先本地升级，再用同一前端/Edge晋级ECS。执行self_hosted.py check；核对67生产迁移摘要（最新00069）、43入口、Auth/RLS/Storage、probe24/render4/edit2及11/26健康服务。
4. 各环境真实登录后检查工作台、商品、分镜、模型接口、第三方集成、剪辑与运营；桌面/手机分别检查页头和控件，不用静态截图替代交互。
5. 比较HTTPS实际文件与冻结载荷、公开release-identity.json及原业务数据；保持线上16渲染器和原容量。失败停止后续晋级与清理。
6. GitHub发布独立读回标签/提交/附件摘要后清理更早历史，再复核健康与原数据。

生产check只运行技术接受，真实业务写入测试限新隔离实例显式SELF_HOSTED_ISOLATED_ACCEPTANCE=true。不向生产注入资金/负载夹具。历史100人压测和新卷恢复见归档；本轮只核对原容量与恢复材料，未重新测量商业质量、SLA或RPO/RTO。

关联：[需求](../prd/PRD.md)、[升级恢复](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)、[当前状态](../CURRENT_STATE.md)。
