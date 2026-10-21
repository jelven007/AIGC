import { createServiceClient } from '../_shared/auth.ts';
import { decryptWechatResource, verifyWechatNotification } from '../_shared/wechat.ts';
import { wechatRefundEvidence } from '../_shared/wechat-refunds.ts';
import type { CashRefund } from '../_shared/cash-refunds.ts';
import { responseBytes } from '../_shared/audio-provider.ts';

export async function handleWechatRefundWebhook(req: Request) {
  const reply = (code: string, message: string, status = 200) =>
    Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (req.method !== 'POST') return reply('FAIL', '仅支持POST', 405);
  const publicId = Deno.env.get('WECHAT_PAY_PUBLIC_KEY_ID') || '';
  const publicKey = Deno.env.get('WECHAT_PAY_PUBLIC_KEY') || '';
  if (!publicId || !publicKey || !Deno.env.get('MCH_API_V3_KEY')) return reply('FAIL', '微信通知配置未完成', 503);
  try {
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(new Response(req.body), 65536));
    if (!await verifyWechatNotification(req.headers, raw, publicId, publicKey)) return reply('FAIL', '通知验签失败', 401);
    const body = JSON.parse(raw);
    if (!['REFUND.SUCCESS', 'REFUND.CLOSED', 'REFUND.ABNORMAL'].includes(body.event_type)) return reply('SUCCESS', '成功');
    const payload = await decryptWechatResource(body);
    if (`REFUND.${payload.refund_status}` !== body.event_type || typeof payload.out_refund_no !== 'string') return reply('FAIL', '退款事件不匹配', 400);
    const db = createServiceClient();
    const found = await db.from('alipay_refunds').select('*').eq('out_request_no', payload.out_refund_no).eq('pay_channel', 'wechat').maybeSingle();
    if (found.error || !found.data) return reply('FAIL', '原退款申请需要核对', 409);
    const row = found.data as CashRefund;
    const order = await db.from('orders').select('provider_trade_no,total_amount').eq('id', row.order_id).single();
    const merchant = await db.from('wechat_transactions').select('mchid').eq('order_id', row.order_id).single();
    if (order.error || merchant.error || !merchant.data?.mchid || !order.data?.provider_trade_no) throw new Error('原商户读取失败');
    const evidence = wechatRefundEvidence(payload, row, {
      mchid: merchant.data.mchid, tradeNo: order.data.provider_trade_no, total: order.data.total_amount,
    }, 'notify');
    const result = await db.rpc('finish_wechat_refund', { p_refund: row.id, p_lease: null, p_evidence: evidence });
    if (result.error || !result.data) throw new Error('退款入账未确认');
    return reply('SUCCESS', '成功');
  } catch { return reply('FAIL', '退款结果入账待核对', 500); }
}
Deno.serve(handleWechatRefundWebhook);
