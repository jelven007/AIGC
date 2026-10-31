# 迭代25：真实节拍、时间分段字幕与人物分割

00053与匹配任务接口、调度、FFmpeg镜像和编辑器已本地交付。已执行真实PCM/FFT、固定人物模型与FFmpeg成片验证；真实Whisper供应商、目标云端、长素材吞吐和全部生产系统仍需部署验收。本轮不构成上线回执。

## 后台音轨与原工程

新增`production_jobs.kind=edit_analysis`，`production-jobs/edit-prices`读取实际价格，`create`接受原UUID、`mode=beats|subtitles`、价格确认和可选本人`project_id`。`source`固定片段id/type/url/start/duration/sourceStart/speed；素材按本人私有媒体授权，原回执返回后不重新读取新供应商版本。每人最多三个pending/running/unknown分析；改价、其他工程和同UUID换参数均在扣费前拒绝。

默认节拍检测0积分、字幕3积分，价格来自`credit_costs`，不是供应商实际成本。明确失败按原流水退一次积分，未知受理继续预占。已有工程通过外键和本人授权绑定，任务中心可携带`editJob/importId`恢复原结果；没有本地回执也可恢复。

FFmpeg Worker以`edit_prepare`领取原素材，核对源时长，按`sourceStart/duration/speed`裁剪并变速，再提取16kHz单声道WAV。原文件SHA256、实际片段时长和租约回执随结果保存。没有音轨、素材长度不足或格式错误明确失败；预处理可以安全重试，不发生额外模型提交。

## 节拍与字幕

节拍使用`numpy`分块FFT：2048采样窗口、10ms步长，40–250Hz与全频正向频谱通量、局部阈值及180ms峰间隔。返回实际峰位置、算法版本、间隔稳定性和可选BPM。静音/低幅噪声不生成节拍；不足八个峰或间隔不稳定不估计BPM。检测峰不是对音乐拍号、重拍或人工标注精度的保证。

应用卡点时将相对音轨位置加回原时间轴开始位置，主视频按真实位置切分，保留原速度和源裁剪起点。至少保留250ms片段，超过80个轨道元素拒绝整次应用；带关键帧或淡变的片段保留供播放头切分。原音轨被裁剪、移动、变速或替换后拒绝应用旧结果。

字幕任务预处理后交由常驻调度以原`audio.asr`配置版本识别，只接受`openai-asr/whisper-1/verbose_json`时间分段。没有时间戳、越界、重叠或过短分段明确失败，不按句号或固定3.5秒生成时间轴。请求受理未知不重发；正文/分段先保存checkpoint，数据库结案故障重用原证据。

编辑器移除旧录音同步识别与固定时间铺轨，入口为“时间分段字幕”，选择已上传的音频/视频、确认价格并后台识别。时间戳加回原片段起点，不二次变速。用户确认应用后先保存工程再更新时间轴；字幕元素使用原job id，刷新后重复应用会拒绝。SRT和成片使用实际时间；FFmpeg字幕区间改为左闭右开，避免相邻字幕在边界同时显示。

## 人物透明蒙版

新增工程字段`personMask={model:"pphumanseg-2023mar",threshold:0.5,feather:1}`，服务端与Worker两次验证模型、阈值、平滑范围和色键互斥。编辑器保存“人物去背景”设置并在导出时应用到主视频，预览标签明确导出后生效。

镜像构建时获取OpenCV Zoo的PPHumanSeg ONNX，固定6163938字节及SHA256：

`552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24`

模型、Apache 2.0许可证和NOTICE随镜像存于`/opt/shopro-models`；运行时再次校验模型摘要，不在线下载模型。依赖固定`numpy==2.2.6/opencv-python-headless==4.11.0.86`。推理输入192×192，逐帧输出平滑alpha；透明帧以FFV1/BGRA临时视频保存，与原音轨分开进入FFmpeg，保留裁剪、速度、旋转显示方向和音轨。

源画面最多3200万像素，蒙版处理长边最多1920；单蒙版512MB、整工程蒙版768MB，临时空间少于128MB停止。最终成片限制1GB，编码截断或实际时长不符不结案成功。分割与合成共用总执行时限、租约心跳和取消检查。

人物模型不等同于绿幕，头发、快速移动和遮挡需检查实际成片。该低分辨率模型不是精细商业抠像、4K毛发质量或长片性能验收；保持现有4GB/2CPU Worker限制，目标环境必须按实际素材验证容量和质量。

## 验证与发布

- 真实PostgreSQL7项：并发原请求/价格/原模型恢复、输入/三任务配额/RPC、工程归属/RLS、阶段分工与旧租约、错误源/版本/分段与单退款、未知提交禁止重发/退款、空节拍与BPM/位置边界。
- 真实PCM/模型/FFmpeg5项：120 BPM峰与误差、裁剪变速240 BPM/原hash/时长、静音/噪声、实际人物alpha与原音轨/手机旋转、模型错误/取消，以及两处不同位置字幕的0.5秒边界无重叠。
- 协议6组：编辑参数/证据、原源裁剪切分与字幕偏移、原ASR版本/分段/结案恢复、超时未知/无时间戳失败、新Worker领取/服务端源绑定、源素材清理后保留终态回执且不续签历史输入；旧渲染协议增加人物模型和色键互斥校验。
- 真实Chromium开发和独立压缩页面：字幕响应丢失后刷新仅一个原请求、真实时间分段与重复应用拒绝，真实位置卡点与人物设置恢复，无回执任务链接恢复及390px弹窗。原转场/混合/色键页面回归；截图已检查。
- 原FFmpeg12项、任务中心、情报PG8项、调度9项与部署9项回归；TypeScript/Biome/规则/构建和两Edge Deno检查。

执行`npm run test:edit`、`node tests/browser_edit_analysis.mjs`及`npm run test:render`。人物媒体测试使用OpenCV公开`messi5.jpg`，本地缺失时下载到临时目录并校验固定SHA256，不写入产品素材或远端数据库。

发布范围00032–00053和匹配全栈；`production-jobs/production-worker`及共享模块、常驻调度、编辑器/MCP既有render:create权限必须同步。重建FFmpeg镜像，探针严格要求`version=14/required_migration=00053/render_version=3/edit_version=1`；旧render2镜像在领取前返回426，不消耗租约。分析预处理兼容原入口。

目标验收还包括真实Whisper用量/时间分段、多语言与口播质量、静音失败退款、旋转/多人物/遮挡、长素材CPU/临时空间及关页处理。最近官方云端仍00031/三旧函数，本轮未部署。多镜头配音字幕混剪发布编排、工单/租户/风控处置/现金成本、告警/备份恢复和真实部署继续执行。

依据：[PPHumanSeg模型与许可证](https://github.com/opencv/opencv_zoo/tree/main/models/human_segmentation_pphumanseg)、[官方预处理实现](https://github.com/opencv/opencv_zoo/blob/main/models/human_segmentation_pphumanseg/pphumanseg.py)。
