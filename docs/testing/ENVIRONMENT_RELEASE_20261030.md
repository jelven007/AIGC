# 开发环境与全栈发布验证

日期：2026-10-30。当前HEAD `63ff09910869990a84f7cb4e626c602a0737e63e`，本轮修改未提交/推送。最终源码摘要`7d07ec30a21baa113c1b2c23653a5fe49b286a0a762329cf4d18b6cbeacabe24`，正式全栈尚未部署。

| 验证 | 实际结果 |
| --- | --- |
| 持久开发 | dev_environment.py/固定Compose/TRAE Run，Node22.23.4、pnpm10.34.5；Auth health200，5173 healthy |
| 真实会话 | 已有admin原账号登录、本人profiles读取；刷新及容器重启保持；最终浏览器有admin/退出按钮，无登录表单 |
| 启动修正 | 首次Corepack可启动但嵌套脚本缺pnpm shim；start_development_web.sh增加corepack enable，当前容器修复后lint通过 |
| 新鲜lint | 结构/TS/Biome/rules/Tailwind/独立非压缩构建通过；215文件零修复 |
| 发布回归 | test_release_manifest 3通过；test_volcengine_deploy 10通过；test_deploy_supabase最终9通过，含源码归档漂移拒绝 |
| 真实迁移保护 | 独立PG16：可信00065基线追加00066–00068；预检后原账摘要变更时整个事务拒绝，未追加任一迁移 |
| 旧任务与完整接受 | test_release_acceptance的实际PG升级和HTTP接受3通过，保留原UUID/UNKNOWN/一次扣费；test_final_contract 2通过；夹具production_accepted=false |
| 官方生产构建 | 固定Node digest、禁网、离线冻结安装、TS、全新目录构建；66迁移/43入口的官方包已生成 |
| 归档完整性 | 493源码文件逐个SHA与manifest匹配；前端归档/实际目录/identity一致；数据库密码/PAT/service_role/Worker秘密值扫描零匹配 |
| 镜像源码 | scheduler3/renderer13/MCP9/backup72，共97文件SHA核对；四镜像arm64，仅本机Docker可用 |
| 静态运行 | 只读/非root/禁网Nginx：配置通过、本次identity一致、/video/create直接路由返回index、隐藏文件拒绝；未暴露宿主端口 |
| 生产Compose | web/scheduler/maintenance/renderer/mcp五组件config通过，全部只读；未启动生产执行 |
| 原云端预检 | deploy_supabase.py preflight返回Management401，现存SUPABASE_ACCESS_TOKEN失效；没有执行迁移/函数写入 |
| 常驻主机 | 继承2026-10-29ECS记录：118.196.122.161，Dev密钥root/ubuntu被拒绝；本轮没有新的有效主机身份 |

首次新增PG测试观察到entrypoint临时数据库启动阶段，local socket短暂就绪后关闭。测试改为127.0.0.1 TCP检查正式postgres进程后通过；生产迁移SQL未为此失败修改。独立快照测试还确认macOS的/var临时路径解析为/private/var，规范化根路径后最终9项通过；实际云端写入消费逐文件校验的归档，不从长时间可变工作区读取。

产物位于`.supabase-build/<上述SHA>/`：manifest、source.tar.gz、frontend.zip、frontend目录。源码归档SHA `7798059f8a5690f3509f75797da83db8a368b8f7bd5f74a24e357ec50f8a2220`；前端归档SHA `2ab3811999ccc51d650962a91e7b5afe0df9ddd1a2871cef7c41484cc47865db`。正式目标接受需恢复管理访问、核对原SQL/迁移账和备份，再部署匹配函数/前端/唯一调度/媒体/MCP及真实权限恢复。旧报告或本地夹具不能代替云端回执。

[官方部署入口](../releases/OFFICIAL_SUPABASE_DEPLOYMENT.md)、[当前状态](../CURRENT_STATE.md)、[环境矩阵](../development/DEVELOPMENT_GUIDE.md#固定开发入口与环境矩阵)保持当前事实；CI已加入官方部署回归但远端尚未运行。
