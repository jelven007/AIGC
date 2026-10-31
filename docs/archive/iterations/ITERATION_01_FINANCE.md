# 第一轮：支付与积分安全

> 历史记录：本文保存对应迭代/审计时点的事实与建议，旧行号、Mock、密钥来源、收费、部署状态和未完成清单不作为当前操作依据。2026-10-21 最新基线 ce90bfe，环境见 [当前状态](../../CURRENT_STATE.md)，闭环关系见 [追踪矩阵](../../CHANGE_TRACEABILITY.md)，本轮实测见 [验证报告](../reviews/TEST_REPORT_20261021.md)。
> 后续工作区变更另见 [待验收开发](../../PENDING_CHANGES.md)，不能追记为历史迭代已完成。

本轮把订单支付、套餐发放和积分流水合并为数据库事务，收紧资金表写权限，并增加可重复运行的本地回归。尚未部署到远端 Supabase。

## 已实现

- 支付宝查询实际使用 GET；重复通知即使审计事件已存在，也会重新尝试入账。
- 微信回调先校验 RSA-SHA256 签名、原始请求体、时间戳和公钥序列号，再解密并核对应用、商户、CNY 总金额及交易号。
- `finalize_paid_order` 在同一事务中发放权益、写流水并标记订单已支付；同一订单及同一支付渠道的交易号最多入账一次。加油包并发购买采用数据库增量，保留原套餐与已使用积分。
- 数据库在创建订单时保存套餐名称、级别及积分快照，支付后按快照发放；微信创建上游支付前先保存本地订单。
- 用户仅能读取自己的订单、套餐、积分流水及任务。套餐价格、积分单价、活动和模型缓存也禁止客户端写入。
- 扣费必须为正整数，返回 `charge_id`。退款只允许可信后端通过原扣费流水调用 `refund_credit_charge`；并发重复退款最多返还一次。跨周期退款补入总积分，不冲掉新周期消费。
- AI 网关先限流、查缓存，再扣费；同步请求异常按本次扣费流水补偿。退款失败会保留本次计费成本供核对。缓存按用户隔离，并保留嵌套请求参数，避免混用响应。
- 新注册用户的档案、免费套餐和 20 积分赠送流水在同一事务初始化；前端不再自行写入初始积分或显示虚构余额。
- 活动奖励由 `claim_activity_reward` 校验、限次和原子发放。首次登录可直接领取，签到按 UTC 每天一次，首次视频依赖后台任务完成记录；没有后台证据的活动暂不自动发奖。
- 主工作台不再用预置视频替代失败结果，也不再将数字人素材替换模型真实输出；未接入模型在扣费前拒绝提交。
- 旧 `ai-assistant.generate_video/retry_video_job` 处理器暂停使用，返回 503；旧五步创建页在扣费前提示改用首页。移除其伪造进度、作品及任务完成记录的分支。

## 迁移与发布顺序

1. 已部署数据库应具备 00026 的支付字段，以及 00012/00023 的成本配置和台账结构。备份数据库后依次执行 `00028_atomic_billing_and_payment.sql`、`00029_atomic_activity_rewards.sql`。
2. 配置微信 `WECHAT_PAY_PUBLIC_KEY_ID`、`WECHAT_PAY_PUBLIC_KEY`（SPKI 公钥 PEM）、`MCH_API_V3_KEY`、`MERCHANT_APP_ID`、`MERCHANT_ID`，支付宝沿用原支付 Secrets。
3. 部署 `_shared` 及相关函数：`ai-assistant`、`alipay-payment-order`、`alipay-payment-notify`、`alipay-trade-query`、`create-payment-order`、`wechat-payment-webhook`。支付回调不要求 Supabase JWT，改由函数内支付签名鉴权，已写入 `supabase/config.toml`。
4. 最后发布前端。新版前端依赖扣费 RPC 返回 `charge_id`；不要只部署前端。
5. 用支付沙箱验收正确通知、错误签名、金额不一致、重复通知、查询与通知并发、发放失败后重试。当前只有本地测试，尚未进行真实支付联调。

本轮修复 00022 的错误模板表名、00024 的函数返回类型变更与限流 RPC 签名，以及 00023 的非 immutable 时区索引。用于新环境重放；已部署环境仍只应用新增迁移，不重放历史。

历史 `paid` 订单没有 `entitlement_granted_at` 标记，不自动补发，需核对原流水后人工处理。历史待支付订单只能按迁移时的套餐数据补快照，无法还原已丢失的下单时权益。原有余额不强制重置。

## 本地验证

需要 Python 3、Docker 和 `postgres:16`。数据库测试自动创建并清理独立容器，不开放端口，不使用远端密钥；执行真实迁移，排除引用线上固定 UID 的 00018/00019 样例数据。它模拟 Supabase 的 Auth/Storage schema，不包含真实 Auth 服务、PostgREST 和支付 SDK 联调。

```sh
python3 tests/test_finance.py
node tests/run_wechat.mjs
node tests/ai_billing.test.mjs
node tests/payment_notify.test.mjs
npm run build
```

本机无 Node 时，Node 命令可在 `node:20-alpine` 容器内运行（项目挂载到 `/app`，工作目录 `/app`）。测试只需要项目的 TypeScript 依赖。

验证结果：12 个真实数据库用例、2 个微信 WebCrypto 用例、6 个 AI 计费用例、2 个支付宝通知补偿用例通过；生产构建通过。微信用例另在原生 Deno 2.2.6 通过；第二轮中四个支付函数通过 Deno 类型检查。尚未完成实际支付 SDK 与支付平台的运行联调。

## 下一轮边界

主工作台当前仍由浏览器预扣积分并轮询模型；批量任务尚无消费执行器。由于浏览器无法证明任务实际失败，旧自助退款接口返回 409，当前失败扣费需客服对账。下一轮应实现服务端创建与查询任务、持久化 provider task ID、受控状态机、扣费关联、超时重试及自动退款，再恢复旧创建页或合并到主工作台。

第一轮发现的 23 处既有 TypeScript 错误已在第二轮清除；当前 `npm run typecheck`、Biome 和生产构建均通过，详见 `ITERATION_02_TYPECHECK.md`。
