import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CashOperationError } from '@/api/alipay';
import OperationsWorkflowDialog, { type WorkflowEdit } from '@/components/OperationsWorkflowDialog';
import OperationsRecordDetail from '@/components/OperationsRecordDetail';
import { executeOperatorRequest, loadOperatorRequest, operatorAccess, operatorPage, operatorPendingKey,
  storeOperatorRequest, refundTradeOps, costReport, OperatorRequestError, type OperatorDomain, type PendingOperatorRequest } from '@/api/operations';

const DOMAINS: { id: OperatorDomain; name: string; permission: string; columns: [string, string][] }[] = [
  { id: 'orders', name: '订单', permission: 'orders:read', columns: [['order_no', '订单编号'], ['plan_name', '套餐'], ['total_amount', '实付 ¥'], ['refunded_amount', '已退 ¥'], ['status', '状态'], ['pay_channel', '渠道']] },
  { id: 'refunds', name: '退款核对', permission: 'orders:read', columns: [['order_no', '订单编号'], ['pay_channel', '渠道'], ['out_request_no', '原退款编号'], ['refund_amount', '退款 ¥'], ['status', '状态'], ['revoked_credits', '回收积分'], ['needs_attention', '待核对']] },
  { id: 'customers', name: '客户与预算', permission: 'customers:read', columns: [['username', '客户'], ['email', '邮箱'], ['credit_balance', '积分余额'], ['daily_credit_budget', '日预算'], ['restricted', '新任务受限'], ['plan_status', '套餐状态']] },
  { id: 'jobs', name: '生产队列', permission: 'jobs:read', columns: [['kind', '类型'], ['status', '状态'], ['billing_state', '计费状态'], ['needs_attention', '待核对'], ['created_at', '创建时间']] },
  { id: 'alerts', name: '运行告警', permission: 'alerts:read', columns: [['title', '问题'], ['severity', '级别'], ['status', '处置状态'], ['source_id', '原对象编号'], ['occurrences', '发生次数'], ['opened_at', '本次发生'], ['last_seen_at', '最近观察'], ['note', '接手记录']] },
  { id: 'tickets', name: '运营工单', permission: 'tickets:read', columns: [['title', '标题'], ['status', '状态'], ['priority', '优先级'], ['assignee_id', '处理人'], ['due_at', '响应期限']] },
  { id: 'tenants', name: '租户管理', permission: 'tenants:read', columns: [['name', '租户'], ['state', '状态'], ['active_members', '有效成员'], ['max_members', '成员上限'], ['daily_reserved', '今日预占'], ['daily_credit_budget', '团队日预算']] },
  { id: 'costs', name: '供应商现金成本', permission: 'costs:read', columns: [['statement_ref', '账单编号'], ['line_ref', '行号'], ['provider', '原供应商'], ['currency', '币种'], ['amount_minor', '现金金额'], ['job_id', '原调用编号']] },
  { id: 'cost_missing', name: '待核对现金用量', permission: 'costs:read', columns: [['job_type', '调用类型'], ['kind', '业务'], ['status', '任务状态'], ['id', '原调用编号'], ['created_at', '创建时间']] },
  { id: 'model_attempts', name: '模型调用核对', permission: 'costs:read', columns: [['request_id', '原请求'], ['slot', '模型槽'], ['model', '模型'], ['status', '尝试状态'], ['total_tokens', 'Token用量'], ['needs_reconciliation', '受理待核对'], ['cash_state', '现金核对'], ['upstream_id', '供应商编号']] },
  { id: 'risk', name: '风险事件', permission: 'risk:read', columns: [['action', '操作'], ['decision', '判定'], ['category', '类别'], ['disposition', '人工处置'], ['created_at', '发生时间']] },
  { id: 'audit', name: '操作审计', permission: 'audit:read', columns: [['action', '操作'], ['table_name', '对象'], ['record_id', '记录'], ['created_at', '时间']] },
  { id: 'operators', name: '运营权限', permission: 'operators:write', columns: [['operator_id', '运营账号'], ['role', '角色'], ['scope_user_id', '客户范围'], ['created_at', '授权时间']] },
];
const STATUS: Record<string, string> = { paid: '已支付', pending: '待支付', partial_refunded: '部分退款', refunded: '已退款',
  cancelled: '已取消', init: '已登记', requested: '请求中', unknown: '结果待核对', success: '已到账', closed: '已关闭，未到账',
  alipay: '支付宝', wechat: '微信',
  active: '生效', failed: '失败', completed: '完成', processing: '执行中', queued: '排队中', reserved: '预占', settled: '已结算',
  open: '待处理', in_progress: '处理中', waiting_customer: '等待客户', resolved: '已解决', suspended: '暂停',
  high: '紧急', normal: '普通', low: '低', unreviewed: '未核对', reviewing: '核查中', dismissed: '排除', confirmed: '确认风险',
  critical: '严重', warning: '提醒', acknowledged: '已接手', started: '调用待结案',
  interrupted: '响应中断', unrecorded: '未核对', recorded: '已登记' };
function cell(value: unknown, key: string) {
  if (value === null || value === undefined) return key === 'scope_user_id' ? '全部客户' : '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key.endsWith('_at')) return new Date(String(value)).toLocaleString('zh-CN');
  if (key.endsWith('_amount')) return Number(value).toFixed(2);
  if (key === 'amount_minor') return (Number(value) / 100).toFixed(2);
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
  const requestLock = useRef(false);
  const [workflow, setWorkflow] = useState<WorkflowEdit | null>(null);
  const [detail, setDetail] = useState<{ type: 'ticket' | 'tenant'; id: string } | null>(null);
  const [editing, setEditing] = useState<{ type: 'refund' | 'budget' | 'grant' | 'revoke'; row: Record<string, unknown> } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [grantScope, setGrantScope] = useState('');
  const [role, setRole] = useState('finance');
  const access = useQuery({ queryKey: ['operator-access', uid], queryFn: () => operatorAccess(uid), enabled: !!uid, retry: false });
  const tabs = DOMAINS.filter(item => access.data?.permissions.includes(item.permission)
    && (item.id !== 'audit' || access.data.root || access.data.grants.some(grant => grant.role === 'auditor' && !grant.scope_user_id))
    && (item.id !== 'tenants' || access.data.root || access.data.grants.some(grant => ['operations', 'auditor'].includes(grant.role) && !grant.scope_user_id)));
  const selected = tabs.find(item => item.id === domain) || tabs[0];
  const listed = useQuery({ queryKey: ['operator-list', uid, selected?.id, page, filter], enabled: !!uid && !!selected,
    queryFn: () => operatorPage(selected.id, page, filter.keyword, filter.scope, uid), retry: false });
  const costs = useQuery({ queryKey: ['operator-costs', uid, filter.scope], enabled: !!uid && !!selected && ['costs', 'cost_missing'].includes(selected.id),
    queryFn: () => costReport(filter.scope, uid), retry: false });
  const pending = saved.uid === uid ? saved.request : null;
  const canRefund = access.data?.permissions.includes('refunds:write');
  const canBudget = access.data?.permissions.includes('budgets:write');
  const canTenantWrite = access.data?.root || access.data?.grants.some(grant => grant.role === 'operations' && !grant.scope_user_id);
  useEffect(() => {
    setLocalError('');
    requestLock.current = false;
    setBusy(false); setEditing(null); setWorkflow(null); setDetail(null); setPage(1); setFilter({ keyword: '', scope: '' }); setKeyword(''); setScope('');
    try { setSaved({ uid, request: uid ? loadOperatorRequest(uid) : null }); }
    catch (cause) { setSaved({ uid, request: null }); setLocalError(cause instanceof Error ? cause.message : '原申请恢复失败'); }
  }, [uid]);
  function clear(owner: string) {
    localStorage.removeItem(operatorPendingKey(owner));
    if (currentUid.current === owner) setSaved({ uid: owner, request: null });
  }
  async function run(request: PendingOperatorRequest, query = false) {
    if (requestLock.current) return;
    requestLock.current = true;
    const owner = uid;
    setBusy(true);
    try {
      const result = query && request.kind === 'refund'
        ? await refundTradeOps(request.channel || 'alipay', { action: 'refundQuery', order_no: request.body.order_no, request_key: request.body.request_key }, owner)
        : await executeOperatorRequest(request, owner);
      if (currentUid.current !== owner) return;
      if (request.kind === 'operator' || ['success', 'closed'].includes(String(result.refund_status))) {
        clear(owner);
        if (result.refund_status === 'closed') toast.info('原退款已关闭，未到账；可重新确认退款申请');
        else toast.success(request.kind === 'operator' ? '运营操作已生效' : '退款已到账，权益回收已入账');
      } else toast.info('原退款已登记，资金结果待确认；请稍后核对原申请');
      setEditing(null); setWorkflow(null);
      await listed.refetch(); await access.refetch();
      if (request.kind === 'operator' && request.body.operation.startsWith('cost_')) await costs.refetch();
    } catch (cause) {
      if (currentUid.current === owner) {
        if ((cause instanceof OperatorRequestError || cause instanceof CashOperationError) && cause.outcome === 'rejected') {
          clear(owner); setEditing(null); setWorkflow(null); void listed.refetch();
        }
        toast.error(cause instanceof Error ? cause.message : '操作失败，请保留原申请核对');
      }
    } finally { if (currentUid.current === owner) { requestLock.current = false; setBusy(false); } }
  }
  async function submit() {
    if (!editing || pending || localError || requestLock.current) return;
    let request: PendingOperatorRequest;
    const requestKey = crypto.randomUUID();
    if (editing.type === 'refund') {
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !reason.trim()) return toast.error('请输入正数退款金额和原因');
      request = { kind: 'refund', channel: editing.row.pay_channel === 'wechat' ? 'wechat' : 'alipay', body: { action: 'refund', order_no: String(editing.row.order_no),
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
  async function submitWorkflow(request: PendingOperatorRequest) {
    if (pending || requestLock.current || localError) return;
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
      <Button variant="outline" disabled={listed.isFetching || busy} onClick={() => { void access.refetch(); void listed.refetch();
        if (['costs', 'cost_missing'].includes(selected.id)) void costs.refetch(); }}><RefreshCw className="w-4 h-4 mr-2" />刷新</Button>
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
      {selected.id === 'costs' && access.data?.permissions.includes('costs:write') && <Button type="button" disabled={!!pending || busy || !!localError}
        onClick={() => setWorkflow({ operation: 'cost_record', row: {} })}>登记现金成本</Button>}
    </form>
    {['costs', 'cost_missing'].includes(selected.id) && <div className="rounded-lg border p-4 space-y-2 text-sm">
      <p className="font-medium">已核对现金成本 · 当前客户范围的全部记录</p>
      {costs.isFetching ? <p role="status">正在读取成本汇总…</p> : costs.error ? <p role="alert">{costs.error.message}</p> : costs.data && <>
        {costs.data.totals.length ? costs.data.totals.map(total => <p key={total.currency}>{total.currency} {(total.amount_minor / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {total.entry_count} 笔账单与冲销</p>) : <p>暂无已核对账单</p>}
        <p className="text-muted-foreground">另有 {costs.data.unrecorded_workloads} 个调用尚未核对现金，不计为零成本。各币种独立汇总。</p>
      </>}
    </div>}
    {listed.error && <p role="alert" className="text-destructive">{listed.error.message}</p>}
    {selected.id === 'alerts' && listed.data?.monitor && <div className="rounded-lg border p-4 text-sm space-y-1" role={listed.data.monitor.stale ? 'alert' : 'status'}>
      <p>{listed.data.monitor.stale ? '告警采集超过三分钟未更新，请检查后台调度。' : '后台告警采集正常'}</p>
      <p className="text-muted-foreground">最近采集 {new Date(listed.data.monitor.last_scan_at).toLocaleString('zh-CN')} · 已接手的问题仍会持续监测，恢复后保留记录。</p>
    </div>}
    {listed.isFetching ? <p role="status">正在读取运营数据…</p> : listed.data && <>
      <p className="text-xs text-muted-foreground">共 {listed.data.total} 条 · 读取时间 {new Date(listed.data.observed_at).toLocaleString('zh-CN')}</p>
      {!listed.data.items.length ? <p className="border rounded-lg p-8 text-center text-muted-foreground">当前范围内没有记录</p> :
        <div className="overflow-x-auto border rounded-lg"><table className="w-full min-w-[640px] text-sm text-left">
          <caption className="sr-only">{selected.name}列表</caption><thead className="bg-muted/40"><tr>{selected.columns.map(([key, name]) => <th key={key} className="p-3 whitespace-nowrap">{name}</th>)}<th className="p-3">操作</th></tr></thead>
          <tbody>{listed.data.items.map(row => <tr key={String(row.id)} className="border-t align-top">
            {selected.columns.map(([key]) => <td key={key} className={['currency', 'amount_minor', 'total_amount', 'refunded_amount', 'status', 'state'].includes(key)
              ? 'p-3 whitespace-nowrap' : 'p-3 max-w-64 break-all'}>{selected.id === 'tickets' && row[key] === 'closed' ? '已关闭' : cell(row[key], key)}</td>)}
            <td className="p-3 space-y-2">
              {selected.id === 'orders' && canRefund && ['alipay', 'wechat'].includes(String(row.pay_channel)) && ['paid', 'partial_refunded'].includes(String(row.status)) &&
                <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError} onClick={() => { setEditing({ type: 'refund', row }); setAmount(''); setReason(''); }}>申请退款</Button>}
              {selected.id === 'refunds' && canRefund && row.status !== 'closed' && (!row.applied_at || row.status !== 'success') &&
                <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                  if (requestLock.current) return;
                  const owner = uid;
                  requestLock.current = true;
                  setBusy(true);
                  try { const result = await refundTradeOps(String(row.pay_channel), { action: 'refundQuery', order_no: String(row.order_no), out_request_no: String(row.out_request_no) }, owner);
                    if (currentUid.current !== owner) return;
                    toast.info(result.refund_status === 'success' ? '退款已到账' : result.refund_status === 'closed' ? '原退款已关闭，未到账' : '资金结果待确认'); await listed.refetch(); }
                  catch (cause) { if (currentUid.current === owner) toast.error(cause instanceof Error ? cause.message : '退款核对失败'); }
                  finally { if (currentUid.current === owner) { requestLock.current = false; setBusy(false); } }
                }}>核对原退款</Button>}
              {selected.id === 'customers' && canBudget && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                onClick={() => { setEditing({ type: 'budget', row }); setAmount(String(row.daily_credit_budget)); }}>设置日预算</Button>}
              {selected.id === 'customers' && row.id !== uid && access.data?.permissions.includes('risk:write') && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                onClick={() => setWorkflow({ operation: 'restriction', row })}>{row.restricted ? '解除任务限制' : '限制新计费任务'}</Button>}
              {selected.id === 'tickets' && <Button size="sm" variant="outline" onClick={() => setDetail({ type: 'ticket', id: String(row.id) })}>查看工单</Button>}
              {selected.id === 'alerts' && row.status === 'open' && !!row.can_ack && <Button size="sm" variant="outline"
                disabled={!!pending || busy || !!localError} onClick={() => setWorkflow({ operation: 'alert_ack', row })}>确认接手</Button>}
              {selected.id === 'tenants' && <><Button size="sm" variant="outline" onClick={() => setDetail({ type: 'tenant', id: String(row.id) })}>查看成员</Button>
                {canTenantWrite && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                  onClick={() => setWorkflow({ operation: 'tenant_update', row })}>调整租户策略</Button>}</>}
              {selected.id === 'risk' && access.data?.permissions.includes('risk:write') && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                onClick={() => setWorkflow({ operation: 'risk_review', row })}>核对风险</Button>}
              {selected.id === 'costs' && access.data?.permissions.includes('costs:write') && !row.reversal_of && <Button size="sm" variant="outline"
                disabled={!!pending || busy || !!localError} onClick={() => setWorkflow({ operation: 'cost_reverse', row })}>冲销原成本</Button>}
              {selected.id === 'cost_missing' && access.data?.permissions.includes('costs:write') && <Button size="sm" variant="outline" disabled={!!pending || busy || !!localError}
                onClick={() => setWorkflow({ operation: 'cost_record', row: { job_type: row.job_type, job_id: row.id } })}>核对原调用成本</Button>}
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
            : editing?.type === 'grant' ? '财务可退款和登记成本，运营可处理工单和预算，风险可核对事件与限制新计费任务；租户管理需要全部客户范围。'
              : '撤销后该角色立即无法发起新的运营操作。'}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
          {(editing?.type === 'refund' || editing?.type === 'budget') && <div className="space-y-2"><Label htmlFor="operator-amount">{editing.type === 'refund' ? `退款金额（实付 ¥${cell(editing.row.total_amount, 'total_amount')}）` : '日积分预算'}</Label>
            <Input id="operator-amount" value={amount} inputMode="decimal" required onChange={event => setAmount(event.target.value)} disabled={!!pending} /></div>}
          {editing?.type === 'refund' && <div className="space-y-2"><Label htmlFor="refund-reason">退款原因</Label><Input id="refund-reason" value={reason} maxLength={200} required onChange={event => setReason(event.target.value)} disabled={!!pending} /></div>}
          {editing?.type === 'grant' && <>
            <div className="space-y-2"><Label htmlFor="operator-id">运营账号 UUID</Label><Input id="operator-id" required value={operatorId} onChange={event => setOperatorId(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="operator-role">角色</Label><select id="operator-role" className="w-full p-2 rounded-md border bg-background" value={role} onChange={event => setRole(event.target.value)}><option value="finance">财务</option><option value="operations">运营</option><option value="risk">风险处置</option><option value="auditor">审计</option></select></div>
            <div className="space-y-2"><Label htmlFor="grant-scope">客户账号 UUID（留空授权全部客户）</Label><Input id="grant-scope" value={grantScope} onChange={event => setGrantScope(event.target.value)} /></div>
          </>}
          <Button type="submit" className="w-full" disabled={busy || !!pending || !!localError}>{busy ? '正在提交…' : '确认并提交'}</Button>
        </form>
      </DialogContent>
    </Dialog>
    {workflow && <OperationsWorkflowDialog key={`${workflow.operation}:${workflow.row.id || 'new'}`} edit={workflow}
      disabled={!!pending || busy || !!localError} onClose={() => setWorkflow(null)} onSubmit={submitWorkflow} />}
    {detail && <OperationsRecordDetail key={`${detail.type}:${detail.id}`} {...detail} disabled={!!pending || busy || !!localError}
      canWrite={detail.type === 'ticket' ? !!access.data?.permissions.includes('tickets:write') : !!canTenantWrite}
      onClose={() => setDetail(null)} onEdit={setWorkflow} />}
  </div>;
}
