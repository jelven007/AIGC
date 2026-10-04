# Shopro AI 宣传视频尾页提示词文档 (vedio.md)

本文档为 **Shopro-跨境电商AIGC带货视频创作平台** 宣传视频 5 秒尾页（Outro / End Card）的 AI 视频生成提示词（Prompt）与分镜指南，支持 **Runway Gen-3 Alpha**、**Sora**、**可灵 AI (Kling)**、**即梦 AI (Dreamina)**、**Luma Dream Machine**、**海螺 AI (Hailuo)** 等主流 AI 视频生成大模型。

---

## 1. 视频基本参数 specs

| 参数项 | 参数值 / 规范 |
|---|---|
| **视频时长** | 5 秒 (5 Seconds) |
| **视频比例** | 横屏 `16:9` (1920×1080 / 4K) 或 竖屏 `9:16` (1080×1920) |
| **画面帧率** | 30 FPS / 60 FPS |
| **主画面镜头** | 4k 极清实景摄影风格，微动推镜头（Slow Zoom-in），高品质科技风播报/迎客场景 |
| **主角人物** | 20-25岁专业优雅的东亚/跨国女主持人/电商运营主播，身着简约时尚科技风职场装，面带真诚亲切笑容，手势招手欢迎 |
| **背景场景** | 极具未来感的 Shopro AI 跨境电商智能创作平台可视化工作站大屏，呈现实时视频流、波形图、多语言转化及数据大盘 |
| **核心标题** | **Shopro-跨境电商AIGC带货视频创作平台** |
| **Call to Action (CTA)** | **欢迎来体验!** |

---

## 2. 5秒逐秒分镜脚本 (Timeline Breakdown)

| 时间轴 | 镜头与人物动作 (Camera & Character Action) | 视觉特效与UI元素 (Visual & UI Effects) | 文本字幕与文案 (On-Screen Text & Audio) |
|---|---|---|---|
| **0.0s - 1.5s** | 镜头缓缓向前推进。一位气质亲切时尚的女性电商运营（职场优雅服装）立于高清透明光影工作台旁，微笑着抬起手臂向镜头热切招手。 | 背景中 Shopro AI 平台 UI 界面渐亮，浮现 AI 爆款视频生成动画波形与多国语言标签（英语、日语、东南亚语系）。 | 画面中央上方微亮粒子渐隐，出现品牌标题“**Shopro**”。 |
| **1.5s - 3.5s** | 女性人物保持自然优雅的站姿，右手伸出做迎接邀请手势，眼神充满诚意与自信，头微点头示意。 | 主标题大字光效扫过，科技蓝紫高光沿字体边缘流动，背景中的 AI 视频创作预览窗口不断高亮展现带货成果。 | 出现完整标题：<br>“**Shopro-跨境电商AIGC带货视频创作平台**” |
| **3.5s - 5.0s** | 镜头定格微推，女性人物双手自然交叠放置前侧，保持灿烂笑容，眼神专注聚焦观众。 | 底部闪烁晶莹微光的点击按钮/光芒汇聚，浮现 CTA 呼吁文字。 | 底部高亮呈现行动呼吁：<br>“**欢迎来体验!**”<br>*配音/音效：欢快跃动的科技感音效与热情配音* |

---

## 3. 多模型提示词方案 (AI Video Prompts)

### 3.1 Runway Gen-3 Alpha / Sora 专用提示词 (English Master Prompt)

> **Pro Text-to-Video Prompt (High Cinematic Realism)**:

```text
Cinematic 8k video, 5 seconds end card scene. A beautiful, friendly 24-year-old Asian female tech presenter with styled hair, wearing a sleek modern smart-casual blazer, standing in a futuristic glassmorphic Shopro AI digital e-commerce studio. She looks directly at the camera with a warm, genuine smile, waving her hand welcomingly at the audience, then smoothly bringing her hands together in front of her. 

In the background, a high-tech glowing holographic screen displays live AI video editing timelines, cross-border e-commerce analytics, product cards, and multi-language waveform badges in purple and cyan neon glass tones. Soft volumetric studio lighting, shallow depth of field, subtle push-in camera motion, highly realistic skin texture, photorealistic, 4k render, 60fps style.
```

### 3.2 可灵 AI (Kling AI) 提示词 (中文高清晰度)

> **提示词**:
```text
4K超高清，实拍电影级画质，5秒宣传视频尾页。一位24岁面带真诚热情笑容的时尚女性电商主播/主持人，身穿简约优雅的浅调科技感小西装，站在高科技Shopro AI数字电商工作站大屏前。她看着镜头，亲切地向观众微笑招手，手势自然流利。
背景是半透明玻璃态光影大屏，浮现出AI视频剪辑轨道、跨境电商数据大盘、多语种带货视频卡片与粒子光效，整体调性为科技蓝与活力紫色。镜头缓慢平稳向前推进，景深虚化自然，人物皮肤细节逼真，光影细腻，高端SaaS产品宣传片风格。
```

### 3.3 即梦 AI (Dreamina) / 海螺 AI (Hailuo) / Luma 提示词

> **提示词 (简明版)**:
```text
宣传片结尾5秒，一位年轻亲切的女性科技主播站在Shopro AI电商视频创作平台背景前，笑着向镜头热情招手迎接观众。背景是充满未来感的AI多语言视频编辑界面与高科技数字光影。镜头微推，画质极清，真实皮肤质感，商业科技广告大片质感。
```

---

## 4. 负面提示词 (Negative Prompts)

为了保证生成的女性主体人物形象真实、动作自然，无畸变，建议在 AI 视频生成软件中填写以下负面提示词：

```text
deformed hands, missing fingers, extra fingers, distorted face, unnatural eye motion, blurry, glitch, low resolution, plastic skin, cartoon, anime, 3d render avatar, weird posture, ugly, flickering, overexposed, noise, low quality, artifacts.
```

---

## 5. 后期花字与音频合成指南 (Post-Production Guide)

### 5.1 画面文字版式规范
1. **主标题**：
   - **内容**：“Shopro-跨境电商AIGC带货视频创作平台”
   - **字体**：无衬线科技感字体（如 思源黑体 Heavy / PingFang SC Bold / Inter Bold）
   - **字效**：白字带渐变科技蓝边框，微弱蓝色外发光（Glow Effect），扫光动画。
2. **行动呼吁 (CTA)**：
   - **内容**：“欢迎来体验!”
   - **样式**：采用高亮胶囊按钮形状（渐变紫蓝色 `#6366F1` -> `#8B5CF6`），配合脉冲微动 (Pulse Animation) 呼吸感光效。

### 5.2 音频与音效 (Audio & Sound Effects)
- **背景音乐 (BGM)**：轻快、有现代科技节奏感与未来感的水晶电子乐（Upbeat Corporate Tech Electronica）。
- **旁白/配音 (Voiceover)**：
  - 中文文案：“Shopro-跨境电商AIGC带货视频创作平台，欢迎来体验！”
  - 语调：热情、亲切、富有感染力与专业感。
- **音效 (SFX)**：在 0.5s 招手时加入轻柔 Swoosh 风声音效，在 3.5s 弹出“欢迎来体验!”按钮时加入清脆晶莹的 Shimmer/Ding 提示音。

---
*文档更新时间: 2026-08-20 | Shopro AI 团队*
