import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { createCheckout, CheckoutError, checkoutStorageKey, readPendingCheckout,
  type PendingCheckout, type CheckoutChannel, type CheckoutReceipt } from '@/api/checkout';
import { renderAndSubmitAlipayForm } from '@/api/alipay';
import type { Plan } from '@/types/types';

export interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  onCreated: () => void;
}

export default function PaymentDialog({ open, onOpenChange, plan, onCreated }: PaymentDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<CheckoutChannel>('alipay');
  const [pending, setPending] = useState<PendingCheckout | null>(null);
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [rejected, setRejected] = useState(false);
  const running = useRef(false);
  const owner = useRef(user?.id);
  owner.current = user?.id;
  useEffect(() => {
    if (!open) return;
    setPending(user ? readPendingCheckout(user.id) : null);
    setError(''); setReceipt(null); setStorageBlocked(false); setRejected(false);
  }, [open, user?.id]);

  const submit = async () => {
    if (!user || running.current || rejected || (!pending && !plan)) return;
    const uid = user.id;
    const original: PendingCheckout = pending || readPendingCheckout(uid) || { channel, name: plan!.name, credits: plan!.credits,
      request: { plan_id: plan!.id, request_key: crypto.randomUUID(), expected_amount: Number(plan!.price).toFixed(2), expected_credits: plan!.credits } };
    // 必须先保存原请求；本地不可存储时不发出可能收款的 POST。
    try { localStorage.setItem(checkoutStorageKey(uid), JSON.stringify(original)); }
    catch { setStorageBlocked(true); setError('浏览器无法保存支付请求，请允许网站存储后重试'); return; }
    running.current = true; setBusy(true); setError(''); setPending(original);
    try {
      const result = await createCheckout(original.channel, original.request);
      if (owner.current !== uid) return;
      setReceipt(result); onCreated();
      if (result.local_status !== 'pending') {
        localStorage.removeItem(checkoutStorageKey(uid)); setPending(null);
        onOpenChange(false); navigate(`/order/${result.order_id}`); return;
      }
      if (original.channel === 'alipay') {
        if (!result.payment_html) throw new CheckoutError('支付表单缺失，请恢复原请求', 'unknown', result);
        renderAndSubmitAlipayForm(result.payment_html);
        // 跳转保留原请求，返回后可核对原订单。
      } else {
        if (!result.wechat_pay_url) throw new CheckoutError('支付地址缺失，请恢复原请求', 'unknown', result);
        localStorage.removeItem(checkoutStorageKey(uid)); setPending(null);
        onOpenChange(false); navigate(`/order/${result.order_id}`);
      }
    } catch (err) {
      if (owner.current !== uid) return;
      if (err instanceof CheckoutError && err.receipt) { setReceipt(err.receipt); onCreated(); }
      if (err instanceof CheckoutError && err.outcome === 'rejected') {
        localStorage.removeItem(checkoutStorageKey(uid)); setPending(null); setRejected(true); onCreated();
      }
      setError(err instanceof Error ? err.message : '支付结果待确认，请恢复原请求');
    } finally { running.current = false; if (owner.current === uid) setBusy(false); }
  };
  const name = pending?.name || plan?.name;
  const amount = pending?.request.expected_amount || Number(plan?.price || 0).toFixed(2);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>确认套餐与支付</DialogTitle>
          <DialogDescription>金额由服务端核对，支付结果以订单入账为准。关闭弹窗后可从订单记录继续核对。</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border p-4 space-y-2">
          <p className="font-semibold break-words">{name || '恢复原支付请求'}</p>
          <p className="text-2xl font-bold">¥{amount}</p>
          <p className="text-sm text-muted-foreground">包含 {pending?.credits ?? plan?.credits ?? 0} 积分</p>
        </div>
        <label className="text-sm space-y-2">支付渠道
          <select aria-label="支付渠道" value={pending?.channel || channel} disabled={!!pending || busy}
            onChange={e => setChannel(e.target.value as CheckoutChannel)}
            className="block w-full rounded-md border bg-background px-3 py-2">
            <option value="alipay">支付宝网页支付</option><option value="wechat">微信扫码支付</option>
          </select>
        </label>
        {pending && <p className="text-sm text-muted-foreground">原请求待核对，套餐、金额和渠道已固定。恢复时继续使用同一订单。</p>}
        {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
        {rejected && <Button variant="outline" onClick={() => onOpenChange(false)}>返回套餐重新选择</Button>}
        {receipt && <Button variant="outline" onClick={() => { onOpenChange(false); navigate(`/order/${receipt.order_id}`); }}>查看原订单</Button>}
        <Button disabled={busy || !user || (!pending && !plan) || storageBlocked || rejected} onClick={() => void submit()}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {busy ? '正在核对订单' : pending ? '恢复原支付请求' : `确认支付 ¥${amount}`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
