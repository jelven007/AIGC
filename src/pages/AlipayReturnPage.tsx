/**
 * 支付宝支付同步回跳结果页（/alipay-return?order_no=xxx）
 * 安全约定：支付宝回跳携带的 trade_no、out_trade_no、total_amount 等同步参数一律不信任，
 * 仅取本地下单时拼入的 order_no，最终支付状态以服务端 alipay-trade-query 查询为准。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { queryAlipayOrder, type AlipayQueryResult } from '@/api/alipay';

type ViewState = 'checking' | 'paid' | 'pending' | 'closed' | 'error';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 30; // 约 90 秒兜底窗口，之后以异步通知最终一致

export default function AlipayReturnPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderNo = (searchParams.get('order_no') || '').trim();

  const [view, setView] = useState<ViewState>(orderNo ? 'checking' : 'error');
  const [result, setResult] = useState<AlipayQueryResult | null>(null);
  const [errmsg, setErrmsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef(0);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const checkOnce = useCallback(async () => {
    if (!orderNo) return;
    countRef.current += 1;
    try {
      const res = await queryAlipayOrder(orderNo);
      setResult(res);
      if (res.local_status === 'paid') {
        stopPoll();
        setView('paid');
        window.dispatchEvent(new Event('credits_changed'));
        toast.success('支付成功，积分/权益已发放');
      } else if (res.local_status === 'cancelled' || res.trade_status === 'TRADE_CLOSED' || res.trade_status === 'NOT_EXIST') {
        stopPoll();
        setView('closed');
      } else if (countRef.current >= MAX_POLL_COUNT) {
        stopPoll();
        setView('pending');
      }
    } catch (e) {
      if (countRef.current >= MAX_POLL_COUNT) {
        stopPoll();
        setErrmsg(e instanceof Error ? e.message : '订单查询失败');
        setView('error');
      }
    }
  }, [orderNo, stopPoll]);

  useEffect(() => {
    if (!orderNo) {
      setErrmsg('缺少订单号，请从积分与套餐页面重新发起支付');
      setView('error');
      return;
    }
    checkOnce();
    pollRef.current = setInterval(checkOnce, POLL_INTERVAL_MS);
    return stopPoll;
  }, [orderNo, checkOnce, stopPoll]);

  const viewConfig = {
    checking: { icon: <Loader2 className="w-10 h-10 animate-spin text-primary" />, title: '正在确认支付结果…', desc: '已在支付宝完成支付？服务端正在轮询交易状态，请勿关闭页面' },
    paid:     { icon: <CheckCircle2 className="w-10 h-10 text-success" />, title: '支付成功', desc: `订单 ${orderNo} 已完成支付${result?.amount ? `，金额 ¥${result.amount}` : ''}，积分与权益已发放到账` },
    pending:  { icon: <Clock className="w-10 h-10 text-warning" />, title: '支付结果确认中', desc: '异步结算可能存在短暂延迟，稍后回到「积分与套餐」页面即可看到最新状态' },
    closed:   { icon: <AlertCircle className="w-10 h-10 text-destructive" />, title: '支付未完成', desc: '该订单已取消或已关闭，如已付款请联系客服核实' },
    error:    { icon: <AlertCircle className="w-10 h-10 text-destructive" />, title: '查询失败', desc: errmsg || '请稍后重试' },
  }[view];

  return (
    <div className="flex items-center justify-center p-4 md:p-6 min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-base text-muted-foreground font-medium">支付宝支付 · 结果查询</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-6">
          {viewConfig.icon}
          <h2 className="text-xl font-bold text-center">{viewConfig.title}</h2>
          <p className="text-sm text-muted-foreground text-center leading-relaxed">{viewConfig.desc}</p>
          <div className="flex gap-3 mt-2">
            {view === 'paid' ? (
              <Button onClick={() => navigate('/credits?tab=overview')}>查看我的积分</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => navigate('/credits?tab=plans')}>返回套餐页</Button>
                {(view === 'checking' || view === 'pending' || view === 'error') && (
                  <Button onClick={() => { countRef.current = 0; setView('checking'); checkOnce(); }}>
                    <RefreshCw className="w-4 h-4 mr-1.5" />手动刷新
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
