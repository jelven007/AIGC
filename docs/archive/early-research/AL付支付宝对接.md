# 支付宝对接资料入口

更新：2026-10-21。实际接口、GET查单、RSA2验签、订单快照和原子权益发放统一见 [支付与积分方案](../../plan/支付.md)。旧示例不再用于部署，正确收款入口为alipay-payment-order、alipay-payment-notify、alipay-trade-query。

商户/沙箱未验收；遗留alipay-trade-ops现金退款尚缺完整授权、并发/幂等/权益回收闭环，不纳入生产自动退款。当前环境与验收分别见 [状态](../../CURRENT_STATE.md)、[测试](../../testing/TEST_PLAN.md)。
