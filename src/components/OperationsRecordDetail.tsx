import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supportDetail, tenantDetail, type SupportDetail, type TenantDetail } from '@/api/operations';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WorkflowEdit } from './OperationsWorkflowDialog';
export const SUPPORT_STATUS: Record<string, string> = { open: '待处理', in_progress: '处理中', waiting_customer: '等待客户', resolved: '已解决', closed: '已关闭' };

export default function OperationsRecordDetail({ type, id, disabled, canWrite, onEdit, onClose }: {
  type: 'ticket' | 'tenant'; id: string; disabled: boolean; canWrite: boolean;
  onEdit: (edit: WorkflowEdit) => void; onClose: () => void;
}) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const record = useQuery<SupportDetail | TenantDetail>({ queryKey: ['operation-detail', user?.id, type, id, page], enabled: !!user?.id,
    queryFn: () => type === 'ticket' ? supportDetail(id, page, user?.id) : tenantDetail(id, page, user?.id), retry: false });
  const ticket = record.data && 'ticket' in record.data ? record.data.ticket : null;
  const tenant = record.data && 'tenant' in record.data ? record.data.tenant : null;
  const staff = record.data && 'staff' in record.data ? record.data.staff : false;
  const owner = ticket?.user_id === user?.id;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto min-w-0"><DialogHeader>
      <DialogTitle>{ticket ? String(ticket.title) : tenant ? String(tenant.name) : type === 'ticket' ? '工单记录' : '租户成员'}</DialogTitle>
      <DialogDescription className="break-all">记录编号：{id}</DialogDescription></DialogHeader>
      {record.isFetching && <p role="status">正在读取记录…</p>}
      {record.error && <div role="alert" className="space-y-2"><p>{record.error.message}</p><Button onClick={() => void record.refetch()}>重试</Button></div>}
      {ticket && <div className="space-y-3">
        <p className="text-sm">{SUPPORT_STATUS[String(ticket.status)]} · 版本 {String(ticket.version)}
          {ticket.assignee_id ? <span className="block break-all text-muted-foreground">处理人：{String(ticket.assignee_id)}</span> : ' · 未分配处理人'}</p>
        {!!ticket.related_id && <p className="text-sm text-muted-foreground break-all">关联{String(ticket.related_type)}：{String(ticket.related_id)}</p>}
        <div className="flex flex-wrap gap-2">
          {ticket.status !== 'closed' && (canWrite || owner) && <Button disabled={disabled}
            onClick={() => { onClose(); onEdit({ operation: 'ticket_reply', row: ticket, staff: !!staff && canWrite }); }}>回复工单</Button>}
          {(canWrite || ticket.status === 'resolved' && owner) && <Button variant="outline" disabled={disabled}
            onClick={() => { onClose(); onEdit({ operation: 'ticket_update', row: ticket, staff: !!staff && canWrite }); }}>处理工单</Button>}
        </div>
      </div>}
      {!!record.data && <div className="space-y-3">
        {!record.data.items.length && <p className="text-muted-foreground text-sm">当前页没有记录</p>}
        {record.data.items.map(row => <article key={String(row.id)} className="border rounded-lg p-3 space-y-2 min-w-0">
          {type === 'ticket' ? <>
            <p className="text-xs text-muted-foreground">{new Date(String(row.created_at)).toLocaleString('zh-CN')}{row.internal ? ' · 内部备注' : ''}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{String(row.body)}</p>
          </> : <>
            <p className="font-medium break-words">{String(row.username || row.email || row.user_id)}</p>
            <p className="text-sm text-muted-foreground break-all">{String(row.user_id)}</p>
            <p className="text-sm">{String(row.role)} · {row.status === 'active' ? '有效成员' : '已移除'}</p>
            {tenant && canWrite && row.status === 'active' && row.user_id !== tenant.owner_id && <Button size="sm" variant="outline" disabled={disabled}
              onClick={() => { onClose(); onEdit({ operation: 'tenant_member', row: { ...row, team_id: tenant.id, ops_version: tenant.ops_version } }); }}>管理成员</Button>}
          </>}
        </article>)}
        <div className="flex flex-wrap items-center justify-end gap-3"><Button size="sm" variant="outline" disabled={page <= 1 || record.isFetching} onClick={() => setPage(page - 1)}>上一页记录</Button>
          <span className="text-sm">第 {page} 页 · 共 {record.data.total} 条</span>
          <Button size="sm" variant="outline" disabled={page * 25 >= record.data.total || record.isFetching || page >= 1000} onClick={() => setPage(page + 1)}>下一页记录</Button></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
