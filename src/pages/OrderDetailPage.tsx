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

interface Order {
  id: string;
  order_no: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
  total_amount: number;
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
};

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchOrder = async () => {
    if (!orderId || !user) return;
    const { data } = await supabase
      .from('orders')
      .select('id, order_no, status, total_amount, wechat_pay_url, created_at, paid_at, plan_id')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) setOrder(data as Order);
    setLoading(false);
    return data;
  };

  // 自动轮询：pending 状态每 2s 刷新
  useEffect(() => {
    fetchOrder();
    pollRef.current = setInterval(async () => {
      const data = await fetchOrder();
      if (data && data.status !== 'pending') {
        clearInterval(pollRef.current);
        if (data.status === 'paid') {
          toast.success('支付成功！套餐已开通');
        }
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, user]);

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
        <p className="text-lg font-medium">订单不存在</p>
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
              <p className="mt-1 text-sm text-muted-foreground">请使用微信扫码支付</p>
            )}
            {order.status === 'paid' && (
              <p className="mt-1 text-sm text-success">支付成功，套餐权益已自动开通</p>
            )}
          </div>
        </CardContent>
      </Card>

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
              二维码有效期 2 小时 · 支付后页面自动刷新
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
            <span>实付金额</span>
            <span className="text-primary">¥{order.total_amount.toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {order.status === 'paid' && (
        <Button className="w-full" onClick={() => navigate('/dashboard')}>
          开始使用 →
        </Button>
      )}
    </div>
  );
}
