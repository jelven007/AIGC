# MCP 项目说明入口

核验：2026-11-01。读者：MCP接入与维护者。责任：工具服务维护者。当前源码位于services/mcp，59实际工具/19权限、00068/probe24/render4/edit2。每次SDK/权限/协议变化复核；tools.json与真实SDK不同即过期。下文旧迭代统计保留原时点，当前范围以工具目录和[API](../../docs/development/API_AND_DATA.md)为准。

更新：2026-10-31。本项目为视频生成平台，支持分镜、视频生成、素材剪辑、配音、导出与发布，商品资料作为创作辅助。MCP 共用登录用户 JWT、业务 API 和统一模型配置；不固定 DeepSeek/Step/Seedance 模型名称为真实运行账号，也不使用原作者公网服务地址。

当前功能基线d7e3d38，00062/probe22/render4/edit2。接入59工具/19权限、原UUID/价格/预算、异步媒体/剪辑/多镜头/商品/知识/情报和九入口操作在 [MCP指南](mcp.md)。完整范围/官方旧部署差距/证据见 [PRD](../../docs/prd/PRD.md)、[当前状态](../../docs/CURRENT_STATE.md)、[最新报告](../../docs/archive/reviews/TEST_REPORT_20261022.md)；工具SDK目录不等于独立掩码编辑工具或真实供应商已上线。

无证据的团队身份、AI 开发工具经历、海外用户效果和数字人素材授权不作为项目事实。素材/第三方组件来源核验见 [使用与来源记录](AI_DISCLOSURE.md)。
