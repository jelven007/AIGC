# 单台 ECS 自托管运行手册

应用入口、数据库、认证、私有文件、实时消息、43 个 Edge 入口、任务调度、独立维护、FFmpeg 和 MCP 均运行在同一 ECS。模型推理、收款商户和平台发布仍使用经营方实际配置的供应商接口。

## 环境

核验：2026-10-31。责任：运维维护者。当前版本/源码/镜像身份见[生产基线](../releases/PRODUCTION_BASELINE.md)，本文每次部署或30天复核。ECS状态固定`/opt/shopro/state`，本地状态升级迁至工作区`.local/shopro-production/state`，保持原项目与命名卷。

## 升级与回退

发布代码、前端、Edge和镜像需先完成摘要/架构/源码与必要回归核验。生成加密冷快照并保管0600快照密钥，然后在冻结发布目录执行：

```sh
python3 scripts/self_hosted_snapshot.py backup \
  --state-dir /opt/shopro/state --key-file /opt/shopro/backup.key \
  --output /opt/shopro/backups/before-v1.0.0
python3 scripts/self_hosted.py upgrade \
  --release "$PWD" --state-dir /opt/shopro/state
python3 scripts/self_hosted.py check --state-dir /opt/shopro/state
```

升级入口核验完整交付清单、镜像ID/CPU架构，停服务后保留旧前端/Edge，切换`SOURCE_DIR`与不可变镜像，保留全部原身份/密钥/容量配置。bootstrap只核对原迁移摘要并追加未执行的生产迁移，不重置管理员或账务。原配置与产物副本位于state/receipts，数据卷不删除。

晋级后核对原UUID、权威余额、原完成任务/私有视频摘要、历史密钥、容器健康及公开`release-identity.json`。本地11个服务，线上26个且16渲染器/DB240连接等容量参数必须保持。失败时先停止新进程，恢复原runtime.env、前端/Edge副本和原源码/镜像，再`up --wait`；只有业务数据损坏才使用加密快照在新项目/新卷恢复，禁止覆盖当前数据卷。

完成原数据/健康核验后切换`releases/current`指针。保留当前加最多两份历史代码版本，先检查所有容器挂载和回退来源，再清理未使用的旧候选及临时包。数据库/素材备份按独立恢复规则保留。

安装 Docker Engine 与 Compose v2、Python 3。建议至少 4 核、16GB 内存和 100GB 数据盘；渲染器单容器内存上限 4GB，其余服务也有明确上限。公网仅开放 SSH 和 HTTPS；数据库、认证、文件服务及执行器端口不对公网发布。

`https://118.196.122.161` 已部署完整应用，默认账号`admin/<REDACTED_CREDENTIAL>`。ECS为Ubuntu24.04/x86_64，Docker29.1.3/Compose2.40.3已启用自启动；项目`shopro-ecs`、源码`/opt/shopro/releases/.selfhost-ecs-source-20261031`、状态`/opt/shopro/state`。当前容量配置为11类常驻服务、26个容器，其中16个独立渲染器；66迁移、43入口及原业务协议保持。初次自托管的真实业务/权限/成片/重启、38公网页面及Realtime隔离见[实际验收](../testing/SELF_HOSTED_ACCEPTANCE_20261031.md)。

当前使用独立CA签发的IP SAN自签证书，30天有效，首次浏览器访问有证书提示。公网/宿主/Docker严格TLS校验通过；正式长期使用请配置指向ECS的域名和有效证书完整链/私钥。

## 离线安装

交付由 `scripts/self_hosted_release.py create` 生成，包含实际构建的前端、冻结 Edge bundle、11 个服务/工具镜像、镜像源码摘要和每个文件的 SHA256。运行无需 npm、JSR、官方 Supabase 管理令牌或远程模块下载。实例凭据由安装时重新生成。

先验证归档校验文件，再解压。以下命令在解压目录执行；替换域名、证书路径和状态目录：

```bash
python3 scripts/self_hosted.py install \
  --release "$PWD" \
  --state-dir /srv/shopro/state \
  --origin https://shopro.example.com \
  --project shopro-production \
  --bind 0.0.0.0 \
  --tls-cert /srv/shopro/tls/fullchain.pem \
  --tls-key /srv/shopro/tls/privkey.pem
```

安装按顺序执行：文件摘要和CPU架构核验→导入并核验镜像ID→数据库/认证/API→66份原迁移与默认账号→HTTPS与Edge/Realtime→真实技术接受→调度、维护、渲染、MCP。

**CPU架构必须匹配。** 开发机交付为 `linux/arm64`，本轮ECS为 `linux/amd64`，在ECS本机重新构建、测试并导出。安装器会拒绝架构不同的交付。基础组件清单使用不可变多架构上游摘要。

本次实际amd64归档`/opt/shopro/releases/shopro-selfhost-amd64-20261031.tar.gz`（2184530346字节），校验文件同名加`.sha256`。含11镜像、1499文件及镜像运行源码摘要。已从归档重新解压，在独立项目`shopro-ecs-offline`、新状态`/opt/shopro/offline-state-20261031`完成安装：新随机凭据、新默认admin UUID、66迁移、43入口、11服务与40MiB真实Storage往返通过。辅助项目已停止，原实例恢复。回执`offline-release.json`和`offline-install-checks.json`；归档自身不可修改，最新验收以源目录中的实际验收报告为准。

源代码环境的调度器、渲染器、MCP、备份镜像分别使用：

```bash
docker build -f deploy/video-scheduler/Dockerfile -t shoproai-video-scheduler:local .
docker build -f worker/Dockerfile -t shoproai-render-worker:local .
docker build -f mcp/Dockerfile.mcp -t shoproai-mcp:local mcp
docker build -f deploy/backup/Dockerfile -t shoproai-backup:local .
```

源代码构建前端需冻结的 Node22/pnpm 依赖和 Edge 支付SDK依赖；已生成的离线交付不需要这些构建依赖。

ECS原生构建可使用`python3 scripts/build_self_hosted_ecs.py --component backup`，另三个组件为`scheduler`、`renderer`、`mcp`。该脚本通过可访问镜像代理获取相同不可变摘要，依赖仍按锁文件校验哈希。规范地址使用IP时，执行器只允许该IP；域名方式只允许Docker固定代理地址，两种方式均验证TLS证书。

人物分割模型、原Apache2.0许可证及NOTICE随`worker/model-assets`交付。构建时优先读取本地资源，严格校验模型长度/原SHA256和许可证SHA256；镜像运行及离线重建均无需下载人物模型或许可证。

本台火山ECS的EIP不支持本机回环，已实测宿主和Docker直接连接自身EIP超时。已配置`shopro-eip-loopback.service`，仅将本机OUTPUT及Docker桥PREROUTING发往`118.196.122.161:443`的连接DNAT到本机`192.168.0.57:443`的HTTPS监听。公网入口、原URL、IP SAN和TLS校验保持有效；公网、宿主及Docker三处已使用真实证书链验证成功。服务随开机启动，配置位于`/usr/local/sbin/shopro-eip-loopback`和`/etc/systemd/system/shopro-eip-loopback.service`。更换EIP、私网地址或HTTPS端口时同步维护精确规则；域名通过Docker固定地址访问时不需要这组规则。

白名单交付的源码根目录为0755，供非root的bootstrap和接受容器读取；实例状态目录仍为0700，密钥文件为0600。不要将私有状态目录作为源码交付目录。

Docker动态地址池使用私有子网的后半段，HTTPS代理固定使用前半段的`.10`。这避免全组件同时重启时动态容器抢占代理地址；恢复实例会按新子网重新计算动态地址池。子网至少32个地址，默认使用独立`/24`。旧网络升级地址池时先停止并移除容器/网络，保留数据卷，再启动新网络；不得使用`down -v`。

64核ECS需限制PostgREST运行线程，使主进程和就绪探针均保持在256 PID预算内；原配置`GHCRTS=-N1`，100人配置为`-N2`。43个业务入口在x86 Edge Runtime中全量加载实测约1.16GiB，当前Edge总内存预算为16GiB；单个子Worker仍限制256MiB。

Storage路由使用HTTP/1.1且`proxy_request_buffering off`，直接流式转发素材。真实40MiB上传曾写满代理32MiB临时目录并返回500；修复后普通用户上传/下载41943040字节与SHA256核验、删除通过。500MiB配置上限未作最大体积/并发压力验收。

## 100人容量配置

当前主机为64逻辑CPU、约503GiB内存。`deploy/self-hosted/capacity-100.json`适用于至少64逻辑CPU、128GiB内存，较小实例会被配置工具拒绝，需另行定容压测。全部常驻CPU预算合计51，保留13个逻辑CPU预算余量；配置限额不等于实际资源占用。

| 组件 | CPU / 内存预算 | 并发边界 |
|---|---|---|
| PostgreSQL | 8 / 32GiB，shared_buffers 8GiB、work_mem 16MiB | max_connections 240 |
| Auth | 2 / 2GiB | 最大/空闲数据库池均20，生命周期30分钟/空闲5分钟，请求超时30秒 |
| PostgREST | 2 / 1GiB | 数据库池48，运行线程2 |
| Storage / Realtime | 各2 / 各2GiB | Storage数据库池32；Realtime线程2 |
| Edge Runtime | 8 / 16GiB | 保留43入口、原业务限流与数据库预算 |
| FFmpeg | 16副本，各1.5 / 4GiB | 每副本同时一个任务；输入解码1线程、编码2线程 |
| MCP | 1.5 / 1GiB | 全局128请求、每凭据4请求，HTTP入口256连接 |
| 网关 / 调度 / 独立维护 | 合计1.5 / 约0.75GiB | Nginx2个Worker、每Worker2048连接，HTTP/1.1上游连接复用；普通Edge凭据5请求/秒、突发20，超量429；REST响应头16KiB、8×16KiB缓冲 |

渲染器以`HOSTNAME`哈希划分持久工作目录，每副本持有独占锁，仅回收已退出副本残留。16个执行器沿用PostgreSQL持久队列、`SKIP LOCKED`、租约令牌与幂等积分；100人可以同时提交任务，等待可用执行器。未知上游受理仍进入`UNKNOWN`核对，不增加供应商配额。

Auth必须同时配置最大连接和空闲连接数。仅设置最大池20、保留默认空闲池0，持续查询`/auth/v1/user`会反复建立TCP连接；本轮曾出现临时端口耗尽及Auth500。使用`GOTRUE_DB_MAX_IDLE_POOL_SIZE=20`保留连接，并在启动日志核验`limit_max_open_conns=20`、`limit_max_idle_conns=20`。不要用跳过用户校验或修改RLS来解决认证容量。

网关对Auth/REST/Storage/Edge启用HTTP/1.1和有界上游keepalive，清除上游`Connection: close`；不开启失败后的自动转发重试。普通Edge入口按Authorization凭据限流，OPTIONS不消耗额度；`production-worker`仍使用其独立服务授权和原数据库调度预算。限流429表示请求未进入该Edge入口，业务端应保留原UUID。网络错误后出现商品409时先读取本人最新版本，再继续原版本控制流程。

扩容前先完成加密备份并保留不可变旧镜像；以下命令只更新容量参数，保留原密钥、账号和数据：

```bash
python3 scripts/self_hosted_capacity.py apply \
  --state-dir /opt/shopro/state \
  --backup-file /opt/shopro/capacity-20261031/runtime-before-capacity.env \
  --renderer-image sha256:d5b59ddb480e20930224554f887fdfdb38ebe17c63ff376313bb205aa78cbc5b \
  --mcp-image sha256:2646a7979c51f703673d7785e1334b3b70e23e05e498a546cd0c09e3d0fb45f2
python3 scripts/self_hosted.py up --state-dir /opt/shopro/state
```

上例的备份文件是本次已有回滚点；新变更须选择新文件名，工具拒绝覆盖原备份。配置文件原子回滚后再次启动：

```bash
python3 scripts/self_hosted_capacity.py rollback \
  --state-dir /opt/shopro/state \
  --backup-file /opt/shopro/capacity-20261031/runtime-before-capacity.env
python3 scripts/self_hosted.py up --state-dir /opt/shopro/state
```

容量验收脚本`self_hosted_capacity_exec.py`使用0700夹具目录、100个真实普通账号登录JWT和严格CA验证；`prepare/logins/refresh/load/burst/burst-check/mcp/cleanup`为各阶段。`burst-check`继续读取已提交任务，不重新上传或重复收费，`refresh`读取本人最新商品版本。脚本保留原套餐/限流。日志含私有测试夹具，仅分享汇总回执；日常运行不要把测试的服务管理密钥放到业务客户端。

## 初始账号

用户名 `admin`，初始密码 `<REDACTED_CREDENTIAL>`。自托管登录表单将此用户名映射到真实认证邮箱 `admin@shopro.local`。管理员具备服务端可信角色和等级3企业权益，初始余额为注册赠分20加自托管管理权益1,000,000。

首次登录后可在个人页修改密码。Bootstrap只创建一次，不重置密码、不解除禁用、不恢复被撤销角色/套餐、不重复赠分。后续技术检查使用短期测试账号，不要求管理员一直保留初始密码。

配置、证书私钥、模型密钥环及调度密钥位于0700状态目录，`runtime.env`为0600。前端只接收公开API地址、anon和管理员用户名映射，不接收初始密码或服务端密钥。备份时必须保留原密钥环，否则历史模型与平台凭据无法解密。

## 日常操作

```bash
python3 scripts/self_hosted.py status --state-dir /srv/shopro/state
python3 scripts/self_hosted.py check --state-dir /srv/shopro/state
python3 scripts/self_hosted.py stop --state-dir /srv/shopro/state
python3 scripts/self_hosted.py up --state-dir /srv/shopro/state
```

`check`验证原迁移摘要、Auth/角色/权益、43业务函数加载、probe24/render4/edit2、真实RLS和私有Storage往返。回执在状态目录 `receipts`。业务写入测试仅在新隔离实例显式设置 `SELF_HOSTED_ISOLATED_ACCEPTANCE=true`，不要对生产实例运行。

当前ECS操作可直接将示例`/srv/shopro/state`替换为`/opt/shopro/state`，在上述源码目录执行。停止整套系统必须包含`--profile execution`；CLI `stop`用于基础组件维护，完整停机/恢复由快照工具或完整Compose命令执行：

```bash
docker compose --env-file /opt/shopro/state/runtime.env \
  -f /opt/shopro/releases/.selfhost-ecs-source-20261031/deploy/self-hosted/compose.yaml \
  --profile execution stop
python3 scripts/self_hosted.py up --state-dir /opt/shopro/state
```

模型与发布平台在管理员“模型接口设置”页配置。初始化未填密钥的槽保持关闭，界面明确提示未配置。SMTP/SMS、支付商户与平台授权需实际经营方配置，不能以本地协议测试替代真实模型效果、到账或发布回执。

## 一致性加密快照与恢复

`self_hosted_snapshot.py`采用短暂停机快照：停止全部常驻容器，备份PostgreSQL、Storage、媒体工作区、维护告警及实例配置，AES-GCM分块认证加密，随后恢复运行。快照密钥以0600普通文件单独保管，不能只保留在同一ECS。

```bash
python3 scripts/self_hosted_snapshot.py backup \
  --state-dir /srv/shopro/state \
  --key-file /srv/shopro/private/snapshot.key \
  --output /srv/shopro/backups/2026-10-31
```

恢复限定同一数据库镜像版本/架构并保留原HTTPS地址：私有作品引用、任务证据及告警端点绑定该地址。全部加密文件先认证和验证摘要，拒绝现存实例目录或数据卷。更换ECS时保留域名并调整DNS，提供有效证书：

```bash
python3 scripts/self_hosted_snapshot.py restore \
  --state-dir /srv/shopro/state \
  --key-file /srv/shopro/private/snapshot.key \
  --artifact /srv/shopro/backups/2026-10-31 \
  --output /srv/shopro/restored-state \
  --project shopro-restored \
  --origin https://shopro.example.com \
  --bind 0.0.0.0 \
  --subnet 172.31.245.0/24 \
  --tls-cert /srv/shopro/tls/restored-fullchain.pem \
  --tls-key /srv/shopro/tls/restored-privkey.pem
python3 scripts/self_hosted.py up --state-dir /srv/shopro/restored-state
python3 scripts/self_hosted.py check --state-dir /srv/shopro/restored-state
```

原任务UUID、资金账、权限、管理员改密和历史密钥均保留。服务器角色或网络配置变化需另外核对；不要删除原卷来“重装”。已经提交但无受理证据的上游任务进入 `UNKNOWN` 等待核对；本地渲染使用过期租约重试，旧租约令牌不能更新任务。

证书续期后更新状态目录证书，执行setup的 `resource-init` 复制到专用卷，再重启HTTPS入口和使用CA的运行组件。当前命令不会擅自替换已经存在的证书，证书轮换应由管理员明确维护。

2026-10-31实际ECS冷快照已保存在`/opt/shopro/backups/20261031-ecs`；恢复项目`shopro-ecs-restored`、状态`/opt/shopro/restored-ecs-20261031`、网段`172.31.245.0/24`。5份加密文件认证/摘要验证、新卷导入及11服务接受通过，原账号UUID/余额/成片任务/57650字节私有成片保留，1份历史模型凭据可解密。`snapshot-drill.json`及`restore-checks.json`为回执，辅助项目已停止，原公网实例恢复且`admin/<REDACTED_CREDENTIAL>`复验成功。

IP规范地址无法在同一主机同时分流给两个独立实例；本次在原入口短暂停机后将恢复实例绑定原443端口验收，再切回原实例。保留原域名的异机恢复通过DNS切换；不要修改恢复origin绕过作品引用校验。

100人容量版的停机一致性快照为`/opt/shopro/backups/20261031-capacity100`，5份AES-GCM文件；完整26容器重启已通过。容量恢复工具`scripts/self_hosted_capacity_recovery.py`会在停机前校验隔离网段没有与现有Docker网络重叠，并在异常时停止辅助实例、启动原26容器及验证默认管理员。

```bash
python3 scripts/self_hosted_capacity_recovery.py \
  --state-dir /opt/shopro/state \
  --target-dir /opt/shopro/restored-capacity-new \
  --artifact /opt/shopro/backups/capacity-new \
  --key-file /opt/shopro/private/snapshot.key \
  --project shopro-capacity-new \
  --subnet 172.31.241.0/24
```

使用新快照目录、状态目录、项目和空闲网段；示例网段也要由工具实际预检。本轮已有离线实例占用`172.31.244.0/24`，容量演练改用`172.31.243.0/24`，项目`shopro-ecs-capacity-restored`、状态`/opt/shopro/restored-capacity-20261031`。`--resume`只用于已认证并导入的辅助实例，核对项目、规范地址和网段后继续启动验收，不覆盖原数据。最终回执为原状态目录`receipts/capacity-recovery.json`，失败尝试单独保留在容量私有目录。

容量版实际验收通过：4个新数据卷、恢复实例26容器healthy，原管理员UUID/余额/成片结果、57650字节私有视频、1份历史加密配置可解密。演练结束辅助实例停止，原实例26容器恢复且`admin/<REDACTED_CREDENTIAL>`复验成功；原成片SHA256在演练前后相同。100临时账号、200任务与测试文件已清理，详细数据见[100人容量验收](../testing/SELF_HOSTED_CAPACITY_100_20261031.md)。
