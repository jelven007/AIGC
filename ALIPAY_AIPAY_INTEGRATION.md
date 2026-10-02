# Shopro × 支付宝 AI 付（AI 网页应用收款）对接说明

> Skill：`@alipay/alipay-aipay` v1.7.0（安装路径 `C:\Users\Administrator\.agents\skills\alipay-aipay`）
> 产品：AI 网页应用收款（webpay），接口 `alipay.trade.page.pay`，签约 `salesCode=I1080300001000041203`、`appType=PC_WEB`
> 状态：**代码集成完成（本地静态校验通过）**；沙箱配置与运行时联调待用户提供密钥后补齐；签约入驻在 Windows 环境需人工前往支付宝 AI 付站点完成。

---

## 一、架构与时序

```
CreditsPage / PricingSection CTA
        │ POST plan_id（仅登录用户，金额不信任前端）
        ▼
alipay-payment-order (Edge Function)
  1. JWT 校验 → 2. plans 查价 → 3. orders 落库(pending, pay_channel=alipay)
  4. SDK pageExec('alipay.trade.page.pay','POST',…) 生成签名 HTML 表单
        │ { order_no, payment_html }
        ▼
前端 renderAndSubmitAlipayForm：渲染隐藏容器 + form.submit() 整页跳转支付宝收银台
        │ 用户付款完成
        ▼ 同步回跳（仅提示，不作支付依据）
/alipay-return (AlipayReturnPage)
  仅取 order_no，轮询 alipay-trade-query（服务端查单+金额校验+幂等补偿入账）
         ◀──── 并行 ────
alipay-payment-notify (异步通知，notify_url 配置后生效)
  formData 全量收集 → app_id 一致性 → checkNotifySignV2 验签 → 订单/金额/卖家校验
  → alipay_notify_events 唯一键幂等 → 仅 TRADE_SUCCESS/TRADE_FINISHED 付款事件入账 → 返回纯文本 success
```

支付结果唯一依据：**验签通过的异步通知** 或 **服务端交易查询**；前台同步跳转参数一律不信任。

## 二、改动文件清单

| 文件 | 类型 | 职责 |
|---|---|---|
| `supabase/migrations/00026_alipay_webpay.sql` | 新增 | orders 扩展 pay_channel/alipay_trade_no/refunded_amount；新表 alipay_notify_events、alipay_refunds |
| `supabase/functions/_shared/alipay.ts` | 新增 | 配置读取（缺失即抛错阻断 SDK 调用）、SDK 缓存、金额定点/比对、状态映射、驼峰/下划线双形态读取、幂等入账 finalizePaidOrder |
| `supabase/functions/alipay-payment-order/index.ts` | 新增 | 统一下单（JWT、服务端定价、pageExec 表单） |
| `supabase/functions/alipay-payment-notify/index.ts` | 新增 | 异步通知接收：表单解析、验签、字段校验、持久化幂等、发放积分 |
| `supabase/functions/alipay-trade-query/index.ts` | 新增 | 交易查询兜底（GET 参数拼 URL、归属校验、金额一致才补偿入账） |
| `supabase/functions/alipay-trade-ops/index.ts` | 新增 | 退款 / 退款查询 / 关闭交易（管理员权限、out_request_no 幂等、累计退款上限） |
| `src/api/alipay.ts` | 新增 | 前端 API 封装（下单、表单提交、查询、交易操作） |
| `src/pages/AlipayReturnPage.tsx` | 新增 | 同步回跳结果页（服务端轮询兜底） |
| `src/pages/CreditsPage.tsx` | 修改 | handleSelectPlan 改走支付宝下单；失败回退原手动扫码 PaymentDialog |
| `src/App.tsx` | 修改 | 注册 `/alipay-return` 懒加载路由 |
| `src/components/PricingSection.tsx` | 修改 | CTA 由滚动联系区改为进入 `/credits?tab=plans` |
| `.env` / `.env.example` | 修改 | ALIPAY_* 占位与注入说明（`.env` 已被 .gitignore 覆盖，无真实密钥） |

积分发放口径与微信渠道、`useCredits`/`creditGuard` 保持一致：套餐购买重置周期积分（`plan_purchase`）、加油包仅叠加（`booster_purchase`），写 `user_plans` + `credit_logs`（含 action/type/description/balance_after）。

## 三、环境变量（Edge Function Secrets）

全部通过 `supabase secrets set` 注入；**任一必填项缺失时下单/回调函数返回 503，不会以占位值调用真实 SDK**。

| 变量 | 必填 | 说明 |
|---|---|---|
| `ALIPAY_APP_ID` | 是 | 支付宝应用 ID（沙箱/生产各一套，不得混用） |
| `ALIPAY_PRIVATE_KEY` | 是 | 应用私钥，Node 等非 Java 使用**原始 PKCS#1**（不加 PEM 头尾、不做格式转换） |
| `ALIPAY_PUBLIC_KEY` | 是 | 支付宝公钥（验签通知与响应） |
| `ALIPAY_GATEWAY` | 是 | 沙箱 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`；生产 `https://openapi.alipay.com/gateway.do` |
| `ALIPAY_SITE_URL` | 建议 | 本站公网基址，用于拼 `return_url`（缺省则不传，仅保留查询兜底） |
| `ALIPAY_NOTIFY_URL` | 生产必须 | `{SUPABASE_URL}/functions/v1/alipay-payment-notify`；本地无公网时省略（禁止空串/占位） |
| `ALIPAY_SELLER_ID` / `ALIPAY_SELLER_EMAIL` | 可选 | 配置后回调额外校验卖家账号 |

注入示例：
```powershell
supabase secrets set ALIPAY_APP_ID=xxx ALIPAY_PRIVATE_KEY=yyy ALIPAY_PUBLIC_KEY=zzz ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do ALIPAY_SITE_URL=https://your-domain
```

## 四、接口清单与示例

### 1. 下单 `POST /functions/v1/alipay-payment-order`（需 JWT）
请求：`{ "plan_id": "<uuid>" }`
响应：`{ code:0, data: { order_no, order_id, payment_html, plan_name, amount } }`
`payment_html` 为 pageExec 生成的自提交表单；前端渲染后 `form.submit()` 整页跳转。

### 2. 异步通知 `POST /functions/v1/alipay-payment-notify`
`application/x-www-form-urlencoded`；处理链：验签 → app_id/out_trade_no/total_amount/seller 校验 → `alipay_notify_events` 唯一键(notify_id,trade_no,trade_status)幂等 → 仅付款成功事件（排除 out_biz_no/gmt_refund/refund_fee）入账 → 返回纯文本 `success`/`fail`。

### 3. 交易查询 `GET /functions/v1/alipay-trade-query?order_no=xxx`（需 JWT，仅限本人订单）
响应 `data`: `{ order_no, local_status, trade_status, amount }`；`TRADE_SUCCESS/TRADE_FINISHED` 且金额一致时执行幂等补偿入账（与通知互斥，不重复发放）。前端调用必须拼 URL：
```ts
supabase.functions.invoke(`alipay-trade-query?order_no=${orderNo}`, { body: {} })
```

### 4. 交易操作 `POST /functions/v1/alipay-trade-ops`（退款/退款查询仅管理员 profiles.role='admin'）
- 退款 `{ action:'refund', order_no, refund_amount, refund_reason? }`：新退款生成新 `out_request_no`；异常重试**复用原编号与参数**；累计退款 ≤ 实付；`fund_change=Y` 或 `refund_status=REFUND_SUCCESS` 才计成功，否则落 `unknown` 待查询确认。
- 退款查询 `{ action:'refundQuery', order_no, out_request_no }`：调用间隔 ≥ 10 秒；`REFUND_SUCCESS` 时补记 `orders.refunded_amount` 与 `refunded/partial_refunded` 状态。
- 关闭 `{ action:'close', order_no }`：仅 pending 订单；`ACQ.TRADE_NOT_EXIST` 直接本地取消。

## 五、数据库变更落地（托管 Supabase 必读）

`00026_alipay_webpay.sql` 已随仓库提交，但 **git push 不会自动应用到托管库**（本项目历史教训）。必须在 Supabase Dashboard SQL 编辑器或 `supabase db push` 手动执行一次。脚本幂等（IF NOT EXISTS），重复执行安全。新表 `alipay_notify_events`/`alipay_refunds` 均开启 RLS 且无策略，仅 service_role 可读写。

## 六、沙箱测试

### 当前结论
本轮为 **本地生产参数验收模式**：代码与静态检查通过；沙箱应用配置待注入（VERIFY_PENDING），以下运行时验证项**尚未执行**，不宣称"沙箱测试通过"或"生产就绪"。

### 配置检查清单（沙箱运行前置）
1. 支付宝开放平台沙箱环境申领：应用 ID、应用私钥（生成密钥工具选 PKCS#1/非 Java）、支付宝公钥。
2. `supabase secrets set` 注入第三节全部沙箱值；`ALIPAY_GATEWAY` 用沙箱网关。
3. 托管 Supabase 手动执行 `00026_alipay_webpay.sql`。
4. 部署 Edge Functions：`supabase functions deploy alipay-payment-order alipay-payment-notify alipay-trade-query alipay-trade-ops`。
5. 异步通知联调需公网 HTTPS `notify_url`（当前托管域名部署后即为 `{SUPABASE_URL}/functions/v1/alipay-payment-notify`；本地调试需内网穿透工具，支付宝不支持 http/局域网地址）。
6. 同步回跳域名 `ALIPAY_SITE_URL` 必须为已确认的真实域名（禁止占位域名）。

### 待补跑的验证矩阵（沙箱就绪后逐项执行并留证）
| 场景 | 预期 | 证据 |
|---|---|---|
| 正常下单支付 | orders: pending→paid，alipay_trade_no 写入；credit_logs 新增 purchase 记录；积分余额同步 | 沙箱订单号 + 表数据 |
| 回调验签 | 验签通过后入账返回 success；`invalid-signature` 时优先排查通知参数一致性 | 函数日志（脱敏） |
| 取消/关闭 | 订单保持 pending 或转 cancelled；close 后无法付款 | orders 状态 |
| 重复通知 | 第二条命中唯一键直接回 success，不二次发放 | alipay_notify_events 冲突日志 |
| 金额篡改/非法回调 | app_id 不符/验签失败/金额不符 → 返回 fail，订单不动 | 函数日志 |
| 查询兜底 | 通知未达时 /alipay-return 轮询触发补偿入账，结果与通知一致 | trade-query 响应 |

### 沙箱付款操作顺序（密钥注入后）
启动 `pnpm dev` → 浏览器进入 `/credits?tab=plans` → 点击「立即升级」→ 跳转沙箱收银台 → 二选一：①收银台内输入沙箱买家账号+登录密码+支付密码；②（仅 Android）沙箱支付宝 App 扫码后输支付密码 → 回跳 `/alipay-return` 查看结果。

## 七、签约入驻进度（阶段 5）

Windows 环境不支持通过 Skill 自动执行开通流程，已由登记消息交付官方门户链接。**以下操作必须由用户本人在支付宝后台完成，Agent 未代为执行任何步骤**：

1. 打开支付宝 AI 付站点（Skill 收口消息中的链接）→ 登录支付宝账号（企业账号建议）。
2. 开通「AI 网页应用收款」产品：`productType=webpay`，`salesCode=I1080300001000041203`，`appType=PC_WEB`。
3. 准备资质：营业执照、法人信息、经营类目（MCC，按实际经营内容选择：软件/SaaS/内容创作服务类）；webpay 签约需 **3 张网站截图**（首页、套餐/定价页、作品或功能页）。
4. 创建/绑定线上应用，生成密钥对（工具选非 Java → PKCS#1），上传应用公钥获取支付宝公钥。
5. 配置异步通知地址与回跳地址白名单（正式域名），提交审核。

### 沙箱 → 生产切换清单
| 项 | 沙箱值 | 生产动作 |
|---|---|---|
| `ALIPAY_APP_ID` | 沙箱应用 ID | 替换为**同一生产应用**的 appId |
| `ALIPAY_PRIVATE_KEY` | 沙箱私钥 | 替换为生产应用私钥（PKCS#1，同一套密钥对，禁止混用） |
| `ALIPAY_PUBLIC_KEY` | 沙箱支付宝公钥 | 替换为生产支付宝公钥（与生产 appId 成套） |
| `ALIPAY_GATEWAY` | openapi-sandbox.dl.alipaydev.com | `https://openapi.alipay.com/gateway.do` |
| `ALIPAY_NOTIFY_URL` | 可省略（查询兜底） | **必须**配置公网 HTTPS 并完成真实回调联调 |
| `ALIPAY_SITE_URL` | 开发域名 | 正式生产域名（HTTPS） |
| 产品开通状态 | 沙箱无需开通 | 确认「AI 网页应用收款」生产环境已开通 |

切换后最小回归：①下单→真机小额支付→验签通知入账→积分到账；②/alipay-return 回跳查询正确；③退款一笔→fund_change/退款查询确认→refunded_amount 正确；④重复通知不二次发放。

## 八、故障排查要点

- **验签失败 `invalid-signature`**：先核对通知参数是否被网关/中间件改写（必须 formData 原样全量收集、不改名不改值），再核对 `ALIPAY_PUBLIC_KEY` 与该 app_id 是否成套；私钥格式问题通常报在**请求签名**而非通知验签。
- **回调不到**：检查 notify_url 是否公网 HTTPS、无重定向、无空格/HTML 标签；函数是否部署；先查 orders 是否有 pending 单再用 trade-query 对账补偿。
- **订单不一致**（支付宝已支付本地 pending）：以 `alipay-trade-query` 为准手动补偿；若 credit_logs 与 user_plans 不一致，检查 finalizePaidOrder 日志（乐观锁保证只会单侧发放）。
- **退款结果未知**：`fund_change` 非 Y 时禁止视为成功，≥10 秒后用原 `out_request_no` 调 `refundQuery`；重试退款必须复用原编号与参数。
- **503 支付配置未完成**：Secrets 未注入或拼写不符，按第三节补注入。

## 九、本地校验记录

- `npx tsc -p tsconfig.check.json`：38 个错误全部位于存量页面（AnalyticsPage/AvatarsPage/ScriptPage 等），**本轮新增/修改文件 0 错误**；`tsgo` 本机未安装（lint 脚本既有环境问题）。
- `npx biome lint`：通过（151 files）。
- `pnpm build`（vite build）：通过。
- `.rules` 人工核对：Edge Function GET 调用参数拼 URL ✔；toast 沿用 sonner ✔；按钮交互保留 ✔。
