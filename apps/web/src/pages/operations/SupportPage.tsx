import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import { loadOperatorRequest, operatorPendingKey, OperatorRequestError, operationsRequest, storeOperatorRequest,
  supportPage, type PendingOperatorRequest } from '@/api/operations';
import OperationsWorkflowDialog, { type WorkflowEdit } from '@/components/OperationsWorkflowDialog';
import OperationsRecordDetail, { SUPPORT_STATUS } from '@/components/OperationsRecordDetail';

export default function SupportPage() {
  const { user } = useAuth();
  const uid = user?.id || '';
  const currentUid = useRef(uid); currentUid.current = uid;
  const lock = useRef(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<WorkflowEdit | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ uid: string; request: PendingOperatorRequest | null }>({ uid: '', request: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = saved.uid === uid ? saved.request : null;
  const listed = useQuery({ queryKey: ['my-support', uid, page], queryFn: () => supportPage(page, uid), enabled: !!uid, retry: false });
  useEffect(() => {
    lock.current = false; setBusy(false); setEditing(null); setTicket(null); setError(''); setPage(1);
    try { setSaved({ uid, request: uid ? loadOperatorRequest(uid) : null }); }
    catch (cause) { setSaved({ uid, request: null }); setError(cause instanceof Error ? cause.message : '原申请恢复失败'); }
  }, [uid]);
  async function run(request: PendingOperatorRequest, save = false) {
    if (lock.current || request.kind !== 'operator' || !uid) return;
    lock.current = true; setBusy(true);
    const owner = uid;
    try {
      if (save) { storeOperatorRequest(owner, request); setSaved({ uid: owner, request }); }
      await operationsRequest(request.body, owner);
      if (currentUid.current !== owner) return;
      localStorage.removeItem(operatorPendingKey(owner)); setSaved({ uid: owner, request: null }); setEditing(null);
      toast.success('工单申请已保存'); await listed.refetch();
    } catch (cause) {
      if (currentUid.current !== owner) return;
      if (cause instanceof OperatorRequestError && cause.outcome === 'rejected') {
        localStorage.removeItem(operatorPendingKey(owner)); setSaved({ uid: owner, request: null }); setEditing(null); void listed.refetch();
      }
      toast.error(cause instanceof Error ? cause.message : '申请受理待确认，请保留原请求恢复');
    } finally { if (currentUid.current === owner) { lock.current = false; setBusy(false); } }
  }
  const disabled = busy || !!pending || !!error;
  return <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
    <PageHeader title="帮助与工单" description="描述原任务、订单或账号问题，保留回复和处理记录。" actions={
      <Button disabled={disabled} onClick={() => setEditing({ operation: 'ticket_create', row: {} })}>新建工单</Button>
    } />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {pending && <div className="border border-amber-500/40 rounded-lg p-4 space-y-3">
      <p className="font-medium">原申请尚未确认</p><p className="text-sm text-muted-foreground break-all">{pending.body.request_key}</p>
      {pending.kind === 'operator' && pending.body.operation.startsWith('ticket_') ?
        <Button disabled={busy} onClick={() => void run(pending)}>按原参数恢复</Button> : <Link className="text-primary underline" to="/operations">前往运营台核对原申请</Link>}
    </div>}
    {listed.error && <div role="alert" className="space-y-2"><p>{listed.error.message}</p><Button onClick={() => void listed.refetch()}>重试读取</Button></div>}
    {listed.isFetching ? <p role="status">正在读取工单…</p> : listed.data && <>
      {!listed.data.items.length && <p className="border rounded-lg text-center p-8 text-muted-foreground">暂无工单。遇到问题时可新建工单联系运营。</p>}
      {listed.data.items.map(row => <article key={String(row.id)} className="border rounded-lg p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-medium break-words min-w-0">{String(row.title)}</h2>
          <span className="text-sm text-muted-foreground">{SUPPORT_STATUS[String(row.status)] || String(row.status)}</span></div>
        <p className="text-xs text-muted-foreground">更新于 {new Date(String(row.updated_at)).toLocaleString('zh-CN')}</p>
        <Button variant="outline" onClick={() => setTicket(String(row.id))}>查看工单</Button>
      </article>)}
      <div className="flex justify-end items-center gap-3"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <span className="text-sm">第 {page} 页 · 共 {listed.data.total} 条</span>
        <Button variant="outline" size="sm" disabled={page * 25 >= listed.data.total || page >= 1000} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </>}
    {editing && <OperationsWorkflowDialog key={`${editing.operation}:${editing.row.id || 'new'}`} edit={editing} disabled={disabled}
      onClose={() => setEditing(null)} onSubmit={request => run(request, true)} />}
    {ticket && <OperationsRecordDetail key={ticket} type="ticket" id={ticket} disabled={disabled} canWrite={false} onClose={() => setTicket(null)} onEdit={setEditing} />}
  </div>;
}
