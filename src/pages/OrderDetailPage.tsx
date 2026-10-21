import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, Clock, XCircle, QrCode, RefreshCw, ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { queryAlipayOrder } from '@/api/alipay';

interface Order {
  id: string;
  order_no: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded' | 'partial_refunded';
  total_amount: number;
  refunded_amount: number;
  pay_channel: string;
  wechat_pay_url: string | null;
  created_at: string;
  paid_at: string | null;
  plan_id: string | null;
}

const STATUS_CONFIG = {
  pending:   { label: '待支付',  icon: Clock,        cls: 'bg-warning/10 text-warning border-warning/30' },
  paid:      { label: '已支付',  icon: CheckCircle2, cls: 'bg-success/10 text-success border-success/30' },
  cancelled: { label: '已取消',  icon: XCircle,      cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  refunded:  { label: '已退款',  icon: RefreshCw,    cls: 'bg-muted text-muted-foreground border-border' },
  partial_refunded: { label: '部分退款', icon: RefreshCw, cls: 'bg-warning/10 text-warning border-warning/30' },
};

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [checking, setChecking] = useState(false);
  const [pollEnded, setPollEnded] = useState(false);
  const [refunds, setRefunds] = useState<{ id: string; out_request_no: string; refund_amount: number;
    status: string; revoked_credits: number; applied_at: string | null }[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const ownerRef = useRef('');
  ownerRef.current = `${user?.id || ''}:${orderId || ''}`;

  const fetchOrder = async () => {
    if (!orderId || !user) return;
    const owner = `${user.id}:${orderId}`;
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_no, status, total_amount, refunded_amount, pay_channel, wechat_pay_url, created_at, paid_at, plan_id')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .abortSignal(AbortSignal.timeout(15000))
      .maybeSingle();
    if (ownerRef.current !== owner) return;
    if (error) { setReadError('订单读取失败，请刷新后重试'); setLoading(false); return; }
    setReadError('');
    if (data) {
      setOrder({ ...data, total_amount: Number(data.total_amount), refunded_amount: Number(data.refunded_amount) } as Order);
      const receipt = await supabase.from('cash_refund_receipts').select('id,out_request_no,refund_amount,status,revoked_credits,applied_at')
        .eq('order_id', data.id).order('created_at', { ascending: false }).limit(50).abortSignal(AbortSignal.timeout(15000));
      if (ownerRef.current !== owner) return;
      if (receipt.error) setReadError('退款回执暂不可用，请刷新后核对');
      else setRefunds(receipt.data || []);
    } else setOrder(null);
    setLoading(false);
    return data;
  };

  // 自动轮询：pending 状态每 2s 刷新
  useEffect(() => {
    setOrder(null); setRefunds([]); setLoading(true); setReadError(''); setPollEnded(false);
    let active = true, attempts = 0, previous = '';
    let polling = false;
    const poll = async () => {
      if (polling || !active) return;
      polling = true;
      let data;
      try { data = await fetchOrder(); }
      catch { if (active) { setReadError('订单读取失败，请稍后重试'); setLoading(false); } }
      finally { polling = false; }
      if (!active) return;
      attempts++;
      if (data && data.status !== 'pending') {
        clearInterval(pollRef.current);
        if (previous === 'pending' && data.status === 'paid') {
          window.dispatchEvent(new Event('credits_changed'));
          toast.success('支付成功！套餐已开通');
        }
      } else if (attempts >= 24) {
        clearInterval(pollRef.current); setPollEnded(true);
      }
      previous = data?.status || previous;
    };
    pollRef.current = setInterval(() => void poll(), 5000);
    void poll();
    return () => { active = false; clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, user]);
  const check = async () => {
    if (!order || checking) return;
    const owner = ownerRef.current;
    setChecking(true);
    try {
      if (order.status === 'pending' && order.pay_channel === 'alipay') await queryAlipayOrder(order.order_no);
      if (ownerRef.current !== owner) return;
      await fetchOrder();
      window.dispatchEvent(new Event('credits_changed'));
    } catch { if (ownerRef.current === owner) setReadError('支付结果暂不可用，请稍后核对原订单'); }
    finally { if (ownerRef.current === owner) setChecking(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <XCircle className="w-12 h-12 text-destructive" />
        <p className="text-lg font-medium">{readError || '订单不存在'}</p>
        <Button variant="outline" onClick={() => navigate('/credits')}>
          <ArrowLeft className="w-4 h-4 mr-2" />返回套餐页
        </Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusCfg.icon;

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/credits')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold text-balance">订单详情</h1>
      </div>
      {readError && <p role="alert" className="text-destructive text-sm">{readError}</p>}
      {pollEnded && <p className="text-sm text-muted-foreground">自动核对已暂停，可手动刷新此订单。支付通知仍会由服务端处理。</p>}
      <Button variant="outline" disabled={checking} onClick={() => void check()}>{checking ? '正在核对' : '核对支付结果'}</Button>

      {/* 订单状态 */}
      <Card>
        <CardContent className="pt-6 flex flex-col items-center gap-4">
          <div className={cn('w-16 h-16 rounded-full flex items-center justify-center border-2', statusCfg.cls)}>
            <StatusIcon className="w-8 h-8" />
          </div>
          <div className="text-center">
            <Badge className={cn('text-sm px-3 py-1', statusCfg.cls)}>
              {statusCfg.label}
            </Badge>
            <p className="mt-2 text-3xl font-bold">¥{order.total_amount.toFixed(2)}</p>
            {order.status === 'pending' && (
              <p className="mt-1 text-sm text-muted-foreground">{order.pay_channel === 'alipay' ? '请在支付宝收银台完成支付' : '请使用微信扫码支付'}</p>
            )}
            {order.status === 'paid' && (
              <p className="mt-1 text-sm text-success">支付成功，套餐权益已自动开通</p>
            )}
            {['partial_refunded', 'refunded'].includes(order.status) && <p className="mt-2 text-sm text-muted-foreground">
              已退款 ¥{order.refunded_amount.toFixed(2)} · 对应积分已按退款比例回收
            </p>}
          </div>
        </CardContent>
      </Card>
      {refunds.length > 0 && <Card><CardHeader><CardTitle className="text-base">现金退款回执</CardTitle></CardHeader>
        <CardContent className="space-y-4">{refunds.map(refund => <div key={refund.id} className="text-sm space-y-1 border-b pb-3 last:border-b-0">
          <p className="break-all font-mono text-xs">{refund.out_request_no}</p>
          <p>¥{Number(refund.refund_amount).toFixed(2)} · {refund.status === 'success' && refund.applied_at ? '已到账' : '结果待核对'} · 回收 {refund.revoked_credits} 积分</p>
        </div>)}</CardContent></Card>}

      {/* 二维码 (pending 状态显示) */}
      {order.status === 'pending' && order.wechat_pay_url && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="w-4 h-4 text-primary" />微信扫码支付
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <div className="border-2 border-primary/20 rounded-xl p-3 bg-white">
              <QRCodeDataUrl value={order.wechat_pay_url} size={200} />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              仅用于当前订单 · 支付结果以服务端入账为准
            </p>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin" />
              正在等待支付结果…
            </div>
          </CardContent>
        </Card>
      )}

      {/* 订单信息 */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          {[
            { label: '订单编号', value: order.order_no },
            { label: '下单时间', value: new Date(order.created_at).toLocaleString('zh-CN') },
            ...(order.paid_at ? [{ label: '支付时间', value: new Date(order.paid_at).toLocaleString('zh-CN') }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium text-right max-w-[60%] break-all">{value}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between text-sm font-semibold">
            <span>{order.status === 'pending' ? '订单金额' : '支付金额'}</span>
            <span className="text-primary">¥{order.total_amount.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {order.status === 'paid' && (
        <Button className="w-full" onClick={() => navigate('/video/create')}>
          开始使用 →
        </Button>
      )}
    </div>
  );
}
