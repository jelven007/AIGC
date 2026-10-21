// 创建微信支付订单 Edge Function
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Wechatpay } from 'npm:wechatpay-axios-plugin';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { beginCheckout, checkoutReceipt, CheckoutError, type CheckoutOrder } from '../_shared/checkout.ts';

async function createWechatPayUrl(
  MERCHANT_ID: string, MERCHANT_APP_ID: string, MCH_CERT_SERIAL_NO: string,
  MCH_PRIVATE_KEY: string, WECHAT_PAY_PUBLIC_KEY_ID: string, WECHAT_PAY_PUBLIC_KEY: string,
  outTradeNo: string, amount: number, notifyUrl: string,
): Promise<string> {
    const wxpay = new Wechatpay({
      mchid: MERCHANT_ID,
      serial: MCH_CERT_SERIAL_NO,
      privateKey: MCH_PRIVATE_KEY,
      certs: { [WECHAT_PAY_PUBLIC_KEY_ID]: WECHAT_PAY_PUBLIC_KEY },
    });
    const res = await wxpay.v3.pay.transactions.native.post({
      mchid: MERCHANT_ID,
      out_trade_no: outTradeNo,
      appid: MERCHANT_APP_ID,
      description: '电商AIGC带货视频平台 - 套餐升级',
      notify_url: notifyUrl,
      amount: { total: Math.round(amount * 100) },
    }, { timeout: 15000, headers: { 'Wechatpay-Serial': WECHAT_PAY_PUBLIC_KEY_ID } });
    const payload: unknown = res.data;
    const result = payload !== null && typeof payload === 'object'
      ? payload as Record<string, unknown> : {};
    if (typeof result.code_url === 'string' && /^weixin:\/\/wxpay\/bizpayurl\?/.test(result.code_url)) return result.code_url;
    throw new Error('支付地址待核对');
}

export async function handleWechatPaymentOrder(req: Request) {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  if (req.method !== 'POST') return json({ code: 1, message: '仅支持 POST', outcome: 'rejected' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let order: CheckoutOrder | undefined;
  try {
    // 验证用户 JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '') || '';
    if (!token || token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || token.startsWith('ak_')) {
      return json({ code: 1, message: '请使用个人登录会话', outcome: 'rejected' }, 401);
    }
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    ).auth.getUser(token);
    if (authErr || !user) return json({ code: 1, message: '认证失败', outcome: 'rejected' }, 401);

    const body = await req.json().catch(() => { throw new CheckoutError('支付参数非法', 400); });

    // 读取微信支付配置
    const MERCHANT_ID = Deno.env.get('MERCHANT_ID');
    const MERCHANT_APP_ID = Deno.env.get('MERCHANT_APP_ID');
    const MCH_CERT_SERIAL_NO = Deno.env.get('MCH_CERT_SERIAL_NO');
    const MCH_PRIVATE_KEY = Deno.env.get('MCH_PRIVATE_KEY');
    const WECHAT_PAY_PUBLIC_KEY_ID = Deno.env.get('WECHAT_PAY_PUBLIC_KEY_ID');
    const WECHAT_PAY_PUBLIC_KEY = Deno.env.get('WECHAT_PAY_PUBLIC_KEY');

    if (!MERCHANT_ID || !MERCHANT_APP_ID || !MCH_CERT_SERIAL_NO || !MCH_PRIVATE_KEY || !WECHAT_PAY_PUBLIC_KEY_ID || !WECHAT_PAY_PUBLIC_KEY) {
      throw new CheckoutError('微信支付暂未开通，请稍后重试或选择其他支付渠道', 503);
    }

    order = await beginCheckout(supabase, user.id, 'wechat', body);
    const receipt = checkoutReceipt(order);
    if (order.status !== 'pending' || order.wechat_pay_url) return json({ code: 0, data: {
      ...receipt, wechat_pay_url: order.status === 'pending' ? order.wechat_pay_url : null,
    } });
    const orderNo = order.order_no;
    const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/wechat-payment-webhook`;

    // 创建支付 URL
    const payResult = await createWechatPayUrl(
      MERCHANT_ID, MERCHANT_APP_ID, MCH_CERT_SERIAL_NO, MCH_PRIVATE_KEY,
      WECHAT_PAY_PUBLIC_KEY_ID, WECHAT_PAY_PUBLIC_KEY,
      orderNo, Number(order.total_amount), notifyUrl,
    );

    const { error: urlError } = await supabase.from('orders')
      .update({ wechat_pay_url: payResult, updated_at: new Date().toISOString() })
      .eq('id', order.id);
    if (urlError) throw new Error('支付地址保存回执待确认');

    return json({ code: 0, data: { ...receipt, wechat_pay_url: payResult } });
  } catch (e) {
    if (e instanceof CheckoutError) return json({ code: 1, message: e.message, outcome: e.outcome }, e.status);
    return json({ code: 1, message: '微信订单受理结果待核对，请恢复原支付请求', outcome: 'unknown',
      data: order ? checkoutReceipt(order) : null }, 503);
  }
}
Deno.serve(handleWechatPaymentOrder);
