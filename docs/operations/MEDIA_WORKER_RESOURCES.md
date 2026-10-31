# 媒体执行与 MCP 资源边界

本地实现基线：`render4/edit2`，保持原工程、私有素材与专用租约 API。调度与维护见 [WORKER_SCHEDULING.md](WORKER_SCHEDULING.md)。真实长素材、宿主磁盘配额、外部 TLS/供应商仍须目标环境接受。

## 媒体工作目录

`deploy/render-worker/docker-compose.yml` 使用 `RENDER_WORKSPACE_PATH` 绑定 `/work`。在宿主的专用磁盘建立目录并赋予 UID/GID `10001:10001` 写权限，随后在受控环境配置该绝对路径、`SUPABASE_URL` 与专用租约密钥文件。宿主目录应使用独立文件系统或磁盘配额；Docker bind 本身不会产生容量配额。容器只读、4 GiB 内存、2 CPU、256 PID，`/tmp` 仅为 64 MiB tmpfs，素材不会再占用 4 GiB tmpfs 与模型/FFmpeg 竞争内存。

每个进程只执行一个本地媒体任务。每个工作目录使用独占锁；第二个进程不能领取或清理活跃目录。启动取得锁后只清理 `shopro-render-*` 残留目录，其他文件保留。强制终止后的业务恢复仍依赖原数据库租约到期与 fencing，残留文件清理不生成新任务。

单任务输入最多 2 GiB，单素材最多 500 MiB，视频分析输入最多 100 MiB。下载前及逐块下载时预留输出空间：普通合成预留 1 GiB 成片和 32 MiB 辅助文件，有人物蒙版再预留 768 MiB；分析和音轨预处理预留 32 MiB。完整任务文件预算 4 GiB，文件系统至少保留 128 MiB 空闲。重复硬链接按 inode 计量；预算不足不等待写满磁盘，而是归回原任务重试路径。

任务内相同私有存储对象忽略短期签名差异，仅下载一次。外部 URL 的查询参数保持完整。下载流计算 SHA-256，文件按实际内容摘要归并；不同来源首次下载后才可确认内容相同。缓存随任务目录删除，不跨账号、任务或租约。部分文件、空内容与超量输入均不能进入 FFmpeg。

下载单次总预算 180 秒，连接/读取为 10/5 秒；上传检查逐块停止和 180 秒总预算，连接/读取为 10/15 秒。FFmpeg/预处理与蒙版编码写入持续检查停止、租约和磁盘。SIGTERM 停止领取、回收子进程并清理临时文件；Compose 留 90 秒退出。上传或结案开始后网络异常均沿原 job/lease `retry`，不记作明确失败或凭超时退款；业务 API 继续核对原上传与原结案。

`python main.py --healthcheck` 读取无秘密的健康文件，不调用数据库。首次成功领取/空队列后才就绪，90 秒无更新、错误或停止均不就绪。该检查不证明模型、Storage 或数据库整体能力。执行日志记录 job ID、下载数、输入字节及任务空间高水位，不记录签名或用户正文。

## MCP 运行

MCP HTTP 保持 stateless、用户凭据 ContextVar 和 59 项业务工具。每个进程最多 16 个活跃业务请求、同凭据最多 4 个，超量直接 429；不同凭据的共同用户限额仍由业务 API 执行。正文含 chunked 最多 256 KiB，读取超过 10 秒返回 408；工具 HTTP 请求预算 165 秒。结果未知时客户端保存原 `request_key` 并查询，服务不自动重发创建。

Uvicorn 限制连接并发 64、backlog 64、keepalive 5 秒、退出 170 秒，关闭代理头信任及访问日志。Compose 限制 384 MiB/1 CPU/96 PID、只读、32 MiB tmpfs、日志 10 MiB × 3；180 秒退出窗口允许已提交工具响应收敛。`/healthz` 仅表明协议进程存活，不进行业务调用、不返回用户数据；业务权限仍在 `/mcp` 每请求验证。

公开入口配置精确的 `MCP_ALLOWED_HOSTS`、TLS 代理及业务 HTTPS 根地址。FFmpeg Worker默认仅信任原后端域名，外部CDN通过`RENDER_MEDIA_HOSTS`逐项声明；实际连接绑定经过检查的公网地址，保留TLS证书/Host/SNI验证，禁止代理与跳转。主机出口配置与历史密钥见 [轮换和出口](KEY_ROTATION.md)。

## 复核入口

- `python tests/test_worker_resources.py`：任务缓存、磁盘/部分文件、预处理子进程、阻塞蒙版、SIGTERM、原上传未知、工作目录独占和健康。
- `pnpm test:worker-egress`：实际锁镜像内可信域名/公网DNS、连接地址绑定、真实TLS、Host/SNI及拒绝重定向。
- `python tests/test_mcp_backend.py`：真实 SDK、正文/慢请求/并发、账号及原 UUID；`python mcp/export_tools.py --check` 拒绝目录漂移。
- `python scripts/measure_media_worker.py`：真实 FFmpeg，固定同一 MP4 的 8 个裁剪轨道，本地下载/上传/租约夹具；输出下载字节、空间高水位、Python/子进程 RSS 和成片摘要。在同一 Linux 镜像中以 `--worker-directory` 选择隔离的历史源码，可复核前后；不会连接外部服务。旧源码还须显式 `--expect-legacy-progress-failure`，必须复现确切 `N/A` 异常与原 `retry`，不会把旧中止任务记作成功。

测量报告写入 [本轮实施记录](../archive/reviews/OPTIMIZATION_IMPLEMENTATION_20261027.md)。固定夹具一次运行不是生产峰值、P95 或容量承诺。
