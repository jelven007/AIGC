# Shopro AI Model Context Protocol (MCP) 服务接入文档

本项目已基于官方的 **Model Context Protocol (MCP)** 协议，使用 Python `FastMCP` 开发了专用的 MCP 服务。该服务将 Shopro AI 的核心视频处理、文本处理与文本优化接口（包含 DeepSeek 营销脚本生成、StepAudio 2.5 语音合成、StepFun 提示词增强、Seedance 2.0 视频生成和任务查询等）封装为 AI Agent 可以直接调用的工具集。

---

## 📁 生成的服务文件清单

所有服务代码与相关配置文件已存放在 `mcp/` 目录下：

1. **`mcp_shopro_server.py`**：核心营销大模型与视频生成 MCP 服务入口，基于 `streamable-http` 协议模式，默认监听端口 `8080`。
2. **`mcp_shopro_server_stdio.py`**：基于 `stdio` 协议的本地启动入口，专为 Claude Desktop / Cursor 等本地 Client 编写。
3. **`tools.json`**：符合 MiXer AI 平台兼容格式的标准 MCP 工具定义 Schema，包含所有接口的输入参数描述（已修正为标准的 Object 包裹结构）。
4. **`requirements_mcp.txt`**：MCP 服务运行所需的 Python 依赖。
5. **`Dockerfile.mcp`**：用于容器化构建 MCP 服务的 Dockerfile（默认启动 `mcp_shopro_server.py`）。
6. **`docker-compose.mcp.yml`**：一键拉起本地/线上 MCP 服务的 Compose 编排文件。
7. **`mcp_server.py` 与 `mcp_server_stdio.py`**：原版极简型视频生成服务备份文件。

---

## 🛠️ MCP 工具接口清单

生成的完整版 MCP 服务包含以下 7 个标准工具：

### 1. `extract_product_highlights`
* **功能描述**：使用 **DeepSeek-V4-Pro** 深度分析商品描述或网页链接内容，智能提取前三大核心卖点、目标受众痛点以及高转化率的视频广告切入视角。
* **参数 schema**：
  ```json
  {
    "product_info": "string (必填，原始商品介绍或链接文案)"
  }
  ```

### 2. `generate_marketing_script`
* **功能描述**：基于 **DeepSeek-V4-Pro** 智能撰写符合 AIDA 框架的 TikTok/短视频带货脚本，输出详细的分镜动作（Hook、痛点、解决方案、Action）与配套数字人台词。
* **参数 schema**：
  ```json
  {
    "product_highlights": "string (必填，商品核心卖点)",
    "target_audience": "string (必填，目标受众画像)",
    "platform": "string (选填，默认 TikTok，发布平台)",
    "language": "string (选填，默认 Chinese，脚本语言)"
  }
  ```

### 3. `translate_marketing_script`
* **功能描述**：使用 **DeepSeek-V4-Pro** 对脚本进行高质量的本地化语言翻译，且能自动保持原有的分镜格式与占位符完整无缺。
* **参数 schema**：
  ```json
  {
    "script": "string (必填，待翻译的脚本内容)",
    "target_language": "string (必填，目标翻译语言)"
  }
  ```

### 4. `synthesize_voice_tts`
* **功能描述**：调用 **StepAudio 2.5 TTS** 大模型生成带情感色彩的语音音频，返回 Base64 格式编码的 MP3 音频二进制流。
* **参数 schema**：
  ```json
  {
    "text": "string (必填，要合成的语音文字内容)",
    "voice_id": "string (选填，默认 cixingnansheng，音色 ID)",
    "speed": "number (选填，默认 1.0，语速)",
    "volume": "number (选填，默认 0.9，音量)"
  }
  ```

### 5. `enhance_prompt`
* **功能描述**：使用 StepFun 的 `step-3.7-flash` 模型，将粗糙的视频提示词优化为高画质细节的专业分镜提示词。
* **参数 schema**：
  ```json
  {
    "prompt": "string (必填，原始提示词)"
  }
  ```

### 6. `submit_video_generation`
* **功能描述**：将优化的提示词、时长、分辨率等参数提交给 Seedance 2.0 API（Doubao 视频模型 `doubao-seedance-2-0-fast-260128`）发起视频生成任务。
* **参数 schema**：
  ```json
  {
    "prompt": "string (必填，生成提示词)",
    "duration": "integer (选填，默认 8，视频时长秒数)",
    "resolution": "string (选填，默认 720p)",
    "ratio": "string (选填，默认 16:9)",
    "first_frame_url": "string | null (选填，首帧图片 URL)",
    "watermark": "boolean (选填，默认 false，是否带水印)"
  }
  ```

### 7. `query_video_status`
* **功能描述**：通过任务的 `request_id` 查询 Seedance 视频生成的状态，返回生成中的进度、或成功后的视频与缩略图地址，或失败原因。
* **参数 schema**：
  ```json
  {
    "request_id": "string (必填，提交任务返回的 ID)"
  }
  ```

---

## 🚀 启动与部署指南

### 1. 本地直接启动 (HTTP 模式)
在本地需要有 Python 3.10+ 环境。

```bash
# 进入 mcp 文件夹
cd mcp

# 安装依赖
pip install -r requirements_mcp.txt

# 设置环境变量 (直接读取项目已有的配置)
$env:VITE_DEEPSEEK_API_KEY="你的DeepSeek_APIKEY"
$env:VITE_STEP_API_KEY="你的StepFun_APIKEY"
$env:VITE_VECTRUST_API_KEY="你的Vectrust_APIKEY"

# 启动服务
python mcp_shopro_server.py
```
启动后服务将在本地 `http://localhost:8080/mcp` 监听。官网部署的生产环境地址为：`https://f.playe.top/mcp`。

### 2. Docker Compose 一键启动 (推荐)
通过 Docker 可以保证环境绝对隔离且支持开箱即用：

```bash
# 进入 mcp 文件夹一键启动
cd mcp
docker compose -f docker-compose.mcp.yml up --build -d
```

---

## 🔌 客户端接入指南

### 1. Claude Desktop 接入 (Stdio 模式)
打开您的 Claude Desktop 配置文件 `%APPDATA%\Claude\claude_desktop_config.json`，在 `mcpServers` 下追加如下配置：

```json
{
  "mcpServers": {
    "shopro-ai-mcp": {
      "command": "python",
      "args": [
        "e:/Code/AI/Start/Web/Shopro AI/mcp/mcp_shopro_server_stdio.py"
      ],
      "env": {
        "VITE_DEEPSEEK_API_KEY": "你的DeepSeek_APIKEY",
        "VITE_STEP_API_KEY": "你的StepFun_APIKEY",
        "VITE_VECTRUST_API_KEY": "你的Vectrust_APIKEY"
      }
    }
  }
}
```
保存配置并重启 Claude Desktop，Claude 将自动获得调用 Shopro AI 完整带货视频 AIGC 生成的能力！

### 2. Cursor / Cherry Studio / MiXer AI 接入 (streamable-http 模式)
若使用支持 streamable-http 或 HTTP 接口的客户端，请在 MCP 设置中添加：
* **类型 (Type)**: `HTTP` 或 `streamable-http`
* **地址 (URL)**: `https://f.playe.top/mcp` (本地调试可使用 `http://localhost:8080/mcp`)

---

## 🧪 验证与测试
在服务部署后，可以通过 curl 发送标准的 `initialize` 请求检查握手是否成功：

```bash
curl -X POST https://f.playe.top/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}, "id": 1}'
```
若返回了包含 `Shopro AI E-Commerce AIGC Video System MCP Server` 及核心能力声明的 JSON，说明服务工作完全正常！本地调试时将 `https://f.playe.top/mcp` 替换为 `http://localhost:8080/mcp` 即可。
