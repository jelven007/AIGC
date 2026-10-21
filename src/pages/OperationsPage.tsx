import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { alipayTradeOps, AlipayOperationError } from '@/api/alipay';
import { executeOperatorRequest, loadOperatorRequest, operatorAccess, operatorPage, operatorPendingKey,
  storeOperatorRequest, OperatorRequestError, type OperatorDomain, type PendingOperatorRequest } from '@/api/operations';

const DOMAINS: { id: OperatorDomain; name: string; permission: string; columns: [string, string][] }[] = [
  { id: 'orders', name: '订单', permission: 'orders:read', columns: [['order_no', '订单编号'], ['plan_name', '套餐'], ['total_amount', '实付 ¥'], ['refunded_amount', '已退 ¥'], ['status', '状态'], ['pay_channel', '渠道']] },
  { id: 'refunds', name: '退款核对', permission: 'orders:read', columns: [['order_no', '订单编号'], ['out_request_no', '原退款编号'], ['refund_amount', '退款 ¥'], ['status', '状态'], ['revoked_credits', '回收积分'], ['needs_attention', '待核对']] },
  { id: 'customers', name: '客户与预算', permission: 'customers:read', columns: [['username', '客户'], ['email', '邮箱'], ['credit_balance', '积分余额'], ['daily_credit_budget', '日预算'], ['plan_status', '套餐状态']] },
  { id: 'jobs', name: '生产队列', permission: 'jobs:read', columns: [['kind', '类型'], ['status', '状态'], ['billing_state', '计费状态'], ['needs_attention', '待核对'], ['created_at', '创建时间']] },
  { id: 'risk', name: '风险事件', permission: 'risk:read', columns: [['action', '操作'], ['decision', '判定'], ['category', '类别'], ['confidence', '置信度'], ['created_at', '发生时间']] },
  { id: 'audit', name: '操作审计', permission: 'audit:read', columns: [['action', '操作'], ['table_name', '对象'], ['record_id', '记录'], ['created_at', '时间']] },
  { id: 'operators', name: '运营权限', permission: 'operators:write', columns: [['operator_id', '运营账号'], ['role', '角色'], ['scope_user_id', '客户范围'], ['created_at', '授权时间']] },
];
const STATUS: Record<string, string> = { paid: '已支付', pending: '待支付', partial_refunded: '部分退款', refunded: '已退款',
  cancelled: '已取消', init: '已登记', requested: '请求中', unknown: '结果待核对', success: '已到账',
  active: '生效', failed: '失败', completed: '完成', processing: '执行中', queued: '排队中', reserved: '预占', settled: '已结算' };
function cell(value: unknown, key: string) {
  if (value === null || value === undefined) return key === 'scope_user_id' ? '全部客户' : '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key.endsWith('_at')) return new Date(String(value)).toLocaleString('zh-CN');
  if (key.endsWith('_amount')) return Number(value).toFixed(2);
  return STATUS[String(value)] || String(value);
}

export default function OperationsPage() {
  const { user } = useAuth();
  const uid = user?.id || '';
  const currentUid = useRef(uid); currentUid.current = uid;
  const [domain, setDomain] = useState<OperatorDomain>('orders');
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [scope, setScope] = useState('');
  const [filter, setFilter] = useState({ keyword: '', scope: '' });
  const [saved, setSaved] = useState<{ uid: string; request: PendingOperatorRequest | null }>({ uid: '', request: null });
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ type: 'refund' | 'budget' | 'grant' | 'revoke'; row: Record<string, unknown> } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [grantScope, setGrantScope] = useState('');
  const [role, setRole] = useState('finance');
  const access = useQuery({ queryKey: ['operator-access', uid], queryFn: operatorAccess, enabled: !!uid, retry: false });
  const tabs = DOMAINS.filter(item => access.data?.permissions.includes(item.permission)
    && (item.id !== 'audit' || access.data.root || access.data.grants.some(grant => grant.role === 'auditor' && !grant.scope_user_id)));
  const selected = tabs.find(item => item.id === domain) || tabs[0];
  const listed = useQuery({ queryKey: ['operator-list', uid, selected?.id, page, filter], enabled: !!uid && !!selected,
    queryFn: () => operatorPage(selected.id, page, filter.keyword, filter.scope), retry: false });
  const pending = saved.uid === uid ? saved.request : null;
  const canRefund = access.data?.permissions.includes('refunds:write');
  const canBudget = access.data?.permissions.includes('budgets:write');
  useEffect(() => {
    setLocalError('');
    setBusy(false); setEditing(null); setPage(1); setFilter({ keyword: '', scope: '' }); setKeyword(''); setScope('');
    try { setSaved({ uid, request: uid ? loadOperatorRequest(uid) : null }); }
    catch (cause) { setSaved({ uid, request: null }); setLocalError(cause instanceof Error ? cause.message : '原申请恢复失败'); }
  }, [uid]);
  function clear(owner: string) {
    localStorage.removeItem(operatorPendingKey(owner));
    if (currentUid.current === owner) setSaved({ uid: owner, request: null });
  }
  async function run(request: PendingOperatorRequest, query = false) {
    if (busy) return;
    const owner = uid;
    setBusy(true);
    try {
      const result = query && request.kind === 'refund'
        ? await alipayTradeOps({ action: 'refundQuery', order_no: request.body.order_no, request_key: request.body.request_key })
        : await executeOperatorRequest(request);
      if (currentUid.current !== owner) return;
      if (request.kind === 'operator' || result.refund_status === 'success') {
        clear(owner); toast.success(request.kind === 'operator' ? '运营操作已生效' : '退款已到账，权益回收已入账');
      } else toast.info('原退款已登记，资金结果待确认；请稍后核对原申请');
      setEditing(null);
      await listed.refetch(); await access.refetch();
    } catch (cause) {
      if (currentUid.current === owner) {
        if ((cause instanceof OperatorRequestError || cause instanceof AlipayOperationError) && cause.outcome === 'rejected') {
          clear(owner); setEditing(null); void listed.refetch();
        }
        toast.error(cause instanceof Error ? cause.message : '操作失败，请保留原申请核对');
      }
    } finally { if (currentUid.current === owner) setBusy(false); }
  }
  async function submit() {
    if (!editing || pending || localError || busy) return;
    let request: PendingOperatorRequest;
    const requestKey = crypto.randomUUID();
    if (editing.type === 'refund') {
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !reason.trim()) return toast.error('请输入正数退款金额和原因');
      request = { kind: 'refund', body: { action: 'refund', order_no: String(editing.row.order_no),
        refund_amount: amount, refund_reason: reason.trim(), request_key: requestKey } };
    } else {
      const payload = editing.type === 'budget' ? { user_id: editing.row.id, amount: Number(amount), expected: editing.row.daily_credit_budget }
        : editing.type === 'grant' ? { operator_id: operatorId.trim(), role, scope_user_id: grantScope.trim() || null }
          : { grant_id: editing.row.id };
      if (editing.type === 'budget' && (!/^\d+$/.test(amount) || Number(amount) > 1000000)) return toast.error('日预算须为0至1000000整数');
      const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
      if (editing.type === 'grant' && (!validUuid(operatorId) || grantScope.trim() && !validUuid(grantScope))) return toast.error('请输入有效的运营账号与客户账号 UUID');
      request = { kind: 'operator', body: { action: 'mutate', operation: editing.type, request_key: requestKey, payload } };
    }
    try { storeOperatorRequest(uid, request); setSaved({ uid, request }); }
    catch { toast.error('无法保存原申请，请恢复浏览器存储后重试'); return; }
    await run(request);
  }
  if (access.isPending) return <p className="p-6" role="status">正在验证运营权限…</p>;
  if (access.error) return <div className="p-6 space-y-3"><p role="alert">{access.error.message}</p><Button onClick={() => access.refetch()}>重试权限验证</Button></div>;
  if (!selected) return <div className="p-6 space-y-2"><h1 className="text-xl font-semibold">运营控制台</h1><p className="text-muted-foreground">当前账号没有运营权限，请联系系统管理员分配角色与客户范围。</p></div>;
  return <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldCheck className="w-6 h-6" />运营控制台</h1>
        <p className="text-sm text-muted-foreground mt-1">真实订单、资金回执与队列 · {access.data?.root ? '系统管理员' : '按已授权客户范围展示'}</p></div>
      <Button variant="outline" disabled={listed.isFetching || busy} onClick={() => { void access.refetch(); void listed.refetch(); }}><RefreshCw className="w-4 h-4 mr-2" />刷新</Button>
    </div>
    {localError && <p role="alert" className="text-destructive">{localError}</p>}
    {pending && <div className="border border-amber-500/40 rounded-lg p-4 space-y-3" role="status">
      <p className="font-medium">原申请尚未结案</p><p className="text-sm break-all text-muted-foreground">请求编号：{pending.body.request_key}</p>
      <div className="flex flex-wrap gap-2">{pending.kind === 'refund' && <Button disabled={busy} onClick={() => run(pending, true)}>核对原退款</Button>}
        <Button variant="outline" disabled={busy} onClick={() => run(pending)}>按原参数恢复</Button></div>
    </div>}
    <nav aria-label="运营数据域" className="flex flex-wrap gap-2">
      {tabs.map(tab => <Button key={tab.id} size="sm" variant={selected.id === tab.id ? 'default' : 'outline'}
        onClick={() => { setDomain(tab.id); setPage(1); }}>{tab.name}</Button>)}
    </nav>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setFilter({ keyword, scope }); setPage(1); }}>
      <div className="space-y-1 flex-1 min-w-48"><Label htmlFor="operator-search">搜索当前列表</Label><Input id="operator-search" value={keyword} maxLength={64} onChange={event => setKeyword(event.target.value)} placeholder="订单编号、客户邮箱或操作类型" /></div>
      <div className="space-y-1 flex-1 min-w-48"><Label htmlFor="operator-scope">客户账号 UUID（可选）</Label><Input id="operator-scope" value={scope} onChange={event => setScope(event.target.value)} /></div>
      <Button type="submit">筛选</Button>
      {selected.id === 'operators' && <Button type="button" disabled={!!pending || busy || !!localError} onClick={() => { setEditing({ type: 'grant', row: {} }); setOperatorId(''); setGrantScope(''); }}>分配运营角色</Button>}
    </form>
    {listed.error && <p role="alert" className="text-destructive">{listed.error.message}</p>}
    {listed.isFetching ? <p role="status">正在读取运营数据…</p> : listed.data && <>
      <p className="text-xs text-muted-foreground">共 {listed.data.total} 条 · 读取时间 {new Date(listed.data.observed_at).toLocaleString('zh-CN')}</p>
      {!listed.data.items.length ? <p className="border rounded-lg p-8 text-center text-muted-foreground">当前范围内没有记录</p> :
        <div className="overflow-x-auto border rounded-lg"><table className="w-full min-w-[640px] text-sm text-left">
          <caption className="sr-only">{selected.name}列表</caption><thead className="bg-muted/40"><tr>{selected.columns.map(([key, name]) => <th key={key} className="p-3 whitespace-nowrap">{name}</th>)}<th className="p-3">操作</th></tr></thead>
          <tbody>{listed.data.items.map(row => <tr key={String(row.id)} className="border-t align-top">
            {selected.columns.map(([key]) => <td key={key} className="p-3 max-w-64 break-all">{cell(row[key], key)}</td>)}
            <td className="p-3 whitespace-nowrap">
              {selected.id === 'orders' && canRefund && row.pay_channel === 'alipay' && ['paid', 'partial_refunded'].includes(String(row.status)) &&
                <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError} onClick={() => { setEditing({ type: 'refund', row }); setAmount(''); setReason(''); }}>申请退款</Button>}
              {selected.id === 'refunds' && canRefund && (!row.applied_at || row.status !== 'success') &&
                <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                  setBusy(true);
                  try { const result = await alipayTradeOps({ action: 'refundQuery', order_no: String(row.order_no), out_request_no: String(row.out_request_no) });
                    toast.info(result.refund_status === 'success' ? '退款已到账' : '资金结果待确认'); await listed.refetch(); }
                  catch (cause) { toast.error(cause instanceof Error ? cause.message : '退款核对失败'); }
                  finally { setBusy(false); }
                }}>核对原退款</Button>}
              {selected.id === 'customers' && canBudget && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                onClick={() => { setEditing({ type: 'budget', row }); setAmount(String(row.daily_credit_budget)); }}>设置日预算</Button>}
              {selected.id === 'operators' && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                onClick={() => setEditing({ type: 'revoke', row })}>撤销角色</Button>}
            </td>
          </tr>)}</tbody></table></div>}
      <div className="flex items-center justify-end gap-3"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <span className="text-sm">第 {page} 页</span><Button variant="outline" size="sm" disabled={page * 25 >= listed.data.total || page >= 1000} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !busy) setEditing(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{editing?.type === 'refund' ? '确认现金退款' : editing?.type === 'budget' ? '设置日积分预算' : editing?.type === 'grant' ? '分配运营角色' : '撤销运营角色'}</DialogTitle>
        <DialogDescription>{editing?.type === 'refund' ? '到账确认后按订单快照比例回收积分；全额退款关闭对应套餐，已消费欠额在后续充值抵扣。'
          : editing?.type === 'budget' ? '按UTC日统计所有已预占积分，0为不限额；失败任务退还积分后仍占当日预算。'
            : editing?.type === 'grant' ? '财务可退款，运营可调整预算，风险与审计只查看各自数据；客户范围留空表示全部客户。'
              : '撤销后该角色立即无法发起新的运营操作。'}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {(editing?.type === 'refund' || editing?.type === 'budget') && <div className="space-y-2"><Label htmlFor="operator-amount">{editing.type === 'refund' ? `退款金额（实付 ¥${cell(editing.row.total_amount, 'total_amount')}）` : '日积分预算'}</Label>
            <Input id="operator-amount" value={amount} inputMode="decimal" required onChange={event => setAmount(event.target.value)} disabled={!!pending} /></div>}
          {editing?.type === 'refund' && <div className="space-y-2"><Label htmlFor="refund-reason">退款原因</Label><Input id="refund-reason" value={reason} maxLength={200} required onChange={event => setReason(event.target.value)} disabled={!!pending} /></div>}
          {editing?.type === 'grant' && <>
            <div className="space-y-2"><Label htmlFor="operator-id">运营账号 UUID</Label><Input id="operator-id" required value={operatorId} onChange={event => setOperatorId(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="operator-role">角色</Label><select id="operator-role" className="w-full p-2 rounded-md border bg-background" value={role} onChange={event => setRole(event.target.value)}><option value="finance">财务</option><option value="operations">运营</option><option value="risk">风险观察</option><option value="auditor">审计</option></select></div>
            <div className="space-y-2"><Label htmlFor="grant-scope">客户账号 UUID（留空授权全部客户）</Label><Input id="grant-scope" value={grantScope} onChange={event => setGrantScope(event.target.value)} /></div>
          </>}
          <Button type="submit" className="w-full" disabled={busy || !!pending || !!localError}>{busy ? '正在提交…' : '确认并提交'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
