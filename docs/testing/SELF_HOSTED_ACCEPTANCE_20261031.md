# 单机自托管接受记录

日期：2026-10-31。以下当前结果来自火山ECS `118.196.122.161` 的真实linux/amd64全栈及公网验收。入口[https://118.196.122.161](https://118.196.122.161)，默认账号`admin/<REDACTED_CREDENTIAL>`；运行契约00068/probe24/render4/edit2。实际经营供应商未提供凭据，不能将这些结果计为真实模型质量、收款或平台发布成功。

| 接受项 | 实测结果与证据 |
|---|---|
| 基础平台 | PostgreSQL15、Auth、PostgREST、Storage、Realtime、Edge、Nginx及生产/维护/渲染/MCP，共11常驻服务healthy |
| 初始化 | 66份原生产迁移摘要匹配；重复applied=0、admin_created=false |
| 默认管理员 | 浏览器用户名admin/密码<REDACTED_CREDENTIAL>真实登录；Auth可信角色、档案、等级3；初始1,000,020积分 |
| 业务入口 | 43业务函数实际加载、20模型槽、12运营域、15业务读动作 |
| 模型设置 | 密钥加密与历史不可变版本保存；浏览器无明文密钥；未配置槽关闭 |
| 商品 | 真数据库创建、重复UUID幂等、更新、旧版本409、删除；浏览器保存/刷新/删除 |
| 开放API | Key签发、权限范围与撤销；越权403、撤销后401 |
| MCP | 真实握手、59工具清单、调用真实production API |
| 视频成片 | Storage→原任务/租约→独立FFmpeg→上传/数据库结案；2秒、1280×720、57650字节、H.264/AAC；红蓝顺序正确，字幕两帧各1176白像素 |
| Realtime | 实际WebSocket本人作品与余额消息；另一普通用户未收到该用户消息 |
| 初始化管理边界 | 改密、禁用、Auth/档案撤权与套餐失效后重复bootstrap不恢复；无重复赠分 |
| 容器重启 | 已完成任务原结果保留；UNKNOWN不重提；过期本地渲染租约恢复；旧token拒绝；无重复积分 |
| 页面 | admin登录→38工作台页面完成真实读取→商品保存/刷新/删除；1440×1000与390×844；零控制台错误、零本站失败请求 |
| 大素材上传 | 普通用户41943040字节真实Storage上传、下载SHA256一致、删除；流式代理修复32MiB临时目录写满 |
| 缓存页 | 可信管理员RPC监控/清理；普通metadata伪造admin仍403；失败显示错误而非空成功 |
| 静态检查 | pnpm lint：结构/循环/路径、TypeScript、Biome、Tailwind和仓库规则通过 |
| Node回归 | Node22+Python隔离runner：98/98通过，fail=0 |
| Python回归 | 375/375：298 ECS通用＋51 ECS媒体＋22 ECS MCP＋4本机Git工作区发布检查；无跳过 |
| 基础镜像 | 7个固定摘要平台镜像与4执行镜像linux/amd64；执行源码摘要在离线交付时核验 |
| ECS冷快照 | 全11常驻组件停止后5份AES-GCM加密快照，DB/Storage/媒体/告警/实例状态；摘要和认证通过 |
| ECS真实恢复 | 新项目shopro-ecs-restored、新目录/卷/172.31.245.0/24；11服务健康，原管理员UUID/余额/任务/57650字节私有视频不变，1份历史模型密文解密通过 |
| ECS离线交付 | 原生linux/amd64、11镜像、1499文件SHA256及镜像源码摘要；实际归档解压再次验证通过 |
| ECS离线安装 | 新项目shopro-ecs-offline/172.31.244.0/24；生成新凭据与不同UUID的默认管理员；66迁移、43入口、权限/Storage、11服务健康及40MiB上传下载删除通过 |
| 最终公网复验 | 原CA严格TLS、admin/<REDACTED_CREDENTIAL>、原UUID/余额、管理权限、20槽未配置关闭、57650字节原私有成片均通过；原11服务healthy，辅助项目停止 |

实际修复了PG平台初始化/扩展、Edge子进程CA、冻结SDK、只读代理权限、pg_safeupdate兼容、Realtime发布清单、外部字体阻塞和缓存页面ACL/错误回执。ECS追加修复PostgREST在64核下超PID预算（GHCRTS=-N1）、x86全43入口加载超1GiB（有界4GiB）、动态容器抢固定代理IP（后半子网地址池）、EIP本机回环（精确DNAT）和40MiB上传代理写满（流式转发）。原迁移文件摘要没有改写。

回归分组采用持久日志，已经完整结束。`python-host.json`汇总302项，其中4项需要真实Git修订/发布工作区，在本机执行；ECS白名单交付无Git数据库的原失败回执`python-host-ecs-original.json`保留，未把该环境限制伪装成ECS通过。另有`python-media.json`51项及`python-mcp.json`22项，全量375项通过。

当前ECS项目`shopro-ecs`，状态目录`/opt/shopro/state`，源码`/opt/shopro/releases/.selfhost-ecs-source-20261031`。本机核验副本在`.selfhost-ecs-browser/receipts`：`technical-checks.json`、`business-checks.json`、`cache-checks.json`、`bootstrap-lifecycle-checks.json`、`full-acceptance.json`、`recovery-checks.json`、`media-output-checks.json`、`browser-checks.json`、`realtime-checks.json`及上述回归日志。截图为`browser-desktop.png`与`browser-mobile.png`。私有状态、快照密钥、加密快照及大镜像归档不加入Git。

Ubuntu24.04/amd64，Docker29.1.3、Compose2.40.3已启用自启动。公网、宿主、Docker以及Realtime均用真实独立CA/IP SAN严格验证TLS；浏览器验收允许自签证书，因此不能推导浏览器/操作系统已信任该CA。当前证书30天，首次人工访问有证书提示；正式使用应配置域名和有效证书。

先行本地ARM验收独立保留：11镜像/1344文件离线安装通过；5份AES-GCM快照恢复到新卷/目录/网段、原管理员UUID/余额/任务/57709字节私有视频及4份历史模型密文通过。当前表格分别给出ECS恢复与amd64实际交付结果，不混用ARM数字。

ECS快照路径`/opt/shopro/backups/20261031-ecs`，恢复实例`/opt/shopro/restored-ecs-20261031`。`snapshot-drill.json`及`restore-checks.json`真实通过，演练全过程190.36秒（含备份/导入/验收/恢复原实例，不作为生产RTO承诺）。结束已停止辅助实例并保留卷/回执，原公网实例重新验证默认管理员成功。快照密钥单独以0600文件保管，受控本机副本已保存。

ECS离线包`/opt/shopro/releases/shopro-selfhost-amd64-20261031.tar.gz`，2184530346字节，SHA256：

```text
442143df4f17f5bd37e50e48e3f8a5d04be7aa1e8f42adb2eed0982679aeeafc
```

实际从此归档解压到`/opt/shopro/releases/offline-validation-20261031`，重新验证1499文件和11镜像，再初始化`/opt/shopro/offline-state-20261031`。`offline-release.json`、`offline-install-checks.json`通过；没有借用原实例凭据或数据，默认管理员真实创建并登录。安装演练全过程173.59秒，结束停止辅助实例、恢复原实例并复验原默认管理员。归档保持封包时内容和原摘要，最新部署结论以本报告为准。

交付最终回执`final-public-checks.json`、`final-health-checks.json`、`final-verification.json`均通过。Docker及EIP回环服务已启用开机启动；本轮实测包含全组件重启，未另作宿主机重启测试。原默认账号保留`<REDACTED_CREDENTIAL>`，可直接登录，首次使用后由管理员在个人页改密。
