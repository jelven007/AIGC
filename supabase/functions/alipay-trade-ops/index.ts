// 支付宝 AI 网页应用收款 - 交易操作 Edge Function（退款 / 退款查询 / 关闭交易）
// 契约要点：
// - alipay.trade.refund：同一笔退款重试必须复用原 out_request_no，新请求用新编号；
// - fund_change=Y 才有资金变化，N 或缺失必须通过 alipay.trade.fastpay.refund.query 确认（间隔 ≥ 10 秒）；
// - 累计退款金额不得超过订单实付金额；
// - alipay.trade.close 仅可关闭 WAIT_BUYER_PAY 状态交易。
// 资金类操作仅限管理员（profiles.role='admin'）；关闭交易允许订单本人或管理员。
import { createClient } from 'npm:@supabase/supabase-js@2';
import ShortUniqueId from 'npm:short-unique-id';
import { handleCorsPreflight, getCorsHeaders } from '../_shared/cors.ts';
import {
  AlipayConfigError,
  createAlipaySdk,
  getAlipayConfig,
  mapTradeStatus,
  normalizeAmountText,
  readResultField,
} from '../_shared/alipay.ts';

function json(body: unknown, cors: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
const ok = (data: unknown, cors: Record<string, string>) =>
  json({ code: 0, message: 'success', data }, cors);
const err = (message: string, cors: Record<string, string>, status = 400) =>
  json({ code: 1, message, data: null }, cors, status);

function newRefundRequestNo(orderNo: string): string {
  const uid = new ShortUniqueId({ length: 6 });
  return `RF-${orderNo.slice(-8)}-${uid.rnd()}`;
}

type Action = 'refund' | 'refundQuery' | 'close';

Deno.serve(async (req) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== 'POST') return err('仅支持 POST', corsHeaders, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return err('未授权', corsHeaders, 401);

  try {
    getAlipayConfig();
  } catch (e) {
    if (e instanceof AlipayConfigError) return err(e.message, corsHeaders, 503);
    throw e;
  }

  try {
    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    );
    const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authErr || !user) return err('认证失败', corsHeaders, 401);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const isAdmin = profile?.role === 'admin';

    const body = (await req.json()) as {
      action?: Action;
      order_no?: string;
      refund_amount?: string;
      refund_reason?: string;
      out_request_no?: string;
    };
    const action = body.action;
    const orderNo = (body.order_no || '').trim();
    if (!action || !['refund', 'refundQuery', 'close'].includes(action)) {
      return err('action 必须为 refund / refundQuery / close', corsHeaders);
    }
    if (!orderNo) return err('缺少 order_no', corsHeaders);

    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, order_no, user_id, total_amount, refunded_amount, status, pay_channel, alipay_trade_no')
      .eq('order_no', orderNo)
      .maybeSingle();
    if (!order || (order.user_id !== user.id && !isAdmin)) return err('订单不存在', corsHeaders, 404);
    if (order.pay_channel !== 'alipay') return err('订单渠道不匹配', corsHeaders, 400);

    // 退款与退款查询涉及资金出账，仅限管理员
    if (action !== 'close' && !isAdmin) return err('无权限执行退款操作', corsHeaders, 403);

    const sdk = createAlipaySdk();

    // ---------- 退款 ----------
    if (action === 'refund') {
      if (order.status !== 'paid' && order.status !== 'partial_refunded') {
        return err('仅已支付订单可退款', corsHeaders, 409);
      }
      const refundAmount = normalizeAmountText(body.refund_amount);
      if (!refundAmount || Number(refundAmount) <= 0) return err('退款金额非法', corsHeaders);
      const paid = Number(order.total_amount);
      const already = Number(order.refunded_amount ?? 0);
      if (already + Number(refundAmount) > paid + 1e-9) {
        return err(`累计退款不得超过实付金额（已退 ${already}，实付 ${paid}）`, corsHeaders);
      }

      // 重试复用原 out_request_no；新请求生成新编号并落库
      let outRequestNo = (body.out_request_no || '').trim();
      if (outRequestNo) {
        const { data: existing } = await supabaseAdmin
          .from('alipay_refunds')
          .select('id, status')
          .eq('out_request_no', outRequestNo)
          .eq('order_id', order.id)
          .maybeSingle();
        if (!existing) return err('out_request_no 与订单不匹配', corsHeaders, 404);
        if (existing.status === 'success') return ok({ out_request_no: outRequestNo, refund_status: 'success', message: '该笔退款已成功，勿重复提交' }, corsHeaders);
      } else {
        outRequestNo = newRefundRequestNo(order.order_no);
        const { error: insErr } = await supabaseAdmin
          .from('alipay_refunds')
          .insert({
            order_id: order.id,
            out_request_no: outRequestNo,
            refund_amount: refundAmount,
            status: 'init',
            reason: body.refund_reason ?? null,
            operator_id: user.id,
          });
        if (insErr && insErr.code !== '23505') {
          console.error('[alipay-trade-ops] refund insert failed:', insErr.message);
          return err('退款记录创建失败', corsHeaders, 500);
        }
      }

      await supabaseAdmin
        .from('alipay_refunds')
        .update({ status: 'requested', updated_at: new Date().toISOString() })
        .eq('out_request_no', outRequestNo);

      const res = await sdk.exec('alipay.trade.refund', {
        bizContent: {
          out_trade_no: order.order_no,
          refund_amount: refundAmount,
          out_request_no: outRequestNo,
          refund_reason: body.refund_reason || '用户退款',
        },
      });
      const response = res as any;
      if (response?.error_response || (readResultField(response, 'code') && readResultField(response, 'code') !== '10000')) {
        await supabaseAdmin
          .from('alipay_refunds')
          .update({ status: 'init', updated_at: new Date().toISOString() })
          .eq('out_request_no', outRequestNo);
        console.error('[alipay-trade-ops] refund upstream failed:', JSON.stringify(response?.error_response ?? response));
        return err('支付宝退款请求失败，可使用原 out_request_no 重试', corsHeaders, 502);
      }

      const fundChange = readResultField(response, 'fund_change');
      const quickStatus = readResultField(response, 'refund_status');
      const success = quickStatus === 'REFUND_SUCCESS' || fundChange === 'Y';
      // fund_change 为 N 或缺失：结果未知，必须走退款查询确认（不得视为成功）
      const nextStatus = success ? 'success' : 'unknown';
      await supabaseAdmin
        .from('alipay_refunds')
        .update({
          status: nextStatus,
          alipay_trade_no: readResultField(response, 'trade_no') ?? order.alipay_trade_no,
          updated_at: new Date().toISOString(),
        })
        .eq('out_request_no', outRequestNo);

      if (success) {
        const newRefunded = (already + Number(refundAmount)).toFixed(2);
        await supabaseAdmin
          .from('orders')
          .update({
            refunded_amount: newRefunded,
            status: Number(newRefunded) >= paid ? 'refunded' : 'partial_refunded',
            updated_at: new Date().toISOString(),
          })
          .eq('order_no', order.order_no);
      }

      return ok({
        out_request_no: outRequestNo,
        refund_status: nextStatus,
        fund_change: fundChange ?? null,
        message: nextStatus === 'unknown' ? '资金变化未确认，请等待至少 10 秒后使用 refundQuery 查询结果' : null,
      }, corsHeaders);
    }

    // ---------- 退款查询（调用方须保证与上次查询间隔 ≥ 10 秒） ----------
    if (action === 'refundQuery') {
      const outRequestNo = (body.out_request_no || '').trim();
      if (!outRequestNo) return err('退款查询缺少 out_request_no', corsHeaders);
      const { data: refundRow } = await supabaseAdmin
        .from('alipay_refunds')
        .select('id, order_id, refund_amount, status')
        .eq('out_request_no', outRequestNo)
        .eq('order_id', order.id)
        .maybeSingle();
      if (!refundRow) return err('退款记录不存在', corsHeaders, 404);

      const res = await sdk.exec('alipay.trade.fastpay.refund.query', {
        bizContent: {
          out_trade_no: order.order_no,
          out_request_no: outRequestNo,
        },
      });
      const response = res as any;
      if (response?.error_response || (readResultField(response, 'code') && readResultField(response, 'code') !== '10000')) {
        console.error('[alipay-trade-ops] refundQuery upstream failed:', JSON.stringify(response?.error_response ?? response));
        return err('退款查询失败', corsHeaders, 502);
      }
      const refundStatus = readResultField(response, 'refund_status');
      const refunded = refundStatus === 'REFUND_SUCCESS';
      if (refunded && refundRow.status !== 'success') {
        await supabaseAdmin
          .from('alipay_refunds')
          .update({ status: 'success', updated_at: new Date().toISOString() })
          .eq('id', refundRow.id);
        const newRefunded = (Number(order.refunded_amount ?? 0) + Number(refundRow.refund_amount)).toFixed(2);
        await supabaseAdmin
          .from('orders')
          .update({
            refunded_amount: newRefunded,
            status: Number(newRefunded) >= Number(order.total_amount) ? 'refunded' : 'partial_refunded',
            updated_at: new Date().toISOString(),
          })
          .eq('order_no', order.order_no);
      }
      return ok({ out_request_no: outRequestNo, refund_status: refunded ? 'REFUND_SUCCESS' : (refundStatus ?? 'UNKNOWN') }, corsHeaders);
    }

    // ---------- 关闭交易（订单本人或管理员） ----------
    if (order.status !== 'pending') return err('仅待支付订单可关闭', corsHeaders, 409);

    const res = await sdk.exec('alipay.trade.close', {
      bizContent: { out_trade_no: order.order_no },
    });
    const response = res as any;
    const subCode = readResultField(response, 'sub_code') ?? response?.error_response?.subCode;
    if (subCode === 'ACQ.TRADE_NOT_EXIST') {
      // 支付宝侧无此交易，直接本地取消
      await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('order_no', order.order_no)
        .eq('status', 'pending');
      return ok({ order_no: order.order_no, local_status: 'cancelled', closed: true }, corsHeaders);
    }
    if (response?.error_response || (readResultField(response, 'code') && readResultField(response, 'code') !== '10000')) {
      // 交易状态不允许关闭（如已支付）时不做本地变更，交由查询接口同步
      console.error('[alipay-trade-ops] close upstream failed:', JSON.stringify(response?.error_response ?? response));
      return err('支付宝关闭交易失败（若已支付请走退款流程）', corsHeaders, 502);
    }
    const mapped = mapTradeStatus(readResultField(response, 'trade_status'));
    await supabaseAdmin
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('order_no', order.order_no)
      .eq('status', 'pending');
    return ok({ order_no: order.order_no, local_status: 'cancelled', trade_status: mapped }, corsHeaders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '服务内部错误';
    console.error('[alipay-trade-ops]', msg);
    return err(msg, corsHeaders, 500);
  }
});
