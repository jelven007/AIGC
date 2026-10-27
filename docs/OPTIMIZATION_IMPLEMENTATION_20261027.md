# 全面优化实施与验证记录

依据：[2026-10-25 优化方案](PROJECT_ANALYSIS_OPTIMIZATION_20261025.md)。实施起点 `a7cf94e`。本轮用户授权“参考上述方案，全面优化”，按方案完成可在本地实施和验证的代码、配置、工具及文档；目标云端升级、真实平台/支付/模型接受和生产容量仍需真实环境证据。

## 实施范围与进度

| 编号 | 工作 | 状态 |
| --- | --- | --- |
| A1 / F01 | 审核严格类型/一致性、授权图片实物与视觉能力 | 本地回归通过；已接入request与图片hash持久审核证据 |
| A2 / F02 | 脚本结构校验、原请求/模型结果回执、保存恢复 | 本地10组接口/8组PG通过，含未知/明确拒绝/空结果/保存及检查点异常 |
| A3 / F03 | 配音及其他异步入口固定原账号、回执与迟到结果 | 已接入领域接口与重点页面；身份10组、跨标签浏览器4组通过 |
| A4 / F04 | 外部模型限流依赖故障不放行 | 已修复，本地回归通过 |
| B1 | 统一锁与依赖、可复现 CI、全栈发布清单 | 冻结pnpm/全部Edge/Python哈希锁、最终lint/完整prepare与四镜像源码核对通过；远端CI未运行 |
| B2 / F05 | 同步模型每次尝试/配置版本/usage与成本台账 | 同步文本/Reader/主备预算/运营成本与32例工具通过；真实供应商账单与质量评估待目标接受 |
| B3 | 本地迁移/匹配版本与发布工具验收，真实目标接受单列 | 真实00065→00068发布事务、原UNKNOWN/UUID/一次扣费及6项只读HTTP接受通过；正式目标未执行 |
| C1 | 调度与维护隔离、持久公平预算、分层能力探针 | 00065预算/独立维护已实现；最终00068/probe24、知识/告警能力2组、PG6组/入口隔离4组/调度13组通过；最终调度镜像已核对，真实吞吐待目标测量 |
| C2 | 共享任务查询、可见性/终态策略、持久回执 | 核心及商品/知识/情报/批量/发布/导出已接入；身份10组、查询7组及浏览器专项14组通过，最新命令exit 0 |
| C3 | 媒体去重/空间预算/退出恢复、MCP运行约束 | 最终哈希锁镜像已构建；44组受限媒体/真实成片、21组MCP及59工具通过；最终新鲜19组资源/出口与成片再次通过 |
| D1 | 剪辑与首页按业务状态/副作用拆分、交互验证 | 已落地有界历史/工程读写/恢复/时钟/缓存及首页业务Hook；11组Node、9组新浏览器及原流程回归通过 |
| D2 | 可复现数据库/知识容量基线、据测量优化 | 真实约束1/5/10账号与20样本通过，精确检索P95约1151→424–460ms；原权限/引用/升级及商品游标回归通过 |
| D3 | 外部告警/异地恢复工具与演练、主文档状态收敛 | PG4组、真实本地Relay6组/入口权限、加密上传/拉回3组及双PG恢复3组通过；最终镜像/主文档/模板已核对，真实目标单列 |
| S1 | 版本化密钥与可验证轮换、受控网络出口 | 历史全用途预检/完整目录备份恢复/Edge↔Python互通通过；最终媒体镜像44组含真实TLS及短成片通过；最终备份镜像含全用途凭据和归档恢复通过 |
| E1 | ECS部署选择及对等运行指南 | RELEASE_ACCEPTANCE.md已交付托管/ECS运行与全栈对等组件、迁移和接受指南；未采购/部署真实资源 |

默认保留现有托管基础服务契约与独立媒体执行，不采购云资源，不改变历史迁移，不把未知供应商受理当作失败。每项关键行为先使用真实代码路径建立失败回归，修复后运行同一用例，再扩大相关验证。文档与可直接验证的配置不添加镜像实现的测试。

## 验证证据

实施后逐项记录命令、结果、数量与边界。本页“待实施”不能解释为已完成；真实外部环境和生产指标也不从本地结果推导。

下列验证按阶段保留；早期“进行中/待核验”只代表当时状态，当前进度以顶部范围表及最后的收敛记录为准。

### 首阶段已验证

- `node tests/ai_safety.test.mjs`：原实现5组失败 → 修改后5组通过。覆盖审核字符串/冲突/缺字段、空输入、授权图片字节和SHA-256、无视觉能力/非法图片/无权限、持久限流错误/异常零供应商调用。
- `node tests/frontend_identity.test.mjs`：原实现首5组失败；扩展商品/JSON正文场景2组失败 → 当前7组通过。固定请求JWT、上传身份、返回解析阶段与原回执。
- `node tests/ai_billing.test.mjs`：7组通过，保持缓存、限流、逐笔补偿和账号/团队预算拒绝。
- `node tests/model_settings.test.mjs`：9组通过，保持配置加密/版本、拒绝内网和图片协议。
- `npm run typecheck`：通过。
- `node tests/browser_media_jobs.mjs`：390px工作台原UUID失联/刷新恢复、私有上传、识别、克隆授权、未知状态与页面错误检查通过。
- `node tests/browser_profile_scripts.mjs`：4组通过，跨标签账号切换/旧响应隔离、资料/头像、SSE脚本与原保存、首页分镜/批量入口。
- `node tests/browser_edit_analysis.mjs`：3组通过，原字幕/节拍任务恢复、应用去重与390px界面。

浏览器插件工具不可用，使用已有Playwright和本机Chrome；缓存headless-shell发生按钮稳定性及截图超时，改用Chrome后原用例通过，未降低断言。截图保存在本地忽略目录 `.volcengine-build/`。临时5197测试服务已停止。

当前 shell 无 Node 命令，验证使用已安装的 Node 22.23.4（通过PATH引用）。首阶段生产构建未通过：Vite配置加载超时，原node_modules混有`.deno`、npm与pnpm目录。之后保留旧目录到忽略的诊断备份并重新安装。原生esbuild transform/bundle及环境加载均可运行，干净依赖下Vite5配置预打包仍持续等待；将同一生产配置改为原生ES module，通过Vite API加载后生产构建通过。未跳过插件或密钥检查。

### 发布与同步文本阶段

- `node tests/script_result.test.mjs`：2组原缺失校验失败 → 当前通过，覆盖空内容/非法场景与正确原输出。
- `python3 tests/test_ai_requests.py`：原4组缺失RPC失败；新增编辑器字段兼容用例原失败 → 当前5组通过。真实迁移/资金/权限、并发同请求只扣一次、保存事务故障恢复同script UUID、原尝试/usage验证。
- `node tests/model_attempts.test.mjs`：原4组失败 → 当前通过。开始记录先于真实fetch、记录失败零fetch、结案失败保留待核对、SSE结束与并发身份。
- `node tests/ai_safety.test.mjs` 5组、`node tests/ai_billing.test.mjs` 7组在接入后通过。
- `python3 tests/test_release_manifest.py` 原2组失败 → 清单加入后通过；`python3 tests/test_volcengine_deploy.py` 10组通过，包含真实空PG事务。
- `npm run build` 与 `npm run typecheck` 已通过。pnpm新增工具后的冻结安装已通过；完整lint、Deno冻结类型图及全量领域回归继续核验，最终以最新命令为准。
- 后续新鲜验证：`pnpm lint`（197源文件Biome、全部ast-grep规则、Tailwind及生产编译）通过；`deno check --frozen --config supabase/functions/deno.json supabase/functions/*/index.ts` 全部入口通过；原资金体系 `python3 tests/test_finance.py` 33组通过。
- 扩展真实脚本接口异常回执用例原返回500丢失原请求 → 修改后保留request UUID/unknown且重放零模型调用，`ai_safety.test.mjs` 当前6组通过；同轮 `ai_billing.test.mjs` 7组通过，最新ai-assistant冻结类型检查通过。
- 新迁移 `00063` 兼容现有编辑器实际使用而历史表缺失的 `title/pain_points/full_content` 字段；旧数据保留。新增服务专用原请求/模型结果事务和独立模型尝试表，未改历史迁移。

安装过程中发现 `.npmrc` 的 npm `package-lock=false` 会被pnpm解释为禁用其权威锁，已移除并重新从原锁增量更新与冻结验证（最终锁新增91行，保留原依赖版本）。Deno2.2.6自动Node类型未被cache首次纳入锁，已按冻结检查实际要求将隐式与显式specifier固定到同一22.12.0及已验证integrity，全入口冻结检查通过。Docker版Deno在本机挂载下持续等待已停止，无遗留容器，改用同版本原生Deno；不将运行中/缺锁的检查视作成功。说明与入口见[可复现发布文档](REPRODUCIBLE_RELEASE.md)。

### 恢复、成本核对与依赖收敛

- `node tests/ai_safety.test.mjs`当前10组通过：新增Reader两次真实尝试、保存错误/连接异常原结果恢复、检查点故障原文保留、网络未知禁止退款、明确拒绝及空正文补偿。每项新增行为先失败再通过。
- `python3 tests/test_ai_requests.py`当前8组通过：无效结果+原流水事务补偿/并发只补偿一次、未知尝试不能按拒绝补偿、实际attempt现金登记/冲销/运营范围、原script UUID恢复与编辑器兼容。
- `model_attempts.test.mjs`4组、`text_attempts.test.mjs`2组、`ai_billing.test.mjs`7组通过。主429备成功两条同request尝试；15ms测试预算耗尽后调用数由2变1，原请求记unknown。
- `operations_workflows.test.mjs`原4组及新增attempt入口通过；`test_operations_workflows.py`9组通过，保持旧现金/团队/工单/权限。
- 移除旧`xlsx`及未使用的直接`zod`，动态导出使用精确`write-excel-file@4.1.1`。`excel_export.test.mjs`2组通过，真实OOXML验证中文、长编号、公式仅为文本、未知值与5万行；超预算/非法数字在压缩前拒绝。
- `browser_measurements.mjs`2组及`browser_operations_workflows.mjs`3组通过：本机Chrome/390px，真实Excel下载核对CVR/ROAS，原实验和运营UUID恢复、权限与现金指纹保持。临时预览服务结束阶段停止。
- `ai_evaluation.test.mjs`3组、32例样本校验和生产共用脚本解析2组通过；不将fixture、未人工核对事实、未知现金计为真实质量接受。
- pnpm替换导出依赖后的冻结安装通过；完整lint（含生产编译）和全部Edge冻结图通过；随后Reader/拒绝分支新增修改将继续做最终检查。
- Python全传递哈希锁由`uv 0.9.30`生成；无关解释器自动下载曾等待，明确指定容器已有解释器后全部生成。三个镜像改用`--require-hashes`和`pip check`；MCP本机经典构建器已成功，最终媒体/备份产物和协议测试仍待本轮构建完成。
- BuildKit对旧摘要和当前标签摘要都停在metadata；独立`imagetools inspect`已确认原固定摘要有效，因此沿用原基线，使用本机经典构建器验证，不把无输出的等待视为构建成功。
- 最新恢复/Reader修改后`pnpm lint`再次通过（198个Biome源文件、类型、ast-grep、Tailwind和生产编译）；全部44个Edge入口`deno check --frozen`再次通过；发布清单2组及部署工具10组通过。
- 媒体/备份APT的HTTP下载较慢，停止本轮构建，改为HTTPS和有界超时；最终镜像随C3/D3修改后重建并核验。MCP新锁镜像本地ID为`sha256:25e147b905750094e23911bfefc329d1b45494f8e24b6051a46fc2b9d86907b7`，不是远端仓库digest。整仓只读挂载的MCP测试未返回，停止后改用复制必要文件的隔离容器，不视旧等待为通过。临时5197服务已停止。
- 新锁MCP镜像复制必要源码后`test_mcp_backend.py`16个真实SDK/身份测试通过，`export_tools.py --check`59个工具一致。所有本轮临时测试/构建容器已清理；本轮无预览服务或构建任务留在运行。
- 全部`tests/*.test.mjs`39个文件新鲜执行通过。旧knowledge/volcengine流式替身未返回新begin/finish回执，完整回归先发现503；按真实RPC契约补齐，并增加原知识版本、账号及SSE取消/正常结束断言后全量通过，没有放宽生产台账门禁。
- 最新优化生产包`build_frontend.mjs`通过（5.23秒）；导出专用动态入口71,700字节/gzip约19,830字节，替代原xlsx约429kB。静态启动闭包gzip165,890字节，通过已有180kB预算；不从静态包体推导LCP、INP或真实网络收益。

### 执行与维护隔离

- 新行为先失败：`worker_isolation.test.mjs`原生产入口因维护故障503；`test_worker_fairness.py`原5组缺持久配额/能力RPC；`test_video_scheduler.py`新增独立维护和轻量ready原3组失败。实现后入口4组/能力probe通过，调度13组和发布工具10组通过。
- `00065`保留全部原任务领取/结案函数，增加服务专用到期快照、20类加权持久预算、全局8/普通6/单类2配额，资金保留2机会；未知任务不进入新生成快照，原预占/原供应商核对继续保留。
- PG最新6组通过：12个并发请求普通额度最多6且资金可再领取2；150次连续分配覆盖20类、最大间隔23次；过期与旧令牌fencing、维护失败退避、字段/价格缺失的完整能力提示、空/UNKNOWN快照。旧Cron4组继续通过，不从机会测试推导生产等待秒数。
- 探针契约改为`00065/probe23/render4/edit2`。原46项串行读取合并单能力RPC，保留字段、价格、原业务schema函数和权限语义；运行ready一条RPC，alive零数据库调用。发布和调度客户端已同步，生产入口冻结Deno类型图通过。
- 维护从`run`移出，独立进程/单项全局租约/持久退避与健康状态；运行说明见[WORKER_SCHEDULING.md](WORKER_SCHEDULING.md)。真实编排批次用`request_payload.pipeline`识别，已加入原批次启动回归；全栈最终类型/镜像/兼容及主文档随后统一验证。
- 批次启动到期快照新增断言原失败（只返回video）→修复后`test_batch_pipeline.py`全部8组通过，保留原阶段/资金/未知/暂停/取消；生产管理入口新增用例原未启动维护→当前2组通过。Compose生产profile结构验证通过，管理脚本预检成功后同镜像启动/停止两个进程，旧视频模式继续单进程。

### 前端共享查询与持久回执

- `taskQueries.ts`使用账号级QueryClient，列表共享、详情拿到job ID后统一同一key；创建/刷新结果更新详情与列表缓存。每个client/key只有一个轮询计时器，错时挂载也不增加轮询；活跃10秒、未知/错误30秒，终态停止，隐藏暂停并取消在途读取，重新可见/联网/聚焦立即回源。
- 图片/视频Hook、剪辑分析、媒体工作台、视频分析与任务中心已接入；价格独立缓存5分钟，声音撤销等待删除只查询原声纹状态。导出记录已接入同一策略，源作品列表分开缓存，不再每10秒重复读取作品。
- `taskReceipt.ts`写后读回检测静默丢弃，读取校验结构；读写/清理失败显示错误，未能保存完整原请求时不调用创建API。已发送但响应未知继续复用原UUID，账号变化不当作明确拒绝。Hook保留本地存储错误，需恢复存储并重新加载再核对。
- `frontend_identity.test.mjs`新增取消回归原失败（已取消请求仍发出）→当前8组通过；`task_queries.test.mjs`5组通过，覆盖真实API并发去重、详情/列表一致、存储满/静默丢弃/损坏，以及错时挂载、隐藏10分钟和重新可见。最新类型检查、11文件Biome及`git diff --check`通过；隔离生产包构建通过。
- 旧构建运行`browser_task_queries.mjs`原2组失败：空任务中心60秒有21次任务读取（首3次+18次重复），存储满时未显示回执错误。新构建2组业务断言通过：60秒仅首3次，隐藏10分钟零新增；图片回执存储满零创建调用，错误可见。此为本地时钟/API夹具请求数，不是生产网络或体验指标。
- 最新`browser_task_center`6组、`browser_edit_analysis`3组、`browser_production`3组、`browser_media_jobs`2组、`browser_video_analysis`2组业务断言均通过。剪辑创建503后可立即查询恢复；测试先核对实际503响应，再刷新/应用核对原请求和去重，未删原资金/工程断言。
- 上述浏览器进程退出后被工具沙箱标记失败：系统Chrome触及自身Crashpad/RLZ目录，改用独立测试Chrome并关闭崩溃报告后仍触及`Chrome for Testing/Crashpad/settings.dat`；不能把这些命令写为exit 0。已安装headless-shell的正常click稳定性等待超时，未用force或跳过断言。截图文件已保存，但本轮查看图片工具返回403，尚未完成新截图人工视觉核验。
- 商品导入/翻译、知识、情报、批量与发布剩余共享查询/回执边界、导出接入后的新鲜浏览器回归和最终全栈验证继续执行；C2整体尚未完成。

### 前端领域入口收敛与新鲜验证

- 商品提取/翻译、知识、情报、批量与发布接入共享QueryClient及可见性调度。领域最近记录使用独立的账号/类型子集key，避免从全局最近30条过滤导致漏任务；创建和详情刷新只更新匹配类型的缓存。发布页面与任务中心共用包含任务及组的同一读取，账号及成片目录独立缓存5分钟，不再每15秒全部重读。
- 翻译价格、批次模型与报价、知识目录使用独立缓存。知识任务终态变化后才刷新索引目录；情报快照须包含监控状态，按下一采集时间安排30秒至5分钟的检查。真实正在处理10秒，未知受理/错误30秒，已暂停及等待人工预览的静止批次零自动轮询；同一列表包含真实活跃任务时仍10秒。
- 批量任务从会话存储改为可校验的持久存储，已有完整旧会话回执先写入并读回后才清理；商品事务/提取/翻译、知识、情报、发布沿用原UUID和完整正文。存储读取、写入、静默丢弃或清理失败均可见。商品与批次接口新增原账号和取消信号；情报JSON解析后再次确认原会话，已取消读取不会发送网络请求。
- `frontend_identity.test.mjs`新增领域取消/情报及批次原账号用例原失败→当前10组通过；`task_queries.test.mjs`新增批次/监控、领域子集和视频未知受理间隔用例原失败→当前7组通过。超出最近20条的翻译深链接原只读一次→接入同任务ID详情轮询后浏览器自动完成用例通过，不重建任务。
- `node --test tests/browser_domain_queries.mjs tests/browser_task_queries.mjs`最新14组、0失败、exit 0：知识/情报/批次/发布空任务60秒无重复任务与目录读取，隐藏10分钟无新增；图片、视频、商品提取/翻译、知识、情报、批次、发布存储满零提交且错误可见；旧翻译详情自动更新。发布旧构建在60秒仍重复读取，翻译旧构建没有可读的存储错误，两个原症状均先失败后通过。以上为隔离API与本地时钟测量，不推导生产等待时间或网络收益。
- 最新`browser_products`3组、`browser_translation_notifications`4组、`browser_knowledge`1组、`browser_intelligence`1组、`browser_batch_video`2组、`browser_publish_groups`4组、`browser_render_exports`2组、`browser_task_center`6组和`browser_profile_scripts`4组均exit 0。保留原商品版本、原语言/主图、旧单账号发布action、单项取消、原批次预算和脚本引用断言。批次新增核对持久正文，清空sessionStorage后刷新仍恢复原UUID，确认后清理localStorage。
- `browser_batch_pipeline`2组exit 0：真实FFmpeg MP4夹具、存储失败零创建、原预算/UUID恢复、成片/发布原标识、实际剪辑轨道与9:16保存刷新通过。本机挂载大诊断目录的FFmpeg命令未返回并已停止；改为容器输出媒体字节后写本地夹具，未删真实媒体或工程断言。存储恢复后先重新加载核对，再继续新提交。
- 最新全部41个`tests/*.test.mjs`文件执行通过（Node汇总73个测试/0失败）；`pnpm lint`通过202个Biome源文件、类型、ast-grep、Tailwind和生产编译；隔离生产包构建通过。当前原生测试Chrome的上述浏览器命令均正常exit 0，之前Crashpad沙箱失败保持为历史失败证据。翻译与编排390px截图已经实际查看，文字、按钮、结果及边界均可读，无横向溢出；不再沿用此前图片查看403作为本轮限制。

### 媒体任务空间与 MCP 运行约束

- 新任务空间回归原6组失败/1组缺取消参数错误；实现后继续补齐并先失败验证执行期磁盘、阻塞蒙版、工作目录锁、真实SIGTERM、逐块上传、总蒙版预算与外部伪存储路径。最新 `test_worker_resources.py` 14组通过：只缓存当前任务同一可信后端对象，流式SHA-256归并，外部URL保留参数，部分输入删除，输入/输出/蒙版预留与高水位、预算超量杀子进程、停止后不读取下一上传块、原job/lease归回retry、孤儿清理与另一进程拒绝、停止/过期不就绪。
- 任务缓存、预处理子进程与健康状态拆到独立模块；合成、抽帧、音轨、蒙版共用执行期空间/取消检查。独占工作目录取得锁后才清理残留。Compose使用专用磁盘bind和64MiB `/tmp`，保留4GiB内存/2CPU/256PID；不再用4GiB tmpfs存素材。上传/结案已开始后的未知结果归回原任务核对，不因停止、连接异常或结案响应丢失认定明确失败。
- 完整真实Worker测量先发现原 `out_time_us=N/A` 转整数异常，原分镜回归准确复现 `ValueError`；修复后保留有效进度/时长/缩略图并完成原租约。新增 `measure_media_worker.py` 使用原Worker入口、真实FFmpeg、固定同一MP4的8个裁剪轨道；下载/上传/租约为本地夹具，零外部调用。
- 同Linux镜像测量：历史源码下载8次/17,389,184字节，任务空间高水位17,814,444字节，在N/A处中止；当前下载1次/2,173,648字节，高水位2,631,956字节，实际2秒/1280×720成片420,373字节并原lease完成。成片SHA-256 `27853d12e9ea0adb2bd7d84622afae113a5ce385513b1e9d5450c00ebaf6c272`。旧失败结果被工具显式标为 `legacy_progress_error`，不作为成功、耗时或内存改善基线。
- 最新受限容器验证exit 0：网络关闭、非root、只读、专用测试磁盘、4GiB/2CPU/256PID/64MiB tmpfs；14资源 + 13渲染 + 5音轨/人物模型 + 2视频分析 + 2编排 + 3音效，共39组通过，并运行真实Worker测量完成成片。该测量Python RSS高水位44,588KiB、子进程492,392KiB、1.876秒；是固定短素材的单次本机值，不是长素材容量或P95。测试磁盘卷已删除。
- MCP新增正文/健康/并发/慢请求4组原失败；最新 `test_mcp_backend.py` 21组及 `export_tools.py --check` 59工具通过。每进程16活跃请求/同凭据4请求、256KiB正文、10秒读取、165秒工具预算；超量/异常释放预算与原身份，零自动重发。HTTP原无状态业务契约及19权限不变。Compose 384MiB/1CPU/96PID、只读/32MiB tmpfs及日志轮转。
- 新锁MCP镜像本地ID `sha256:a2178676e7fe17f85d2a008bd0de983852762f81990c78d0af8b3e03d85a4bd5`，21组在该镜像非root/只读/关闭网络/384MiB下再次通过。真实Uvicorn受限启动，`/healthz` 200且无业务调用、无凭据`/mcp` 401；SIGTERM有完整lifespan关闭，子进程按Uvicorn标准返回-15。第一次人工检查误要求信号退出码0失败，纠正为明确的SIGTERM退出，不称第一次命令通过。
- 媒体API/编辑/分析/MCP权限/能力/执行隔离6个Node文件最新exit 0；真实PG `test_edit_jobs.py`7组及 `test_video_analysis.py`5组通过；Python编译、两套Compose模型及 `git diff --check` 通过。未改render4/edit2、原工程和租约API。说明见 [媒体与MCP资源边界](MEDIA_WORKER_RESOURCES.md)。
- 媒体完整新锁镜像仍在本轮经典构建器下载APT依赖，已检查是实际HTTPS包下载，不是无输出挂载等待。构建起点快照早于最后取消/预算修复，完成后必须更新隔离构建上下文并重建，再在新锁镜像复核39组/真实测量；现有媒体回归只证明当前源码配已安装基线镜像，不能写成最终新锁镜像已接受。
- 后续构建已完成：早期快照 `09ec2c8788b8` 之后复制当前源码并重新构建，最终本地镜像ID `sha256:f18ecc2c6f987ce97971b9ea00c561f72cbb4afca1ca6e9a7b06616757e0eb61`。实际从镜像 `/app` 加载测试，主入口SHA-256 `907b82760d0fbbc726682ca05475fa13c368c2bc7054ca9cc66dd3f62203437c` 与当前文件一致；非root/只读/关闭网络/4GiB/2CPU/256PID/64MiB tmpfs、专用磁盘约束保持。
- 新镜像首次14组资源和13组渲染全部通过，整批命令因漏打包人物原图片、关闭网络时下载失败退出1；不将首次整批计为成功。补入原本地图片且保留SHA-256断言后，5人物/音轨+2分析+2编排+3音效共12组 exit 0，全部39组已在同一最终镜像完成；`pip check` 无破损依赖。没有重复运行已通过的渲染组或放宽人物断言。
- 同镜像真实Worker测量 exit 0：一次下载2,173,648字节、高水位2,631,956字节、原job/lease完成、成片420,373字节/2秒/1280×720；输出指纹与前轮一致。当前短夹具耗时1.469秒、Python RSS45,008KiB、子进程537,268KiB；这些仅是同固定负载本机值。测试容器和磁盘卷均已清理，镜像ID不是远端仓库digest。

### 剪辑状态与首页业务副作用

- `editorHistory.ts/useEditorHistory` 以纯状态转移替代两个历史监听 effect 和全量 JSON 比较：空工程保留首个撤销基线，最多100次操作，未改片段对象结构共享，新编辑清除重做分支；滑块指针手势在结束时只提交一次，取消恢复原值。旧隔离构建实际复现新工程首次撤销无响应，当前同一浏览器用例通过。
- `editorProjects.ts/editorPersistence.ts/useEditorPersistence` 统一固定原JWT的工程读写、所有权和原ID核对、取消与串行保存；只有恢复结束后才能自动保存。完整画幅、滤镜、变换、音量、所选片段统一恢复，空本地轨道不会退回旧媒体。旧构建恢复9:16草稿后保存实际变为16:9，当前原用例保留9:16及130/70/20属性。300ms本地合并写、2500ms数据库保存，离页立即刷新原账号草稿；读写失败可见，不覆盖无法读取的草稿。
- 新工程在发出创建请求前保存完整正文和客户端UUID。响应丢失后同UUID `ignore-duplicates` 先核对原工程，再只更新编辑字段；已有成片状态/原生成规格保持服务端数据。真实浏览器503→刷新→恢复包含两次同UUID创建尝试、一个工程和原字幕；存储满零创建/更新。原账号迟到结果拒绝，跨账号工程界面清空并保留原账号草稿。
- 自定义分析/录音轨道保存后立即刷新继续保留应用标记。新串行保存回归曾发现完成阶段把已保存自定义轨道的本地草稿覆盖为旧快照，原字幕重复应用测试再次失败；修正后保留新轨道，`browser_edit_analysis` 原3组再次通过，没有删除去重断言。
- `useEditorClock/editorClock.ts` 单独管理媒体时钟、裁剪/变速换算、60帧游标与100ms React同步；`useEditorMediaCache` 仅在素材URL集合变化时预加载，复用已有有界缓存和账号/离页清理。播放、属性与字幕预览保持原工程协议。390px截图发现两层85%限制使字幕宽度仅88.86px（画布209px），实际浏览器先失败；修正显式字幕宽度、按画布缩放字号与移动播放控件位置后，原拖动/撤销/重做/预览用例及截图通过。
- 首页拆成 `useReferenceMaterials`、`usePromptAssistant`、`useWorkspaceModels`：参考素材恢复与上传保留原登记回执；两处录音共用当前页面实例，流式增强失败保留原输入；模型目录与价格按原账号缓存5分钟，并使用真实目录名称。ASR新增显式原账号，录音权限迟到/离页/账号切换均释放麦克风。`useWorkspaceEntry` 保留路由输入的原账号边界；批量工作台按账号重建，商品选择使用领域API并取消已关闭的读取。
- 数据库阶段交叉核对发现商品接口实际每页上限100，选择器迁移后的200条单页请求会被真实接口拒绝；浏览器夹具加入同一分页校验后先失败，改为100条的两页加载后原9组编辑状态和两个批次流程再次通过。保留“最近200条”的界面约定，未扩大服务端单页限制。
- `node --test tests/editor_state.test.mjs` 11组通过，含500次编辑有界/共享、连续手势、JSON解析期间身份变化、取消零读取、队列失败不阻塞、损坏存储、麦克风许可迟到、ASR原账号和创建丢失。`node --test tests/*.test.mjs` 最新42个文件、汇总84测试、0失败、exit 0。
- 最新 `browser_editor_state` 9组 exit 0；原 `browser_editor_assets`4组、`browser_edit_analysis`3组、`browser_batch_video`2组、`browser_batch_pipeline`2组、`browser_profile_scripts`4组、`browser_render_effects`1组、`browser_render_exports`2组通过，保留真实MediaRecorder、FFmpeg媒体、原资金/任务/字幕/工程断言。Playwright配本机Chrome；截图实际查看1280×900和390×844，字幕可读、控件无横向溢出。此前三次夹具同步/属性恢复/立即刷新回归失败保留为诊断记录，不计为通过。
- 最新 `pnpm lint` exit 0，包含214个Biome源文件、完整类型/规则/Tailwind及生产编译；隔离生产构建与 `git diff --check` 通过。不从操作数或本机截图推导生产INP、LCP或CPU收益。临时5197服务在本阶段结束时停止。

### 数据库容量与稳定分页

- 新增`measure_database.py`执行真实PG16和全部截至指定版本的生产迁移，保留2CPU/2GiB、每账号2,000商品/200知识、每条24块/1,536维。1/5/10倍按账号数扩大，不关闭容量触发器。生成实际行数、迁移摘要、镜像、空间、整批写入、完整EXPLAIN/BUFFERS、函数签名/权限/静态调用/锁语句和真实`pg_blocking_pids`等待证据；结束只删除自身容器。
- 首轮00065报告`database-before-20261027.json`发现约1156–1269ms精确检索，包含一次短时间并行PG回归，保留为诊断而不用于最终收益。之后两个工具串行独立执行，每组首样本外再取20个温缓存样本，同一PG镜像和固定数据；正式证据为`.volcengine-build/database-before-exclusive-20261027.json`及`database-after-20261027.json`，均exit 0。
- 00065→00066检索P95分别为：1账号1151.539→459.841ms，5账号1150.699→424.041ms，10账号1151.746→428.979ms；降幅约60%–63%，全部低于本地500ms预算。当前知识目录P95为3.325/3.542/3.874ms。未新增向量、trigram或产品索引；产品SQL最大P95为0.755ms，原深页/游标10账号0.517/0.244ms，低于200ms预算。
- 新增账号整批写入墙钟中位数3.9665→4.3085秒，约增加8.6%；48,000分块实际总空间677,683,200→677,961,728字节。保留写入/空间代价，不把短数据SQLP95推导为生产API/冷缓存/高并发容量，亦不从物理页分配推导精确每行新增成本。
- `00066`预存分块范数、单次查询范数与MATERIALIZED评分；保留精确float8、owner/版本/维度/正文hash过滤，稳定最佳分块/引用排序，空limit在扫描前拒绝。`test_knowledge_capacity.py`校准夹具后原2组真实失败→当前3组通过；原`test_knowledge.py`7组继续通过。`test_database_upgrade.py`1组在真实00065数据上应用新迁移，原分块/UUID/hash/旧结果与权限保持。
- 商品`list`增加可选时间倒序游标，微秒/UUID完整保存，非法字段或混用OFFSET/价格排序拒绝；后续页不重复精确计数，旧OFFSET兼容。`product_pagination.test.mjs`原2组失败→当前2组通过，覆盖同时间戳/新商品插入/他人归属/非法参数。原`test_products.py`7组及`products.test.mjs`原协议回归通过；批量页面最近两页共200条改用该游标。
- 最新`browser_batch_video`2组/`browser_batch_pipeline`2组exit 0，选择器实际显示101个不同商品、仅两次读取并传回完整游标，原UUID/预算/取消/真实多镜头/9:16工程保持。首次使用精确文本定位时嵌套分类导致用例等待超时，改为实际具备唯一名称的checkbox并滚动验证；未更改商品展示或放宽101数量/请求断言。390px选择器及原批次截图已实际查看，控件和文字可读、无横向溢出。
- 最新214源文件`pnpm lint`（完整类型/规则/编译）、分页与模型设置两个Edge冻结图、发布清单2组、独立生产包和`git diff --check`通过。资金锁样本真实阻塞后释放并完成一笔原扣费；全部静态锁路径和测量边界见[数据库容量文档](DATABASE_CAPACITY.md)。临时5197服务已停止，只有原4个K8s容器保留。

### 版本化密文（S1进行中）

- 新写入使用`v2.key_id.iv.payload`，AES-GCM AAD同时绑定版本、key_id和业务用途。`MODEL_CONFIG_KEYRING`一次指定当前加密ID、历史ID/密钥；未配置目录时兼容原单主密钥并标记`legacy`。原两段密文按明确legacy_key_id读取，新密文只按原ID，缺失、篡改或目录错误拒绝，不试用其他密钥。
- `keyring.test.mjs`原4组失败→当前4组通过，包含主密钥切换、原无版本/原ID读取、相同原始密钥下篡改ID、平台/Measurement用途绑定、不完整目录与无敏感错误。原模型设置9组、音频入口1组、发布组及Measurement接口回归通过；涉及密钥的Edge冻结图通过。
- 尚需完成全部历史密文轮换预检、Python备份/恢复的新版目录与密文支持及受控出口验证。当前S1不记为完成，最终全栈清单与主文档将在剩余阶段统一收敛。

### 历史密钥预检、完整目录恢复与可信出口

- Python工具支持原两段与`v2`密文，严格绑定版本/key_id/业务用途、12字节IV和规范base64。新`key-preflight`动作通过只读REPEATABLE READ、服务器游标流式验证所有历史模型版本、平台应用、连接token和app_snapshot、过期/已用OAuth快照以及停用Measurement源；结果仅含计数与key_id，不回传明文/密文。
- 备份加密完整`model_keyring`及选配旧单主密钥；两者并存时校验legacy键一致。恢复按原归档计数/摘要字段兼容旧format=1，同时校验新版各表/各key_id凭据。原任务密文与UUID不可变，不以当前活动键替换历史凭据。配置/操作步骤见[密钥轮换](KEY_ROTATION.md)。
- 双PG16真实备份先在新版密文上准确失败`historical_model_key_decryption_failed`，完成后3组恢复回归exit 0：8条跨用途凭据（old=5/current=3）、完整目录、原unknown/reserved/charge_id与同request_key重放、对象HTTP上传下载、篡改与错目标/非空环境拒绝。第一次新fixture遗漏模型配置预期版本被事务冲突拒绝，修正fixture后才建立上述实际失败，不计为功能失败基线。
- `node tests/keyring_interop.mjs`直接执行实际Edge加密函数与Python反向加密，原两段/v2、Unicode AAD、ID/密文篡改及双向认证均exit 0。原4组Keyring、9组模型设置、1组旧音频、发布组与Measurement接口保持通过；CI已接入目录/恢复/出口入口，未在远端运行。
- Worker新增`EgressClient`：默认仅信任原后端域名，外部CDN精确`RENDER_MEDIA_HOSTS`列表；上传/租约仅原后端。HTTPS443、证书/Host/SNI、无环境代理/无跳转，新socket只连接已核验公网数字地址，拒绝任一内网/保留/IPv4映射IPv6或空DNS答案。5组出口回归包括实际本地TLS服务器、错误域名证书失败和302不跟随，不访问外网或引入生产内网开关。
- 最终媒体镜像ID`sha256:24d627a7082594325f9b942513f6aad9dd6635379c52f58f48a4feb66d516e1f`，镜像内main指纹`e2fc5f7ef54fbcfef525cd70ec24a70102109b93a08e84cb294fcd38c096c2cf`、egress指纹`dddbeb0ff6fe78fd9e767efc5977a0f5b0aa018c6e480d6215e56adeaec052b6`与源码一致。实际从/app读取，非root/只读/关闭网络/4GiB/2CPU/256PID/64MiB tmpfs/专用磁盘/去全部cap验证44组及pip check全部exit 0。最初误用64MiB tmpfs执行资源回归导致空间预留拒绝，按正式专用磁盘后14组通过；未降低空间或上传断言。真实TLS初次夹具引用锁版本已移除的Requests属性失败，核对实际2.32.5证书路径后通过。
- 同镜像真实短成片测量exit 0：一次下载2,173,648字节、高水位2,631,956、原job/lease完成、输出420,373字节/2秒/1280×720，成片指纹仍为`27853d12e9ea0adb2bd7d84622afae113a5ce385513b1e9d5450c00ebaf6c272`。本次1.460秒、Python RSS45,024KiB、子进程526,868KiB只表明固定本地负载，不推导生产容量/外部接受。测试容器、专用卷和临时材料已删除，原4个K8s容器保留。
- 以上S1初次演练使用之前备份镜像配当前源码；后续最终镜像已在下节重建并接受。真实服务密钥轮换/CDN及宿主出口仍须目标环境验收。

### D3、B3与最终发布契约

- `00067`持久投递按原事件/渠道唯一，90秒租约、原幂等键、严格回执、30秒至1小时退避；扫描未建回执的全部事件避免晚提交时间游标遗漏。PG4组先红后绿。`alert_delivery.py`及通用密钥专用入口通过真实本地Relay6组和Node入口权限回归；错ID/302不确认，离线原UUID重试、未确认超过100条完整保留，只裁剪已确认历史并保持单调版本。未发送正式外部消息。
- `backup_archive.py`只归档认证密文，确定性对象路径与原ID/摘要回执，流式上传/拉回、大小/摘要/全部密文认证及安全tar。3组传输回归先红后绿。最终双PG恢复从真实本地网关拉回，原UNKNOWN/预占/一次原扣费、Storage实物、3模型版本/8条历史跨用途凭据、原告警/投递回执全部保持。
- `00068/probe24`保留原能力校验并加入范数/告警字段和投递RPC；2组缺失/权限回归先红后绿。调度/发布工具共享JSON契约。`prepare`完整构建加入前端公开发布身份，Edge完整探针可报告所部署的源码摘要；源声明还必须与真实部署产物共同核对。
- `accept_release.py`的真实00065→00068事务升级和本地HTTP/CLI接受3组通过；原任务UUID、配置与一次原流水不变，错源码、公开桶或迁移漂移不就绪。66生产迁移摘要一致；六项只读技术检查通过仍明确`production_accepted:false`。ECS对等与真实目标入口见[发布接受](RELEASE_ACCEPTANCE.md)。
- 最终备份镜像ID`sha256:b9425255d1bdf07f319cfe3558dfb6249fd9dbaf39044c6c3b68fa78cbeda8e0`，非root65534/只读/关闭网络/256MiB/64PID检查与pip check通过，实际Python3.13.5（PG16的Debian系统解释器）。基础PG缺CA导致最初HTTPS失败；HTTP引导下载持续等待已停止，改用固定Python镜像的CA信任文件完成HTTPS构建。Python完整哈希锁成功安装，PG工具保持16。本机镜像ID不是远端仓库digest。
- 镜像内`backup_restore.py`=`1239f9f7e7cc39cceb2c777b0df4e22774d0cfc9a7b7f20d1e54fc3076ad1e94`，`backup_archive.py`=`a9ff5cfd4ac5b761ac76a594a319ac9060cc5d3950cdbba330c8d60d7957cf0b`，`accept_release.py`=`8a0fae5cd8ac7a1157e9be785d5e0f1a48559da504109a35c9c5a1b4a774ed89`，均与当前源码实际SHA一致，镜像含68迁移。最终镜像上重跑双PG/归档/旧库接受全部exit 0；恢复一次固定小样本0.943秒不能外推生产RTO。
- 最终调度/投递镜像ID`sha256:e8da0b8a887fb1229fdc6c9c9e2c64057e2e330013f2dc4a02276871343599ff`，65534/只读/无网络/128MiB/0.25CPU/64PID实际导入通过，镜像内run脚本`96312a72b52b4db9766573aeb6023ab24a456efe0eb15789ffe068ffa1e1b8a5`和delivery脚本`4952b1edf918371ee973d0d42bed0077e2f4c5a9c52264c68128268ac3c6ce21`与源码一致，实际契约00068/probe24。生产容器启动、正式告警/归档、Auth/Realtime及商户/供应商回执仍需目标接受。

### 最终源码与主文档收敛

- 当前状态、根README、文档中心和架构/接口/开发/测试/运营/运维/部署/产品/资金/演示/追踪共30份修改或新增Markdown核对566个本地链接，0缺失；唯一跨文件锚点通过。主操作统一00068/probe24、68文件/66生产迁移、43生产入口；2026-10-22/25报告和迭代记录保留历史时点。本轮未重新访问云端、未commit/push。
- 最终冻结安装先完成460依赖/原生插件，但退出时写pnpm全局临时目录被沙箱拒绝，不能计为通过。首次替代误用了不支持的CLI选项退出1；改用工作区PNPM_HOME/XDG_DATA_HOME和store-dir后`pnpm install --frozen-lockfile`新鲜exit 0，14.6秒，未变更依赖锁。core-js安装脚本继续按白名单忽略，不影响原生编译校验。
- 最终`node --test tests/*.test.mjs`首次发现旧text_attempts夹具对未知环境变量返回fixture，新keyring严格解析拒绝；夹具只提供真实已配置的变量后45文件/91测试/0失败、exit 0。最终`pnpm lint`exit 0：214个Biome源文件、完整类型/ast-grep/Tailwind/生产编译；全部44个Edge入口`deno check --frozen`exit 0。未削弱生产密钥目录校验。
- 普通prepare使用明确隔离HTTPS后端/publishable key与法律夹具执行完整typecheck/build，exit 0；439运行源码文件摘要`649245aab24c7db0302dd82062fcd74baf2da87f2edaeaa9384695595fd8e8ac`，66迁移/43入口。ZIP及dist内release-identity.json逐字段与本次Git/源码/Worker契约相等，归档SHA-256`c507995bc1678182d3cf9ad5400773d77fec9a760f10ec65879da74bdcd0acae`、44,879,720字节；包含原有public高分辨率素材，不等同页面初始下载。`measure_frontend_bundle.mjs`启动静态闭包gzip165,971字节，低于180,000预算；不推导真实LCP/INP。
- 发布清单3组/部署10组、调度13组/管理2组、真实本地Relay6组新鲜exit 0；最终备份镜像再次运行双PG恢复3组、加密传输3组、真实00065→00068接受3组均exit 0。恢复保留原UNKNOWN/预占/原扣费ID、3模型版本/8历史跨用途凭据/实物/原告警回执；一次小样本0.793秒不推导生产RTO，技术接受仍`production_accepted:false`。
- 四套镜像实际读取/app，逐文件对比当前媒体11、MCP7、备份3、调度2个Python源文件全部一致。最终媒体非root/只读/关闭网络/4GiB/2CPU/256PID/64MiB tmpfs与专用盘下资源14组/出口5组及真实短成片新鲜exit 0；一次下载2,173,648字节/高水位2,631,956、原job/lease结案，输出420,373字节/2秒/1280×720、摘要仍`27853d12e9ea0adb2bd7d84622afae113a5ce385513b1e9d5450c00ebaf6c272`。本轮并行其他QA时3.942秒/RSS45,000KiB/子进程555,744KiB，非独占容量基线。受限MCP21组/59工具及pip check、实际Edge↔PythonAAD/legacy/v2互通新鲜exit 0。
- 最终31套真实PG领域回归串行完成，224测试/0失败、exit 0：资金、身份、脚本、告警、批次/编排、支付/退款、商品/翻译、知识旧库升级、素材/媒体/剪辑、情报/观测、运营、奖励/权益及持久公平预算；各套件日志位于忽略的`.volcengine-build/final-test_*.log`。不累加以前版本的重复测试，不连接真实目标。
- Compose三模型/模板JSON结构与`git diff --check`通过。Ruby解析命令无输出等待后停止，误选未安装yaml包的替代命令失败；使用现有js-yaml实际解析CI三job/超时/40位Actions固定版本通过，远端流水线未运行。
- 最终浏览器初次20脚本有38/40汇总通过，两项旧夹具失败且Chrome外部Crashpad/Downloads被沙箱拒绝，整批不计为通过。修正实际目录默认模型名、PostgREST单对象价格，以及原503后立即共享查询恢复的旧瞬时alert断言；保留真实HTTP503/原UUID/原价格/模型/单次创建及恢复按钮断言。首次目录隔离复测遇到产品页load超时，改等DOMContentLoaded并继续断言实际业务控件。
- 工作区浏览器运行包装统一关闭Crashpad、隔离下载与CFFIXED_USER_HOME，未变更权限或系统HOME；领域回执/图片编辑两脚本13汇总测试新鲜exit 0，其余18脚本27汇总测试新鲜exit 0，最终20脚本/40汇总测试/0失败。覆盖剪辑/录音/字幕、首页账号、批次/多镜头、媒体、商品/翻译/通知、生成/任务中心、逐账号发布、多规格/效果、测量/真实导出与运营；保留原工程/UUID/价格/模型/预算/迟到隔离与实际FFmpeg/MediaRecorder断言。
- 桌面1280×900与390×844剪辑、390px图片掩码截图已实际查看，字幕/控制/价格/错误状态可读、无横向溢出。前端ZIP静态边界193项核对通过，只有公开发布身份和构建产物，未打包服务端配置/源码。
- 最终本地证据汇总为`.volcengine-build/final-verification.json`及对应final-日志；标记isolated_fixture、production_accepted=false、remote_ci_executed=false。预览服务已停止、5197端口释放，测试容器/专用媒体卷已清理，Docker仅保留原四个K8s容器。浏览器收集子进程退出前后按名称/工作目录核对，不使用已失效的PID误杀其他进程。

本轮交付：A1–A4、B1/B2、本地B3、C1–C3、D1–D3、S1以及ECS对等指南的可本地实施项全部落地并完成上述验证。正式B3目标部署、Auth/RLS/Realtime运行、真实模型/商户/平台/SMS、外部值班送达、独立故障域定时恢复与生产容量仍需目标回执；本轮未采购、部署、发送正式消息或commit/push。
