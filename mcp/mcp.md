# MCP 接入指南

更新：2026-10-21，已提交源码 ce90bfe。FastMCP 提供 7 个工具，共用 Shopro 用户 JWT 与业务 API/模型配置，不直接调用独立供应商。当前后端新版辅助函数/模型表未上线，完整工具需先部署匹配服务。状态见 [CURRENT_STATE](../docs/CURRENT_STATE.md)。

## 1. 入口与连接配置

HTTP 入口 http_server.py，stdio 入口 mcp_shopro_server_stdio.py；mcp_shopro_server.py 含工具定义，也可作为 stdio 入口。原极简入口只作兼容，不建立计费旁路。配置模板见 [.env.example](.env.example)。

连接参数 SUPABASE_URL/SUPABASE_ANON_KEY 指向自己的目标项目；HTTP 每次请求携带 Authorization: Bearer 用户JWT，MCP_ALLOWED_HOSTS 填真实公开域名。stdio 使用 SUPABASE_USER_JWT，凭据放受控环境而非分享客户端配置。不给 MCP service_role、模型 Key 或加密主密钥。

HTTP ContextVar 在每次请求后重置，无状态传输避免用户会话混用；MCP 握手只表示协议可用，业务仍由后端 Auth 验证 JWT。公开服务必须 TLS 反向代理，不能沿用第三方演示域名。

## 2. 工具契约

| 工具 | 输入 | 行为/边界 |
| --- | --- | --- |
| extract_product_highlights | product_info | ai-assistant.generate_selling_points；当前作为 product_name 传入，不自动代表任意 URL 抓取 |
| generate_marketing_script | product_highlights、target_audience、platform=TikTok、language=Chinese | text-generation JSON；返回 script，质量/语言需实测 |
| translate_marketing_script | script、target_language | 同一文本配置；返回 script，不承诺完美本地化 |
| synthesize_voice_tts | text、voice_id、speed=1.0、volume=0.9 | siliconflow-audio?action=tts；audio_base64/content_type；非默认速度/音量会拒绝 |
| enhance_prompt | prompt | text-generation；enhanced_prompt |
| submit_video_generation | prompt、必填 request_key UUID、duration=5、resolution=720p、ratio=16:9、first_frame_url、watermark=false | video-jobs.create，provider 固定 ArkSeedance；watermark=true 拒绝；返回公开 job |
| query_video_status | request_id | 该值是本地 job.id，不是上游 ID；video-jobs.query，可能执行到期任务 |

TTS 工具默认 voice_id 为 fnlp/MOSS-TTSD-v0.5:alex，必须是配置供应商支持的音色；设置页和工具输入不能保证音色已开通。视频素材/规格由服务端适配器校验。

计费沿用实际业务入口：卖点 AI Action 按表计费，直接文本/音频暂免费但有频控，视频一次预占/成功结算/明确失败释放。重试必须复用 request_key 与完整参数；创建返回 202/job 不是供应商完成。unknown 不重提、不凭超时退款。

## 3. 本地与 Docker 启动

在 mcp 目录建立 Python 3.12 虚拟环境并安装 requirements_mcp.txt。首次复制配置模板，已有 .env 不覆盖；直接 Python 启动前由受控环境加载参数。


default HTTP：python http_server.py，默认 127.0.0.1:8080/mcp。stdio：python mcp_shopro_server_stdio.py，用户 JWT 过期后需安全更新。

Docker：docker compose -f docker-compose.mcp.yml up -d --build；端口绑定 127.0.0.1:8080，公网通过 TLS 代理。MCP_ALLOWED_HOSTS 包含实际 Host/端口规则，不使用任意域名通配。容器重启不代表宿主始终在线。

## 4. 客户端与验收

支持 streamable-http 的客户端配置实际 /mcp URL 与用户 Authorization；stdio 配置本地 Python/入口路径和受控用户环境。客户端必须处理 JWT 过期、限流和业务错误，不能以一次 initialize 成功宣称生成链路全通。

先在仓库根运行 python3 tests/test_mcp_backend.py（需安装依赖）；实际 SDK 覆盖无 JWT 拒绝、初始化/工具保留用户身份、视频参数。上线再测试两个用户并发、跨用户 job 查询、同 UUID 重试、真实文本/TTS/视频、TLS/域名与 JWT 过期。

接口状态见 [API_AND_DATA](../docs/API_AND_DATA.md)，真实验收见 [TEST_PLAN](../docs/TEST_PLAN.md)，部署见 [火山指南](../docs/VOLCENGINE_DEPLOYMENT.md) 或 [官方记录](../docs/DEPLOYMENT_AIGCP.md)。MCP 与前端同版本/同后端，不能用工具绕过配置/计费。
