# 迭代34：图片编辑与工具入口

日期：2026-10-22。新增00062；production probe22/required_migration=00062，render4/edit2与MCP59工具/19权限保持。本地源码和隔离验收不等于目标环境上线。

## 实际新增

- 图片工作台增加扩图和局部重绘。原图缩放到所选标准画布；扩图以透明边缘作为编辑区，局部重绘用可键盘操作的矩形百分比指定范围。用户确认使用权后，分别保存PNG原图与透明掩码到私有素材库。修改尺寸、模式或范围使旧准备失效。
- `image.primary`的OpenAI Images协议增加可选`edit_endpoint`。配置须为生成地址同域、同路径的`images/edits`，并使用官方支持的GPT Image模型ID；保留旧配置无需编辑地址。模型目录只回传编辑能力和不含秘密的版本ID，不回传接口或凭据。
- 官方编辑请求使用`images:[{image_url:...}]`与`mask:{image_url:...}`的JSON契约、`n=1`和PNG输出。服务端读取并验证私有素材后使用数据URL发送，不把存储签名或服务端存储凭据交给供应商。参考图也可使用该协议，chat-image保留已有参考图路径。
- API和工作进程共用模式/能力验证。掩码编辑原图和掩码须同尺寸，采用标准尺寸的8位RGB/RGBA、非交错PNG；原图与掩码实际解压长度受限，掩码须同时包含全透明编辑区和不透明保留区。非法格式、外部掩码、越权访问和尺寸不一致在创建扣费任务前拒绝。
- 00062在原事务内锁定账号、模型和价格，检查所确认版本/价格、素材权限与实际存储对象，再复用原`generate_image`或`generate_cover`流水。没有新增独立余额或退款体系。同一UUID/同一输入返回原任务，原模型禁用和价格变化后仍可读取；同一UUID改输入被拒绝。
- 已执行但结果未知仍进入unknown，不自动重发；确定HTTP拒绝按原流水结案。已有checkpoint的归档恢复不下载源素材、不再次调用模型。旧配置版本和原任务证据继续保留。
- 通用production请求固定当前取得的JWT，图片/渲染hook额外核对发起账号；15秒请求上限后保留原回执。同步锁防重复提交，离页或切换账号后的迟到成功/失败不更新新页面、不弹旧账号成功提示。手动进度读取错误可重试。
- 工具箱移除硬编码24.8万、增长、效率和好评率，统计来自实际入口、分类、筛选和支持的平台数。发布入口指向`/publish`，导出和图片编辑独立入口；说明与真实授权数据、模型和任务流程一致。首页快捷入口同步更新，搜索支持空白修剪与大小写，分类/模式有选中语义。

## 契约与限制

`production-jobs`的`kind=image`请求继续使用原`request_key`，输入支持：

```json
{
  "mode": "outpaint",
  "prompt": "延续自然光背景，检查商品外形与文字",
  "size": "1024x1024",
  "quality": "low",
  "reference_image": "https://后端/storage/v1/object/authenticated/materials/用户/原图.png",
  "mask_image": "https://后端/storage/v1/object/authenticated/materials/用户/掩码.png",
  "confirmed_credit_cost": 10,
  "confirmed_model_version": "已确认的图片配置版本UUID"
}
```

`mode`为generate/reference/inpaint/outpaint；未带mode的旧输入按是否有参考图识别。掩码编辑必须确认价格与模型版本。费用变化或模型更新返回409，可在当前页“刷新图片配置与价格”后再次确认；生成失败保留描述与素材。

每个编辑输入文件最多12MB，浏览器原图最多1600万像素。扩图原图占画布30–90%；局部重绘矩形不得超出画布。掩码是模型参考，不承诺保留区域逐像素不变，商品外形、文字与画质需检查。当前提供单张参考图和矩形编辑区，未提供自由画笔或16张参考图界面。

模型ID目录依据官方文档，不代表经营方已开通权限。实际模型、组织验证、质量、真实现金成本、容量和长任务仍需目标验收。尚未恢复官方管理访问，不能把本地测试当作云端部署。

官方协议依据：

- [Create image edit](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)

## 验证与发布

`test:image-editing`包含4项真实PostgreSQL事务回归、6组实际共享模块协议回归及probe22预检；覆盖并发一次扣费、价格/素材/权限拒绝、原配置禁用后恢复、unknown不重领、原流水唯一退款、实际透明PNG解码、供应商JSON和归档仅调用一次。`test:image-editing-ui`在开发与独立压缩页面分别验证入口、画布/掩码、权限、原UUID关页恢复、价格刷新保留素材/描述、区域修改失效、能力缺失及迟到账号响应。

| 验证 | 结果 |
| --- | --- |
| 图片真实PG / 共享模块协议 / probe | 4项 / 6组 / 缺schema拒绝，通过 |
| 原财务、生产任务、模型配置 | 33项真实PG / 7组 / 9组，通过 |
| 调度、火山发布工具 | 11项 / 10项（含真实迁移事务）及4组协议，通过 |
| 开发、独立压缩图片页面 | 各5组，通过 |
| 压缩个人中心/分镜、积分/SMS、生产入口、导出 | 4组 / 5组 / 3组 / 2组，通过 |
| 静态检查与构建 | TypeScript、lint、Deno，正式与隔离压缩构建，通过 |
| 调度镜像与火山prepare | 镜像重建；60个生产迁移清单准备，通过 |

其余验证见本轮`.iteration34-*.log`与[测试计划](../../testing/TEST_PLAN.md)。测试素材和身份均为隔离夹具，不连接真实模型、商户、SMS或平台。

发布需匹配官方待发布00032–00062、全部函数与共享模块、production-worker、probe22调度镜像及前端。新增`image_editing_schema_ready()`为service-only；旧probe21不通过当前发布核验。火山prepare与正式官方目标相互独立。
