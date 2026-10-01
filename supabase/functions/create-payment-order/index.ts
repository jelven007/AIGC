// 创建微信支付订单 Edge Function
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Wechatpay } from 'npm:wechatpay-axios-plugin';
import ShortUniqueId from 'npm:short-unique-id';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, message: 'success', data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function err(message: string, status = 400) {
  return new Response(JSON.stringify({ code: 1, message, data: null }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateOrderNo(): string {
  const uid = new ShortUniqueId({ length: 8 });
  const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `ORD-${yymmdd}-${uid.rnd()}`;
}

async function createWechatPayUrl(
  MERCHANT_ID: string, MERCHANT_APP_ID: string, MCH_CERT_SERIAL_NO: string,
  MCH_PRIVATE_KEY: string, WECHAT_PAY_PUBLIC_KEY_ID: string, WECHAT_PAY_PUBLIC_KEY: string,
  outTradeNo: string, amount: number, notifyUrl: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
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
    }, { headers: { 'Wechatpay-Serial': WECHAT_PAY_PUBLIC_KEY_ID } });
    if (res.data.code_url) {
      console.log(`[WeChatPay SUCCESS] outTradeNo=${outTradeNo}`);
      return { success: true, url: res.data.code_url };
    }
    return { success: false, error: res.data.message || JSON.stringify(res.data) };
  } catch (e) {
    console.error(`[WeChatPay ERROR] ${e?.message}`);
    return { success: false, error: e?.message || String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // 验证用户 JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('未授权', 401);
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    ).auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return err('认证失败', 401);

    const body = await req.json();
    const { plan_id } = body as { plan_id: string };
    if (!plan_id) return err('缺少 plan_id');

    // 查询套餐价格
    const { data: plan } = await supabase
      .from('plans')
      .select('id, name, price, credits')
      .eq('id', plan_id)
      .maybeSingle();
    if (!plan) return err('套餐不存在');
    if (plan.price === 0) return err('免费套餐无需支付');

    // 读取微信支付配置
    const MERCHANT_ID = Deno.env.get('MERCHANT_ID');
    const MERCHANT_APP_ID = Deno.env.get('MERCHANT_APP_ID');
    const MCH_CERT_SERIAL_NO = Deno.env.get('MCH_CERT_SERIAL_NO');
    const MCH_PRIVATE_KEY = Deno.env.get('MCH_PRIVATE_KEY');
    const WECHAT_PAY_PUBLIC_KEY_ID = Deno.env.get('WECHAT_PAY_PUBLIC_KEY_ID');
    const WECHAT_PAY_PUBLIC_KEY = Deno.env.get('WECHAT_PAY_PUBLIC_KEY');

    if (!MERCHANT_ID || !MERCHANT_APP_ID || !MCH_CERT_SERIAL_NO || !MCH_PRIVATE_KEY || !WECHAT_PAY_PUBLIC_KEY_ID || !WECHAT_PAY_PUBLIC_KEY) {
      return err('微信支付配置未完成，请在插件中心配置密钥', 500);
    }

    const orderNo = generateOrderNo();
    const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/wechat-payment-webhook`;

    // 创建支付 URL
    const payResult = await createWechatPayUrl(
      MERCHANT_ID, MERCHANT_APP_ID, MCH_CERT_SERIAL_NO, MCH_PRIVATE_KEY,
      WECHAT_PAY_PUBLIC_KEY_ID, WECHAT_PAY_PUBLIC_KEY,
      orderNo, plan.price, notifyUrl,
    );

    if (!payResult.success) {
      return err(`微信支付创建失败：${payResult.error}`, 500);
    }

    // 写入订单
    const { data: order } = await supabase.from('orders').insert({
      order_no: orderNo,
      user_id: user.id,
      plan_id: plan.id,
      status: 'pending',
      total_amount: plan.price,
      wechat_pay_url: payResult.url,
    }).select('id, order_no, status, total_amount, wechat_pay_url, created_at').maybeSingle();

    return ok({
      order_no: order?.order_no ?? orderNo,
      order_id: order?.id,
      wechat_pay_url: payResult.url,
      plan_name: plan.name,
      amount: plan.price,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '服务内部错误';
    console.error('[create-payment-order]', msg);
    return err(msg, 500);
  }
});
