历史归档：正文保留原核验时点，不是v1.1.0运行或操作依据。当前入口见[文档中心](../../../../README.md)。

# 目录与技术方案优化验证

日期：2026-10-30。基线：`63ff09910869990a84f7cb4e626c602a0737e63e`。对应[综合方案](../architecture/PROJECT_ANALYSIS_AND_TECHNICAL_PLAN_20261030.md)与[目录规范](../../../../development/PROJECT_STRUCTURE.md)。

## 已实施范围

47页面按13业务域归组，文档按当前职责/历史归档组织，旧后台/API/实验与辅助工具迁移，根日志归集保留；修复源码/测试/文档/测量脚本路径、Vite/TS/shadcn目标；提取编辑共享类型，增加结构/依赖检查并接入lint/CI，调整运行指纹和Docker上下文。

仅实现本轮目录和技术基础治理，并完成技术方案/ADR。环境持久复现、实际后端上线以及大页面领域拆分为后续阶段，不记录为本轮已实现。

## 新鲜命令与证据

本机无可用的项目版本Node/pnpm命令，前端检查使用现有shoproai-web容器的Node22.23.4和项目依赖。固定pnpm10.34.5的默认源连接超时后，从npm镜像源恢复同一版本；没有修改锁或替换依赖。

| 检查 | 命令 / 实际入口 | 本轮结果 |
| --- | --- | --- |
| 受控文件保留 | 基线802普通文件→迁移清单/原路径逐项exist/hash核对 | 802文件均保留；181受控路径迁移；gitlink仍为160000 |
| 历史迁移/锁 | 68份SQL和pnpm-lock.yaml对比迁移前SHA256 | 摘要全部不变；未新增/重写数据库迁移 |
| 路由逻辑 | 将App新页面import逆映射后与 `git show HEAD:apps/web/src/App.tsx`逐字比较 | 完全相同，URL/账号/路由状态逻辑不变 |
| 日志 | 459份根log归集后逐份SHA256核对 | 全部保留，忽略目录index记录摘要；根目录项516→47 |
| 结构 | `node scripts/check_project_layout.mjs` | 最终211源码、7纯契约、112文档、862本地链接；exit0，零缺失/循环/反向依赖 |
| 门禁反例 | 只读原仓库+独立临时src，新增lib→VideoEdit页面import，再运行原检查器 | 正常夹具exit0；违规夹具exit1并明确报告两项方向错误；原源码未修改 |
| 类型 | `tsc -p tsconfig.check.json` 与 `tsc -p tsconfig.node.json` | 两项exit0；开发配置纳入实际Node类型检查 |
| lint | `pnpm lint`，隔离VITE配置 | exit0；结构、TS、Biome215文件、7项ast-grep规则、Tailwind与非压缩生产编译通过 |
| 生产构建 | `pnpm build --outDir /tmp/shoproai-layout-dist` | exit0，3861模块，4.84秒；目录外输出提示属于临时隔离路径说明 |
| 开发入口 | `pnpm dev --port 5218 --strictPort --mode layout-qa`；独立Node fetch根页/App模块 | CLI 186ms ready；独立HTTP检查exit0，两项HTTP200且App引用新的auth页面；随后停止临时进程 |
| 加载预算 | `node scripts/measure_frontend_bundle.mjs /tmp/shoproai-layout-dist` | exit0；bootstrap165,964字节gzip≤180,000；landing173,435；credits245,774；编辑/布局/数据图表不在bootstrap闭包 |
| Node回归 | 同一真实源码、Node22.23.4 + Python3.12隔离容器，逐份 `tests/*.test.mjs` | 45测试文件全部exit0、零失败文件；包括账号、任务、编辑历史/保存/时钟、模型/资金、发布/导出 |
| 发布工具 | `python3 tests/test_release_manifest.py` | 3组exit0；含新路径/共享类型/配置指纹、归档排除与漂移阻断 |
| 迁移/部署兼容 | `python3 tests/test_volcengine_deploy.py` | 10组exit0，含真实隔离PG单事务、旧回执不重放与配置/归档漂移拒绝 |
| 本地prepare | 原prepare函数使用独立临时OUTPUT、skip_build=True；check_release_receipt | exit0；66生产迁移、43入口、59MCP工具、442运行文件；archive/tools/旧api为0；没有云端调用 |
| 浏览器 | TRAE-browseruse访问隔离压缩生产预览5217，实际点击导航与表单模式 | 首页→登录/注册→邮箱登录→手机号登录正常；邮箱登录按钮启用、密码恢复入口存在；556×682零横向溢出、控制台无消息 |

本轮prepare时源码摘要为`a151a6f83b709e8239140a0db530b122216ec60486f1618eb638509965c89105`。它包含当前未提交源码；后续代码变更/正式提交需重新prepare。skip_build只核验迁移与全栈清单，不代表新的前端zip已生成或目标已接受。

## 失败与恢复记录

- 最初新增结构检查以JSON.parse读取带注释的tsconfig，发生语法错误；改为TypeScript实际配置解析后通过。
- 第一次Node全回归在纯Node镜像的Excel用例失败：`spawnSync python3 ENOENT`。保留真实OOXML断言，在已有Python媒体镜像加入同一Node22二进制、只读挂载源码、禁网执行后45份全部通过；未跳过用例。
- 一次预览CLI在只读源码上需要写Vite配置预打包文件，报EROFS；改用Vite preview API的configFile=false及已构建产物，源码仍只读。
- 开发API测试已返回根页和App模块HTTP200，但Vite.close的顶层await未结束，Node退出13；不能将该命令记录为exit0。后续按项目实际pnpm dev命令启动，186ms ready，独立HTTP检查后停止临时进程。
- 浏览器首次点击后的局部快照选择main失败，因为登录页没有main节点；一次重新快照后继续实际UI验证。未修改DOM或注入假成功。
- 首个门禁反例夹具遗漏配置和文档所引用的运行文件，正常检查先失败；改用完整只读运行/文档链接和独立src副本后，正常→违规按预期通过/拒绝。

## 结论边界

本轮验证使用隔离配置/SDK边界和真实项目代码，没有付费模型请求、真实SMS发送或支付。浏览器证明的是页面迁移、压缩产物和表单/导航状态，未重新验证真实管理员登录成功。

实际当前 `http://127.0.0.1:54321/auth/v1/health`立即连接失败（curl exit7）。旧容器仍注入该地址，持久环境修复属于方案S1。2026-10-29登录成功按历史时点保留。

本轮未重新检查云端、未部署/创建云资源、未运行远端CI；不能从本地类型/回归/包体推导生产SLA、模型质量、供应商成本或经营收益。新全栈目标仍待[发布接受](../../../../releases/RELEASE_ACCEPTANCE.md)。

## 需求核对

- [x] 全面分析现有职责、当前实现与真实限制，避免重复列已完成的可靠性修复。
- [x] 实际调整页面/旧代码/工具/文档目录，提供完整路径清单与恢复规范。
- [x] 修复相关配置/import/链接与运行指纹，补持续结构门禁。
- [x] 交付技术方案、ADR、上下文关系、责任、可逆成本、验收函数、风险和分阶段顺序。
- [x] 通过本轮类型/lint/构建/45份Node回归、发布工具/迁移兼容及浏览器入口验证。
- [ ] 实际开发环境持久复现、真实身份/目标全栈接受和大型页面领域切片：已明确列入S1–S3，不属于本轮目录交付的完成声明。

本轮工作区尚未commit/push。临时预览与验证服务在完成核对后停止，原5173前端保留。
