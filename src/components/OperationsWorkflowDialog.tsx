import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { OperatorOperation, PendingOperatorRequest } from '@/api/operations';

export type WorkflowEdit = { operation: OperatorOperation; row: Record<string, unknown>; staff?: boolean };
type Field = { key: string; label: string; max?: number; options?: [string, string][]; optional?: boolean; multiline?: boolean };
const statusOptions: [string, string][] = [['open', '待处理'], ['in_progress', '处理中'], ['waiting_customer', '等待客户'], ['resolved', '已解决'], ['closed', '已关闭']];
const fields: Partial<Record<OperatorOperation, Field[]>> = {
  ticket_create: [{ key: 'title', label: '工单标题', max: 120 },
    { key: 'category', label: '问题类别', options: [['task', '生成与发布'], ['payment', '支付与退款'], ['access', '账号与授权'], ['other', '其他']] },
    { key: 'body', label: '问题描述', max: 2000, multiline: true },
    { key: 'related_type', label: '关联对象类型（可选）', optional: true, options: [['', '不关联'], ['video', '视频任务'], ['production', '生产任务'], ['order', '订单']] },
    { key: 'related_id', label: '关联对象编号（可选）', optional: true }],
  ticket_reply: [{ key: 'body', label: '回复正文', max: 2000, multiline: true }],
  alert_ack: [],
  ticket_update: [{ key: 'status', label: '工单状态', options: statusOptions },
    { key: 'priority', label: '优先级', options: [['normal', '普通 · 24小时'], ['high', '紧急 · 4小时'], ['low', '低 · 72小时']] },
    { key: 'assignee_id', label: '处理人账号 UUID（留空取消分配）', optional: true }],
  tenant_update: [{ key: 'name', label: '租户名称', max: 80 }, { key: 'state', label: '租户状态', options: [['active', '启用'], ['suspended', '暂停']] },
    { key: 'max_members', label: '成员上限（1–1000）' }, { key: 'daily_credit_budget', label: '团队日积分预算（0为不限额）' },
    { key: 'owner_id', label: '所有者账号 UUID（须为有效成员）' }],
  tenant_member: [{ key: 'member_action', label: '成员处置', options: [['role', '调整角色'], ['remove', '移除成员']] },
    { key: 'role', label: '成员角色', options: [['editor', '编辑者'], ['admin', '管理员'], ['viewer', '查看者']] }],
  risk_review: [{ key: 'disposition', label: '处置结果', options: [['reviewing', '核查中'], ['dismissed', '误报或排除'], ['confirmed', '确认风险']] }],
  restriction: [{ key: 'restricted', label: '新计费任务权限', options: [['true', '限制'], ['false', '解除限制']] }],
  cost_record: [{ key: 'job_type', label: '原调用类型', options: [['video', '视频任务'], ['production', '生产任务'], ['model_call', '同步模型调用']] },
    { key: 'job_id', label: '原任务或调用 UUID' }, { key: 'cash_amount', label: '账单现金金额', max: 16 },
    { key: 'currency', label: '账单币种', options: [['CNY', '人民币 CNY'], ['USD', '美元 USD'], ['EUR', '欧元 EUR']] }],
};
const titles: Partial<Record<OperatorOperation, string>> = { ticket_create: '新建工单', ticket_reply: '回复工单', ticket_update: '处理工单',
  tenant_update: '调整租户策略', tenant_member: '处理租户成员', risk_review: '核对风险事件', restriction: '调整新计费任务权限', cost_record: '登记供应商现金成本', cost_reverse: '冲销原成本流水', alert_ack: '确认接手告警' };

export default function OperationsWorkflowDialog({ edit, disabled, onClose, onSubmit }: {
  edit: WorkflowEdit; disabled: boolean; onClose: () => void; onSubmit: (request: PendingOperatorRequest) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of fields[edit.operation] || []) initial[field.key] = String(edit.row[field.key] ?? field.options?.[0][0] ?? '');
    if (edit.operation === 'ticket_create') initial.related_type = '';
    if (edit.operation === 'ticket_update' && !edit.staff) initial.status = 'closed';
    if (edit.operation === 'restriction') initial.restricted = edit.row.restricted ? 'false' : 'true';
    if (edit.operation === 'risk_review') initial.disposition = 'reviewing';
    return initial;
  });
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState('');
  const [hashing, setHashing] = useState(false);
  const patch = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const cost = edit.operation.startsWith('cost_');
  const requireReason = !['ticket_create', 'ticket_reply'].includes(edit.operation);
  let visibleFields = fields[edit.operation] || [];
  if (edit.operation === 'ticket_update' && !edit.staff) visibleFields = [
    { key: 'status', label: '工单状态', options: [['closed', '确认并关闭'], ['open', '重新打开']] },
  ];
  async function submit() {
    setError('');
    const payload: Record<string, unknown> = {};
    for (const field of visibleFields) {
      const value = values[field.key]?.trim() || '';
      if (!field.optional && !value) return setError(`请填写${field.label}`);
      payload[field.key] = value || null;
    }
    if (requireReason) {
      if (!values.reason?.trim()) return setError('请填写操作原因');
      payload.reason = values.reason.trim();
    }
    const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    for (const name of ['assignee_id', 'owner_id', 'job_id', 'related_id']) {
      if (payload[name] && !uuid(payload[name])) return setError('对象或账号编号须为有效 UUID');
    }
    if (edit.operation === 'ticket_create') {
      if (!!payload.related_type !== !!payload.related_id) return setError('关联类型和编号须一起填写');
    }
    if (edit.operation.startsWith('ticket_') && edit.operation !== 'ticket_create') {
      payload.ticket_id = edit.row.id; payload.expected = edit.row.version;
      if (edit.operation === 'ticket_reply') payload.internal = !!edit.staff && internal;
    }
    if (edit.operation === 'tenant_update') {
      for (const key of ['max_members', 'daily_credit_budget']) {
        if (!/^\d+$/.test(values[key])) return setError('成员上限和预算须为整数');
        payload[key] = Number(values[key]);
      }
      if (Number(payload.max_members) < 1 || Number(payload.max_members) > 1000
        || Number(payload.daily_credit_budget) > 1000000) return setError('成员上限或预算超出范围');
      payload.team_id = edit.row.id; payload.expected = edit.row.ops_version;
    }
    if (edit.operation === 'risk_review') { payload.event_id = edit.row.id; payload.expected = edit.row.ops_version; }
    if (edit.operation === 'alert_ack') { payload.alert_id = edit.row.id; payload.expected = edit.row.version; }
    if (edit.operation === 'tenant_member') { payload.team_id = edit.row.team_id; payload.member_id = edit.row.id; payload.expected = edit.row.ops_version; }
    if (edit.operation === 'restriction') { payload.user_id = edit.row.id; payload.expected = edit.row.restriction_version; payload.restricted = values.restricted === 'true'; }
    if (cost) {
      for (const key of ['statement_ref', 'line_ref', 'evidence_sha256']) {
        if (!values[key]?.trim()) return setError('请填写原账单编号、行号和凭证指纹');
        payload[key] = values[key].trim();
      }
      if (!/^[0-9a-f]{64}$/.test(String(payload.evidence_sha256))) return setError('凭证指纹须为64位 SHA-256');
      if (edit.operation === 'cost_record') {
        if (!/^\d+(\.\d{1,2})?$/.test(values.cash_amount)) return setError('请输入非负金额，最多两位小数');
        const [whole, fraction = ''] = values.cash_amount.split('.');
        const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000) return setError('现金金额须为0至10000000；零成本也须有真实凭证');
        payload.amount_minor = amount; delete payload.cash_amount;
      } else payload.entry_id = edit.row.id;
    }
    await onSubmit({ kind: 'operator', body: { action: 'mutate', operation: edit.operation, request_key: crypto.randomUUID(), payload } });
  }
  return <Dialog open onOpenChange={open => { if (!open && !disabled && !hashing) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{titles[edit.operation]}</DialogTitle>
      <DialogDescription>{cost ? '按已核对账单登记实际现金，包括有凭证的零成本。账单编号须包含供应商和账号，原件由企业归档。冲销不改变应用积分。'
        : edit.operation === 'tenant_update' ? '暂停阻止新的计费任务和共享访问；已签发链接在有效期内仍可能访问，原受理任务继续恢复。'
          : edit.operation === 'restriction' ? '限制只作用于新的计费任务。原任务查询、退款和工单申诉继续可用。'
            : edit.operation === 'alert_ack' ? '确认代表接手处理。原问题消除后由后台记录恢复；再次发生会重新打开告警。'
            : '按当前记录版本提交，回复和处置保留原请求回执。'}</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!disabled && !hashing) void submit(); }}>
        <fieldset disabled={disabled || hashing} className="space-y-4 min-w-0">
          {visibleFields.map(field => <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`workflow-${field.key}`}>{field.label}</Label>
            {field.options ? <select id={`workflow-${field.key}`} className="w-full border rounded-md bg-background p-2"
              value={values[field.key] || field.options[0][0]} onChange={event => patch(field.key, event.target.value)}>
              {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              : field.multiline ? <Textarea id={`workflow-${field.key}`} required={!field.optional} maxLength={field.max}
                value={values[field.key] || ''} onChange={event => patch(field.key, event.target.value)} />
                : <Input id={`workflow-${field.key}`} required={!field.optional} maxLength={field.max || 120}
                  value={values[field.key] || ''} onChange={event => patch(field.key, event.target.value)} />}
          </div>)}
          {edit.operation === 'ticket_reply' && edit.staff && <label className="flex gap-2 items-center text-sm">
            <input type="checkbox" checked={internal} onChange={event => setInternal(event.target.checked)} />内部备注（客户不可见）</label>}
          {cost && <>
            {[['statement_ref', '账单编号（供应商/账号/账单号）'], ['line_ref', '账单行号'], ['evidence_sha256', '凭证指纹 SHA-256']].map(([key, label]) =>
              <div key={key} className="space-y-1.5"><Label htmlFor={`workflow-${key}`}>{label}</Label>
                <Input id={`workflow-${key}`} required value={values[key] || ''} maxLength={key === 'evidence_sha256' ? 64 : 120}
                  onChange={event => patch(key, event.target.value)} /></div>)}
            <div className="space-y-1.5"><Label htmlFor="workflow-evidence">凭证文件（计算指纹，原件由企业归档）</Label>
              <Input id="workflow-evidence" type="file" onChange={async event => {
                const file = event.target.files?.[0]; if (!file) return;
                if (file.size > 10 * 1024 * 1024) { setError('凭证文件不能超过10MB'); return; }
                setHashing(true);
                try { const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
                  patch('evidence_sha256', Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')); }
                catch { setError('凭证指纹计算失败，请重新选择文件'); }
                finally { setHashing(false); }
              }} /></div>
          </>}
          {requireReason && <div className="space-y-1.5"><Label htmlFor="workflow-reason">操作原因</Label>
            <Textarea id="workflow-reason" required maxLength={2000} value={values.reason || ''} onChange={event => patch('reason', event.target.value)} /></div>}
        </fieldset>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <Button type="submit" className="w-full" disabled={disabled || hashing}>{hashing ? '正在计算凭证指纹…' : disabled ? '原申请待确认…' : '确认并提交'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
