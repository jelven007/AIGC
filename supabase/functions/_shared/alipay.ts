// 支付宝 AI 网页应用收款（网站支付）共享模块
// 依据：alipay.trade.page.pay / alipay.trade.query / alipay.trade.refund /
//       alipay.trade.fastpay.refund.query / alipay.trade.close / 异步通知本地契约
// 密钥全部来自 Edge Function Secrets（supabase secrets set），禁止硬编码。
// deno-lint-ignore-file no-explicit-any
import { AlipaySdk } from 'npm:alipay-sdk@4.14.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export class AlipayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlipayConfigError';
  }
}

export interface AlipayRuntimeConfig {
  appId: string;
  gateway: string;
  notifyUrl: string; // 允许为空字符串：本地验收模式省略 notify_url
  siteUrl: string;   // 同步回跳结果页基址，如 https://f.playe.top
  sellerId: string;  // 允许为空字符串：未配置时跳过卖家校验
  sellerEmail: string;
}

/** 读取并校验运行时支付配置；密钥缺失时抛 AlipayConfigError（调用方返回 503） */
export function getAlipayConfig(): AlipayRuntimeConfig {
  const appId = (Deno.env.get('ALIPAY_APP_ID') || '').trim();
  const privateKey = (Deno.env.get('ALIPAY_PRIVATE_KEY') || '').trim();
  const alipayPublicKey = (Deno.env.get('ALIPAY_PUBLIC_KEY') || '').trim();
  const gateway = (Deno.env.get('ALIPAY_GATEWAY') || '').trim();
  if (!appId || !privateKey || !alipayPublicKey || !gateway) {
    throw new AlipayConfigError('支付宝支付配置未完成，请通过 supabase secrets set 注入 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY / ALIPAY_GATEWAY');
  }
  return {
    appId,
    gateway,
    notifyUrl: (Deno.env.get('ALIPAY_NOTIFY_URL') || '').trim(),
    siteUrl: (Deno.env.get('ALIPAY_SITE_URL') || '').trim(),
    sellerId: (Deno.env.get('ALIPAY_SELLER_ID') || '').trim(),
    sellerEmail: (Deno.env.get('ALIPAY_SELLER_EMAIL') || '').trim(),
  };
}

let sdkCache: { key: string; sdk: AlipaySdk } | null = null;

/**
 * 创建（并缓存）支付宝 SDK 实例。
 * 私钥使用不加 PEM 头尾的原始 PKCS#1 字符串（Node/非 Java 语言规范，keyType 默认 PKCS1）。
 */
export function createAlipaySdk(): AlipaySdk {
  const appId = (Deno.env.get('ALIPAY_APP_ID') || '').trim();
  const privateKey = (Deno.env.get('ALIPAY_PRIVATE_KEY') || '').trim();
  const alipayPublicKey = (Deno.env.get('ALIPAY_PUBLIC_KEY') || '').trim();
  const gateway = (Deno.env.get('ALIPAY_GATEWAY') || '').trim();
  const key = `${appId}|${gateway}|${alipayPublicKey.length}`;
  if (sdkCache && sdkCache.key === key) return sdkCache.sdk;
  const config = getAlipayConfig();
  const sdk = new AlipaySdk({
    appId: config.appId,
    privateKey,
    alipayPublicKey,
    gateway: config.gateway,
    signType: 'RSA2',
    charset: 'utf-8',
  });
  sdkCache = { key, sdk };
  return sdk;
}

/** 将金额归一化为“元”为单位、保留两位小数的字符串；非法输入返回 null。禁止浮点直接比较金额 */
export function normalizeAmountText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return `${BigInt(match[1]).toString()}.${(match[2] || '').padEnd(2, '0')}`;
}

export function amountEquals(expected: unknown, actual: unknown): boolean {
  const a = normalizeAmountText(expected);
  const b = normalizeAmountText(actual);
  return a !== null && a === b;
}

/** 支付宝交易状态显式映射：仅 TRADE_SUCCESS / TRADE_FINISHED 视为已支付 */
export function mapTradeStatus(tradeStatus: unknown): 'PAID' | 'PENDING_PAYMENT' | 'CLOSED' | 'UNKNOWN' {
  switch (String(tradeStatus || '')) {
    case 'TRADE_SUCCESS':
    case 'TRADE_FINISHED':
      return 'PAID';
    case 'WAIT_BUYER_PAY':
      return 'PENDING_PAYMENT';
    case 'TRADE_CLOSED':
      return 'CLOSED';
    default:
      return 'UNKNOWN';
  }
}

/** SDK exec 响应在 camelcase 配置下键名可能为驼峰，两种形态兼容读取 */
export function readResultField(res: any, snake: string): any {
  if (res == null) return undefined;
  return res[snake] ?? res[snake.replace(/_([a-z])/g, (_m, c) => c.toUpperCase())];
}

/** 订单标题净化：禁止 / = & 等特殊字符 */
export function sanitizeSubject(text: string): string {
  return text.replace(/[\/=&?%#]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 256);
}

/**
 * 付款成功通知判定：TRADE_SUCCESS/TRADE_FINISHED 且不含退款/关账/分账等事件特征。
 * params 为支付宝异步通知的原始表单参数 map。
 */
export function isPaidTradeNotification(params: Record<string, string>): boolean {
  const paid = params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED';
  return paid && !params.out_biz_no && !params.gmt_refund && !params.refund_fee;
}

/** 脱敏记录通知参数（剔除 sign），失败不影响主流程 */
export function safeLogNotifyError(logger: { warn: (...args: unknown[]) => void }, message: string, params: Record<string, string>) {
  try {
    const { sign, sign_type, ...safe } = params;
    logger.warn(message, safe);
  } catch {
    // 日志失败不影响返回 fail
  }
}

export interface PaidFinalizeResult {
  outcome: 'granted' | 'already_processed' | 'order_missing';
  userId?: string;
}

/**
 * 幂等入账：乐观锁将 pending 订单置为 paid，并按套餐发放积分/权益 + 写审计日志。
 * 与 wechat-payment-webhook 的发放口径保持一致（plans.level < 0 为加油包只加积分）。
 * 重复调用（通知 + 查询补偿并发）时第二次不会重复发放。
 */
export async function finalizePaidOrder(
  admin: SupabaseClient,
  outTradeNo: string,
  alipayTradeNo: string | null,
): Promise<PaidFinalizeResult> {
  const nowIso = new Date().toISOString();
  const { data: updated, error } = await admin
    .from('orders')
    .update({
      status: 'paid',
      paid_at: nowIso,
      updated_at: nowIso,
      alipay_trade_no: alipayTradeNo,
    })
    .eq('order_no', outTradeNo)
    .eq('status', 'pending')
    .select('id, user_id, plan_id, total_amount')
    .maybeSingle();

  if (error) {
    console.error(`[alipay] finalizePaidOrder update failed for ${outTradeNo}: ${error.message}`);
    throw error;
  }
  if (!updated) {
    // 乐观锁未命中：订单已处理（重复通知/补偿查询）或不存在
    const { data: existing } = await admin
      .from('orders')
      .select('id, user_id, status')
      .eq('order_no', outTradeNo)
      .maybeSingle();
    if (!existing) return { outcome: 'order_missing' };
    return { outcome: 'already_processed', userId: existing.user_id ?? undefined };
  }

  const { data: plan } = await admin
    .from('plans')
    .select('id, credits, name, level')
    .eq('id', updated.plan_id)
    .maybeSingle();

  if (plan && updated.user_id) {
    if (plan.level < 0) {
      // 流量加油包：仅叠加积分，不改变当前套餐
      const { data: currentPlan } = await admin
        .from('user_plans')
        .select('credits_total, plan_id, status')
        .eq('user_id', updated.user_id)
        .maybeSingle();
      const currentCreditsTotal = currentPlan?.credits_total || 0;
      await admin.from('user_plans').upsert({
        user_id: updated.user_id,
        plan_id: currentPlan?.plan_id ?? plan.id,
        credits_total: currentCreditsTotal + plan.credits,
        status: currentPlan?.status || 'active',
        updated_at: nowIso,
      }, { onConflict: 'user_id' });
      await admin.from('credit_logs').insert({
        user_id: updated.user_id,
        type: 'purchase',
        action: 'booster_purchase',
        amount: plan.credits,
        balance_after: currentCreditsTotal + plan.credits,
        credits_after: currentCreditsTotal + plan.credits,
        description: `支付宝购买加油包：${plan.name}（订单 ${outTradeNo}）`,
      });
    } else {
      // 套餐购买：开通套餐并重置周期积分
      const now = new Date();
      const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();
      await admin.from('user_plans').upsert({
        user_id: updated.user_id,
        plan_id: plan.id,
        credits_total: plan.credits,
        credits_used: 0,
        cycle_start: nowIso,
        cycle_end: cycleEnd,
        expires_at: cycleEnd,
        status: 'active',
        updated_at: nowIso,
      }, { onConflict: 'user_id' });
      await admin.from('credit_logs').insert({
        user_id: updated.user_id,
        type: 'purchase',
        action: 'plan_purchase',
        amount: plan.credits,
        balance_after: plan.credits,
        credits_after: plan.credits,
        description: `支付宝购买套餐：${plan.name}（订单 ${outTradeNo}）`,
      });
    }
  }

  console.log(`[alipay] order ${outTradeNo} paid, credits granted for user ${updated.user_id}`);
  return { outcome: 'granted', userId: updated.user_id ?? undefined };
}
