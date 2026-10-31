# 测试与发布接受计划

类型：how-to。读者：开发、测试与发布维护者。责任：测试维护者。核验：2026-11-01。来源：tests、package.json、scripts/test_browser_flows.mjs、.github/workflows/ci.yml和当轮命令回执。每次发布复核；只有历史证据或遗漏变更路径即过期。

## 门禁与依赖

| 门禁 | 执行入口 | 依赖与覆盖 |
| --- | --- | --- |
| 目录/文档/源码 | pnpm check:structure、pnpm typecheck、pnpm lint、pnpm build | 固定Node22/pnpm10.34.5；220模块、8纯契约、链接/生命周期、规则与生产编译 |
| Node契约 | for suite in tests/*.test.mjs; do node "$suite" || exit; done | 锁定依赖；原UUID/资金/权限/任务/页面规则；Excel往返另需Python |
| 发布闭包 | pnpm test:release | Python；新目录、指纹、静态文件、迁移/Edge/源码交付 |
| Python/数据库 | tests/test_*.py按模块执行 | Docker隔离PG；真实事务、旧库升级、幂等、账务/租约/权限/配置 |
| 媒体 | render/edit/analysis/batch/editor_audio/worker_resources专项 | 锁定Python/FFmpeg镜像与真实短素材；画面、音频、蒙版、出口/磁盘边界 |
| MCP | pnpm test:mcp | SDK/HTTPX镜像；权限、Host、身份隔离、59实际工具目录 |
| 浏览器 | pnpm test:browser | Playwright1.60.0、Chromium、5197专用配置及内存后端；不连接开发/生产数据 |
| Edge | deno check --frozen、scripts/build_self_hosted_edge.mjs | Deno2.2.6与固定依赖；43生产入口离线bundle，远程模块为零 |
| 敏感内容 | python3 scripts/check_sensitive_content.py | 无生产密钥的CI；私有初始化专项在受控环境另行检查 |

目录/源码测试先确认旧布局失败，再验证新路径。文档与CI属于交付闭包，必须通过链接与来源检查。

## v1.1.0源码阶段证据

58组Node契约、320项Python/数据库回归（52模块，零失败/跳过）、MCP测试与59工具目录通过。媒体52项中51项首次通过；1项公开样本下载失败，经固定SHA-256样本核验后仅复验失败项通过。最终媒体回执记录首次失败与复验原因，不抹去限制。

11组隔离浏览器流程通过：模型/集成、商品、分镜提醒、页头、导航、编辑器、图片与账户；页头测量39入口、1440/1024/390/320px。类型/规则/生产构建通过，43Edge离线打包、远程模块零。证据索引见[目录迁移回执](../development/DIRECTORY_MIGRATION_V1_1_0.md)；这些结果不等于线上升级已完成。

## 环境接受

1. 从固定Git提交核对源码摘要、版本、依赖锁与架构镜像中的真实Python源码。
2. 分别捕获本地与ECS原账号UUID、权威余额、原完成任务、私有成片字节/SHA256、JWT/历史密钥摘要、容量和挂载，生成新的加密快照。
3. 先本地升级，再用同一前端/Edge晋级ECS。执行self_hosted.py check；核对66迁移摘要、43入口、Auth/RLS/Storage、probe24/render4/edit2及11/26健康服务。
4. 各环境真实登录后检查工作台、商品、分镜、模型接口、第三方集成、剪辑与运营；桌面/手机分别检查页头和控件，不用静态截图替代交互。
5. 比较HTTPS实际文件与冻结载荷、公开release-identity.json及原业务数据；保持线上16渲染器和原容量。失败停止后续晋级与清理。
6. GitHub发布独立读回标签/提交/附件摘要后清理更早历史，再复核健康与原数据。

生产check只运行技术接受，真实业务写入测试限新隔离实例显式SELF_HOSTED_ISOLATED_ACCEPTANCE=true。不向生产注入资金/负载夹具。历史100人压测和新卷恢复见归档；本轮只核对原容量与恢复材料，未重新测量商业质量、SLA或RPO/RTO。

关联：[需求](../prd/PRD.md)、[升级恢复](../deployment/SELF_HOSTED_ECS_RUNBOOK.md)、[当前状态](../CURRENT_STATE.md)。
