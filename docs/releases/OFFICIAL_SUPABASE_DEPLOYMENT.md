# 官方Supabase全栈发布

更新：2026-10-30。目标是原项目`bbqqhkukgbgpebqpesub`，不使用火山CLI操作官方旧库。开发环境已经固定并验证登录；当前Management401，ECS历史Dev密钥无法登录，全栈尚未上线。执行流程已由用户授权，本页不增加批准步骤。

## 本次候选包

```sh
python3 scripts/bootstrap_supabase_cli.py  # 本机macOS arm64；固定官方2.122.0及包SHA-512
python3 scripts/deploy_supabase.py prepare
```

prepare使用固定Node镜像、当前开发命名依赖卷，在禁网容器冻结离线安装/类型检查并构建到新目录。输出`.supabase-build/<实际运行源码SHA256>/`，包含`frontend/`、`frontend.zip`、`source.tar.gz`、`manifest.json`。普通旧dist和Git HEAD不代表这批未提交改动。指纹包含首页、图片/字体、脚本、Compose、运行锁及全部生产SQL；包不包含真实环境文件、数据库密码/管理令牌、service_role或Worker密钥。相同源码目录拒绝覆盖，复制到目标后应继续使用同一个前端归档。

manifest记录Node镜像digest、禁网冻结安装、前端归档和源码归档SHA、43入口/66生产迁移、完整probe24/render4/edit2、四镜像实际运行文件SHA和image ID。当前四镜像均arm64且仅在本机Docker存在；需取得主机架构后选择导出加载同一镜像，或在匹配架构构建并重新核对/生成对应候选。local标签及源码包不证明服务器镜像已加载。

## 恢复目标管理与核对原账

原`.env.deploy.local`权限0600且Git忽略，包含原项目ref/URL、管理令牌及服务器凭据。恢复有效`SUPABASE_ACCESS_TOKEN`后运行：

```sh
python3 scripts/deploy_supabase.py preflight --release .supabase-build/本次SHA
python3 scripts/deploy_supabase.py plan --release .supabase-build/本次SHA
```

官方管理API先验证项目身份，读取函数/原官方迁移历史及`shopro_deploy`源码摘要账，不打印原响应中的秘密。公开配置必须与当前原项目匹配。预检和每步写入结果分开存到`.supabase-build/receipts/<本次SHA>/`，失败不记为部署完成。

原库历史成功基线为00031，可能没有完整源码摘要账。plan遇到业务表或原迁移历史却无摘要账会明确阻止重放。恢复访问后读取历史实际SQL、与原源码/结构核对并备份，再登记可信基线；不能仅按版本号或迁移名称伪造SHA。本次没有运行这个登记，也没有重建原身份、清空库或从00001重放。

## 追加迁移与函数

已核对可信摘要基线且保存本次原目标备份后：

```sh
python3 scripts/deploy_supabase.py migrate --release .supabase-build/本次SHA --backup-file /受控目录/本次原目标备份
python3 scripts/deploy_supabase.py functions --release .supabase-build/本次SHA
```

迁移账必须是生产迁移的完整前缀，任何未知版本、SQL摘要变化或断档都拒绝。PG事务内加锁，再比对预检原账，应用缺失SQL并写摘要；并发漂移中止整批。备份SHA和每步回执留存，但备份文件存在不等于目标恢复演练已接受。此入口使用独立源码摘要账，不与未经核对的`supabase db push`混用。

函数使用官方CLI2.122.0的API构建部署，固定manifest43生产入口及JWT例外；逐文件验证源码归档后从独立快照部署，长时间发布中工作区修改不能混入。共享模块和deno锁来自该快照。部署前核对加密主密钥/完整历史目录存在，保留原值；不会自动生成新密钥覆盖历史任务。原VIDEO_WORKER_SECRET和本次源码声明写入服务端Secrets，不把service_role打包到前端。函数逐项记录目标version；续跑仅跳过当前ACTIVE、版本/JWT及本次回执匹配的入口。全部ACTIVE仍需独立只读接受，源码声明自身不证明真实部署代码。

## 常驻全栈运行

[生产Compose](../../deploy/production/compose.yaml)统一静态前端、生产调度、独立维护、FFmpeg与MCP。静态服务镜像固定digest，前端和MCP默认只绑定本机8081/8082，由目标HTTPS反向代理接入。执行服务全部只读、非root、去能力、限制CPU/内存/PID并配置停止宽限；告警卷和媒体专用磁盘持久保存。

将[运行模板](../../deploy/production/runtime.env.example)复制为`runtime.env`并设置0600；填写本次release目录、匹配镜像ID/目标digest、公开URL/anon和专用媒体磁盘。专用Worker密钥单独写到`RUNTIME_SECRETS_DIR/video_worker_secret`，普通文件0600。不得加入PAT或service_role到运行env。

2026-10-31新增：填写`MCP_ALLOWED_HOSTS`为代理实际保留的精确Host及需要的端口，包含本地`127.0.0.1:8080`。空值、URL、通配符、非法端口或缺正式Host均被启动前拒绝。真实代理认证initialize需独立接受，healthz只证明进程。本次MCP含新增host_config，旧镜像不可沿用；生成新候选后核对实际镜像ID。正式Compose的operations profile可单独启动共享原spool的投递，步骤见[运行接受清单](../operations/OPTIMIZATION_ACCEPTANCE_20261031.md)，不另起另一套调度。

使用[只读接受](RELEASE_ACCEPTANCE.md)得到真实原目标回执。配置中的`environment`必须为`official-supabase-bbqqhkukgbgpebqpesub`，`isolated=false`；目标前端须已在受控入口提供本次identity。完整六项检查通过后，回执以0600保存到`deploy/production/acceptance.json`：

```sh
python3 scripts/production_runtime.py check
# 先实际查询并确认旧Cron/旧主机派发停止：
python3 scripts/production_runtime.py start --old-dispatch-disabled
python3 scripts/production_runtime.py status
python3 scripts/production_runtime.py stop
```

check/start验证源码归档、实际前端与归档逐文件相同、运行脚本/Compose指纹、镜像ID、24小时内的原目标接受回执，再发无任务副作用的production-worker完整probe。原目标、源码、迁移或协议不匹配时不启动调度；启动禁止临时构建或拉取漂移镜像。`--old-dispatch-disabled`只记录维护者已核实的事实，不会替代真实Cron查询。停止不删除卷、媒体或原任务。

实际部署还需有效SSH用户名/已绑定密钥及HTTPS入口。现有ECS记录没有成功登录，不能据本机容器配置声称服务器已经部署。正式模型/商户/平台、身份回跳及邮件/SMS、外部告警、异地恢复和容量按实际启用范围验收。

## 验证与回滚

`python3 tests/test_deploy_supabase.py`真实PG验证可信00065基线追加三迁移及并发原账漂移整批拒绝，另验证错目标、无摘要旧库、断档、夹具/过期接受不能启动。`test:release`核对指纹/静态资源和原火山工具；`test:acceptance`保留原UUID/UNKNOWN/一次扣费并检验完整接受。

上线后核对真实登录、跨账号RLS/Realtime、私有上传/读取/清理、原任务重启恢复和运行镜像/资源。异常先停新领取，保留在途/UNKNOWN/原流水；回到最后经原目标接受的前端/函数包。数据库追加迁移不倒删，恢复必须从已验证隔离备份按原UUID/密钥目录执行。当前候选和本地测试不是目标上线/恢复成功证明。
