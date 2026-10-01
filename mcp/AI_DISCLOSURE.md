# Shopro AI - AIGC 带货视频系统项目 AI 使用披露报告

---

## 🛠️ 1. AI 辅助开发工具与 Coding 助手
* **Google DeepMind Antigravity**：本项目开发过程深度依托 Antigravity AI Coding 助手，辅助完成了以下工作：
  * **MCP 服务设计与搭建**：利用 Python `FastMCP` 构建双通道（Stdio 和 Streamable-HTTP）的 Model Context Protocol 接口服务，实现了工具反射、参数校验、统一异常捕捉与分布式追踪。
  * **前端性能与类型修补**：对 React 前端页面（如数字人库 `AvatarsPage.tsx`）进行严格类型适配、防爆防闪设计，并将头像资源绑定为高质量的本地肖像资产。
  * **容器化及工程打包**：自动编写 `Dockerfile.mcp`、`docker-compose.mcp.yml` 部署管道，极大减少了人工编写配置的失误。

---

## 🤖 2. 项目集成的 AI 模型选型
为了保证在“脚本创意-口播合成-视频渲染”全链路上均能达到顶尖效果，本项目深度对接并融合了多款主流的商用大模型：

* **文案与本地化大模型**：**DeepSeek-V4-Pro** (`deepseek-ai/DeepSeek-V4-Pro`)
  * *用途*：自动抓取并深度提炼电商商品卖点、分析痛点、生成 AIDA 营销短视频脚本并精准翻译。
* **画面 Prompt 增强大模型**：**StepFun step-3.7-flash**
  * *用途*：将简单的用户画面创意，基于 CoT（思维链）扩写为高逼真度、富含光影质感与电影级运镜描述的视频 Prompt。
* **超写实情感化配音大模型**：**StepAudio 2.5 TTS** (`stepaudio-2.5-tts`)
  * *用途*：将脚本口播内容，合成带有起伏呼吸感的拟真人类语音流（支持多音色、语速、音量定制）。
* **物理世界级视频合成大模型**：**Seedance 2.0** (`doubao-seedance-2-0-fast-260128`)
  * *用途*：执行最终的高画质视频渲染，输出细腻逼真的短视频片段。

---

## 📦 3. 所使用的开源项目与组件模板
* **BaaS 系统模板**：**Supabase 官方生态** (PostgreSQL / Auth / Storage / Edge Functions Deno) 作为底层后端支柱。
* **前端工程模板**：**Vite 5.4.1 (React + TypeScript)**，用作前端 SPA 开发的热更新底座。
* **通信协议库**：**FastMCP (Python)**，用于以最低的侵入度快速暴露 MCP 协议兼容接口；使用 **httpx** 进行高效的异步 upstream API 请求。
* **UI 组件框架**：**Radix UI + shadcn/ui** 原生基础组件，在此基础上结合 **Tailwind CSS 3.4.11** 原生响应式网格及毛玻璃玻璃拟态效果定制了全部 UI 界面。
* **动画驱动组件**：**Framer Motion 12.4.10**，用于前端所有浮动面板、抽屉弹出以及“提示词增强”按钮被触发时的动效。

---

## 🎨 4. 外部素材与 AI 生成资源披露
* **数字人形象素材**：为了向商家提供专业、合规的口播形象预览，数字人库中的真实人物（如 **Mia、阳阳、Brandon** 等）并非网络盗图，均是使用 **Stable Diffusion XL (SDXL)** 模型针对写实肖像精细微调生成的虚拟人像素材，并已经过格式裁剪，以静态资源的形式本地存储在 `/public/images/avatars/` 中，供前端试听预览使用。
