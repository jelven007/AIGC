# 私有素材、图片恢复、剪辑成片与平台发布

日期：2026-10-21。本轮记录本地源码能力；云端是否启用以部署回执和真实联调为准。

## 素材与任务

迁移 `00035` 将 materials/videos/thumbnails 改为私有桶，通过 Storage RLS 隔离用户。数据库保存稳定的 authenticated 对象引用，浏览器按当前 JWT 取得 15 分钟签名；服务端在创建计费任务前核对归属，Worker 执行时重新签名。旧路径仅在存储对象 owner 与原业务归属一致时授予访问，不能从任意外部 URL 推导授权；无法归属的旧对象需运维核对后重新上传。

`production_jobs` 保存图片、渲染、发布任务及租约。图片与封面以 UUID 幂等创建，按 `credit_costs.generate_image/generate_cover` 预占（默认各 10 积分），固定绑定模型版本。返回图片后先保存原结果，下载或归档失败只重试保存，不再次调用模型。结案证据先独立落库，退款/素材归档在事务中执行；重复结案不会重复归档或退款。受理未知转为 `unknown`，保留原扣费，不自动重发。

图片工作台、封面与剪辑恢复本地请求回执并查询服务端任务。关闭网页后由调度器继续处理；本地回执包含任务参数，不包含模型或平台凭据。签名过期后重新加载可续签。

## 真实剪辑

`worker/` 使用 Python + FFmpeg，在独立容器下载已签名素材后合成 H.264/AAC MP4 与封面。支持裁剪/源起点、拼接、变速、多层画中画、图片、中文字幕及背景/描边、翻转/旋转/调色、音量/声像/变调/淡变/降噪/混响、六类线性关键帧。默认淡入淡出与叠化转场保持工程时长；字幕支持淡入/下滑进入及淡出/上滑退出。

输出协议限制 1–80 元素、0.1–600 秒、720/1080/2160 短边、24/25/30/60fps 与五种画幅。单素材 500MB、工程素材总量 2GB，发布成片上限 50MB。Worker 每 30 秒续租，失去租约或关闭时终止 FFmpeg，默认最多运行一小时。FFmpeg 禁用网络协议，成片通过专用签名上传，Worker 不持 service_role。未接入的抠像、特殊转场和混合模式会明确拒绝导出；不等同于原编辑器所有演示工具均可生产使用。

## 平台发布与指标

迁移 `00036` 新增应用、账号、一次性 OAuth state、令牌刷新锁、发布队列、最新指标与历史快照。管理员在 `/settings/models` 配置应用 Client Key/Secret，密钥 AES-GCM 加密；用户在 `/publish` 完成正式 OAuth 授权并确认作品、可见范围、商业内容与 AIGC 标识。

- TikTok：`video.publish` 初始化 FILE_UPLOAD，保存 publish_id/upload_url 后按平台字节偏移恢复上传；状态查询确认 PUBLISH_COMPLETE 才标已发布，`video.list` 查询官方视频指标。
- 抖音：`video.create.bind` 上传/创建作品，保存 item_id；`video.data.bind` 查询公开视频审核状态与播放/点赞/评论/分享。只有明确确认已公开才标已发布。官方样例部分状态码与字段说明不一致，未知状态继续核对，不推测成功或失败。
- 小红书、快手、B站尚无正式适配，界面仅显示已实现的两平台。平台审核、发布权限、账号地域与开发应用状态决定实际可用范围。

已受理作品持续查询，传输结果未知禁止重发。`/data-feedback` 显示官方累计指标、采集时间和同步错误；未返回指标为 null。指标快照与历史同一事务写入，后台每 15 分钟分批采集；广告曝光/CTR/CVR/消耗/收入尚未接入。

官方协议：

- [TikTok Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- [TikTok 状态查询](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status)
- [抖音视频创建](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create)
- [抖音视频数据](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/search-video/video-data)

## 启用顺序与回滚

1. 备份数据库与对象权限，应用未部署的 `00034–00036`（依现有回执增量执行）。新迁移只在新版本后端就绪时切换私有桶；旧前端公开 URL 在切换后将无法直接播放。
2. 按 `deploy/volcengine/manifest.json` 或官方 Supabase 部署新函数。production-worker 与 platform-oauth-callback 不要求平台 JWT，分别在函数内校验专用密钥和一次性 state。
3. 配置 `MODEL_CONFIG_ENCRYPTION_KEY`、`VIDEO_WORKER_SECRET`、独立 `RENDER_WORKER_SECRET`。可选 `PLATFORM_SITE_URL` 指向真实 HTTPS 前端。应用回调固定为当前后端 `/functions/v1/platform-oauth-callback`。
4. 调度器 `.env` 设置 `PRODUCTION_WORKER_ENABLED=true`。已有旧 video-job-worker Cron 只处理视频，图片/发布需新增生产调度；不要以浏览器查询代替后台部署。
5. `deploy/render-worker/.env` 填后端；将渲染密钥保存到该目录 `render_worker_secret`，权限 600。执行 `docker compose -f deploy/render-worker/docker-compose.yml up -d --build`。推荐按资源扩容容器数量，数据库租约防止重复领取。
6. 发布前端并配置图片模型及平台应用；重新授权补足新 Scope。分别做真实图片关闭页面恢复、剪辑成片下载、公开发布及指标回流验收。

暂停新任务可停调度/渲染容器或禁用模型/平台应用，但保留数据库证据与原密钥以核对旧任务。`unknown` 仅在上游账单/平台作品核对后处置，由 service_role 调用 `reconcile_production_job` 并提供不少于10字的核对说明：已受理传原图片结果/平台标识继续归档或查询，确认未受理传 null 进入原子退款。核对写审计日志，不能直接清空证据重置 ready。回滚前端需兼容私有签名；不要为恢复旧 URL 将桶整体重新公开。

## 本地验证

真实隔离 PostgreSQL 执行全部生产迁移与 33 项事务/RLS用例；真实 FFmpeg 6 项输出测试；`test:production` 的权限、图片恢复、平台断点上传、审核与数据映射用例。Playwright通过真实页面交互验证发布权限禁用、指标缺失/零值与同步错误、图片关闭页面后同请求恢复。另运行支付、视频、模型/音频、调度、部署回归、TypeScript、Deno、项目 lint 与生产构建。`tests/browser_production.mjs` 使用临时安装的 Playwright，可配置 PLAYWRIGHT_MODULE、CHROMIUM_PATH 和 UI_TEST_URL。

平台响应在本地测试中使用固定协议夹具，未冒充云端 OAuth 或公开发布验收。云端迁移、容器运行、真实供应商生成和平台联调仍需在目标环境执行。
