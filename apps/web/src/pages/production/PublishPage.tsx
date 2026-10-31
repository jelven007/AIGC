import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { platformRequest, type PlatformConnection, type CreatorInfo, type PlatformPublishTask,
  type PublishOptions, type PublishTarget, type PublishGroupRequest } from '@/api/platforms';
import { capabilityError, groupRequest, uuid } from '../../../../../supabase/functions/_shared/publish-contract';
import { EdgeRequestError } from '@/lib/edgeRequest';
import { canonicalMedia } from '@/lib/privateMedia';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import FloatingNotice from '@/components/common/FloatingNotice';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { RefreshCw, Send, ExternalLink } from 'lucide-react';
import { taskListOptions } from '@/lib/taskQueries';
import { readTaskReceipt, writeTaskReceipt } from '@/lib/taskReceipt';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { requireAccountSession } from '@/api/accountSession';

type Form = { project_id: string; title: string; description: string; tags: string; scheduled_at: string; targets: PublishTarget[] };
type Receipt = { request_key: string; action: 'create_group' | 'create'; payload: Record<string, unknown> };
type Project = { id: string; title: string; video_url: string; duration: number };
const blank = (project = ''): Form => ({ project_id: project, title: '', description: '', tags: '', scheduled_at: '', targets: [] });
const initialOptions = (): PublishOptions => ({ privacy_level: '', consent: false, disable_comment: true,
  disable_duet: true, disable_stitch: true, brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true });
const statuses: Record<string, string> = { draft: '已排队', scheduled: '定时发布', publishing: '上传中',
  submitted: '平台处理中', moderating: '平台审核中', published: '已发布', failed: '失败', unknown: '待核对', cancelled: '已取消' };
const privacyNames: Record<string, string> = { PUBLIC_TO_EVERYONE: '所有人', MUTUAL_FOLLOW_FRIENDS: '互关好友',
  FOLLOWER_OF_CREATOR: '关注者', SELF_ONLY: '仅自己', '0': '所有人', '1': '仅自己', '2': '好友' };
const optionLabels = { disable_comment: '关闭评论', disable_duet: '关闭合拍', disable_stitch: '关闭拼接',
  brand_content_toggle: '付费合作推广', brand_organic_toggle: '推广自己的品牌', is_aigc: 'AI生成内容' };
function localTime(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function PublishPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [creators, setCreators] = useState<Record<string, CreatorInfo>>({});
  const [creatorErrors, setCreatorErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Form>(() => blank(params.get('projectId') || ''));
  const [pending, setPending] = useState<Receipt | null>(null);
  const receipt = useRef<Receipt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [storageError, setStorageError] = useState(false);
  const activeUser = useRef(user?.id);
  activeUser.current = user?.id;
  const submitting = useRef(false);
  const storageKey = user ? `shopro:publish:${user.id}` : '';
  const accounts = useQuery({ queryKey: ['publish-accounts', user?.id], enabled: !!user, staleTime: 300000, retry: false,
    queryFn: ({ signal }) => platformRequest<{ connections: PlatformConnection[]; platforms: { id: string; name: string; enabled: boolean }[] }>(
      'platform-accounts', { action: 'list' }, user!.id, signal) });
  const history = useTaskQuery(useMemo(() => taskListOptions('publish', user?.id), [user?.id]), 'publish', !!user);
  const works = useQuery({ queryKey: ['publish-projects', user?.id], enabled: !!user, staleTime: 300000, retry: false,
    queryFn: async ({ signal }) => {
      const uid = user!.id; await requireAccountSession(uid);
      const result = await supabase.from('video_projects').select('id,title,video_url,duration').eq('user_id', uid)
        .eq('status', 'completed').order('created_at', { ascending: false }).limit(50).abortSignal(signal);
      if (result.error) throw new Error('作品读取失败');
      await requireAccountSession(uid);
      return (result.data || []) as Project[];
    } });
  const connections = accounts.data?.connections || [], platforms = accounts.data?.platforms || [];
  const tasks = history.data?.tasks || [], groups = history.data?.groups || [], projects = works.data || [];
  const loading = [accounts, history, works].some(query => query.isPending);
  const project = projects.find(item => item.id === form.project_id);

  const clearReceipt = useCallback(() => {
    writeTaskReceipt(storageKey, null);
    receipt.current = null; setPending(null);
    setForm(previous => ({ ...previous, targets: previous.targets.map(target =>
      ({ ...target, options: { ...target.options, consent: false } })) }));
  }, [storageKey]);
  useEffect(() => {
    setCreators({}); setCreatorErrors({}); submitting.current = false; setBusy('');
    setForm(blank(params.get('projectId') || '')); receipt.current = null; setPending(null); setError(''); setStorageError(false);
    if (!user) return;
    try {
      localStorage.removeItem('platform_credentials'); localStorage.removeItem('platform_auth');
      localStorage.removeItem(`platform_auths_${user.id}`);
      const original = readTaskReceipt<any>(storageKey, value => value && uuid(value.request_key) && (value.form || value.payload));
      if (original.error) throw new Error(original.error);
      const stored = original.value;
      if (!stored) return;
      // 升级前未确认的单账号请求必须沿用旧 action 与 UUID，不能迁移成新的发布组。
      let saved: Receipt;
      if (stored.form && uuid(stored.request_key)) {
        const old = stored.form;
        saved = { request_key: stored.request_key, action: 'create', payload: {
          project_id: old.project_id, connection_id: old.connection_id, title: old.title, description: old.description,
          tags: old.tags.split(/[,，\s]+/).filter(Boolean), scheduled_at: old.scheduled_at ? new Date(old.scheduled_at).toISOString() : null,
          options: Object.fromEntries(['privacy_level', 'consent', ...Object.keys(optionLabels)].map(key => [key, old[key]])),
        } };
      } else saved = stored;
      if (!uuid(saved.request_key) || !['create', 'create_group'].includes(saved.action)) throw new Error('本地发布回执无法读取，请联系管理员核对任务');
      const payload = groupRequest({ request_key: saved.request_key, ...saved.payload,
        ...(saved.action === 'create' ? { source_url: 'https://legacy.invalid/unused', duration: 1 } : {}),
        targets: saved.action === 'create' ? [{ connection_id: saved.payload.connection_id, options: saved.payload.options }] : saved.payload.targets });
      receipt.current = saved; setPending(saved);
      setForm({ ...payload, tags: payload.tags.join(', '), scheduled_at: localTime(payload.scheduled_at) });
    } catch (cause) { setStorageError(true); setError(cause instanceof Error ? cause.message : '本地发布记录读取失败'); }
  }, [storageKey, user?.id, params]);

  const load = useCallback(async () => {
    if (!user) return;
    const owner = user.id;
    try {
      await Promise.all([accounts.refetch({ throwOnError: true }), history.refetch({ throwOnError: true }), works.refetch({ throwOnError: true })]);
      if (activeUser.current !== owner) return;
      const saved = receipt.current;
      if (saved && !submitting.current) {
        const found = await platformRequest('platform-publish', {
          action: saved.action === 'create_group' ? 'query_group' : 'query', request_key: saved.request_key,
        }, owner);
        if (activeUser.current !== owner || receipt.current !== saved) return;
        if (found.group || found.task) { clearReceipt(); toast.success('已恢复原发布记录，请查看下方进度'); }
      }
    } catch (cause) { if (activeUser.current === owner) setError(cause instanceof Error ? cause.message : '发布数据读取失败'); }
  }, [user?.id, clearReceipt, accounts.refetch, history.refetch, works.refetch]);
  useEffect(() => {
    const saved = receipt.current, owner = user?.id;
    if (!saved || !owner || !history.data || submitting.current) return;
    if (saved.action === 'create_group' ? history.data.groups.some(group => group.request_key === saved.request_key)
      : history.data.tasks.some(task => task.request_key === saved.request_key)) {
      try { clearReceipt(); toast.success('已恢复原发布记录，请查看下方进度'); }
      catch (cause) { setStorageError(true); setError((cause as Error).message); }
    }
  }, [history.data, pending, user?.id, clearReceipt]);

  const fetchCreator = async (id: string) => {
    const owner = user?.id;
    setCreatorErrors(previous => ({ ...previous, [id]: '' }));
    try {
      const info = await platformRequest<CreatorInfo>('platform-accounts', { action: 'creator', connection_id: id }, owner);
      if (activeUser.current === owner) setCreators(previous => ({ ...previous, [id]: info }));
    } catch (cause) {
      if (activeUser.current === owner) setCreatorErrors(previous => ({ ...previous, [id]: (cause as Error).message }));
    }
  };
  const selectedIds = form.targets.map(target => target.connection_id).join(',');
  useEffect(() => {
    for (const id of selectedIds.split(',').filter(Boolean)) void fetchCreator(id);
  }, [selectedIds, user?.id]);

  const patch = (values: Partial<Form>) => {
    if (receipt.current || submitting.current) return;
    setForm(previous => ({ ...previous, ...values, targets: (values.targets || previous.targets)
      .map(target => ({ ...target, options: { ...target.options, consent: false } })) }));
  };
  const patchTarget = (id: string, values: Partial<PublishOptions>) => {
    if (receipt.current || submitting.current) return;
    setForm(previous => ({ ...previous, targets: previous.targets.map(target => target.connection_id !== id ? target
      : { ...target, options: { ...target.options, consent: false, ...values } }) }));
  };
  const authorize = async (platform: string) => {
    const owner = user?.id; if (!owner) return;
    setBusy(platform);
    try { const result = await platformRequest('platform-accounts', { action: 'authorize', platform }, owner);
      if (activeUser.current === owner) window.location.assign(result.url); }
    catch (cause) { if (activeUser.current === owner) { setError((cause as Error).message); setBusy(''); } }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || submitting.current || storageError) return;
    const owner = user.id;
    submitting.current = true; setBusy('publish'); setError('');
    let attempted = false;
    try {
      let saved = receipt.current;
      if (!saved) {
        if (!project) throw new Error('请选择已完成的作品');
        for (const target of form.targets) {
          const invalid = capabilityError(creators[target.connection_id], target.options, project.duration);
          if (invalid) throw new Error(invalid);
        }
        const batchItem = params.get('batchItemId');
        const batchKey = params.get('batchRequestKey');
        if (batchItem && (!uuid(batchItem) || !uuid(batchKey))) throw new Error('请从批次成片入口恢复原发布标识');
        const key = batchItem ? batchKey! : crypto.randomUUID();
        const payload: PublishGroupRequest = groupRequest({ ...form, request_key: key,
          ...(batchItem ? { batch_item_id: batchItem } : {}),
          source_url: canonicalMedia(project.video_url), duration: project.duration,
          tags: form.tags.split(/[,，\s]+/).filter(Boolean), scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null });
        saved = { action: 'create_group', request_key: key, payload };
        // 保存成功后才发起请求，使断线/关页后能够继续核对。
        writeTaskReceipt(storageKey, saved); receipt.current = saved; setPending(saved);
      }
      attempted = true;
      const response = await platformRequest('platform-publish', { ...saved.payload, action: saved.action, request_key: saved.request_key }, owner);
      if (!response.group && !response.task) throw new Error('发布结果待确认，请核对原请求');
      if (activeUser.current !== owner) return;
      clearReceipt(); toast.success('发布任务已保存，各账号进度将在后台持续更新');
    } catch (cause) {
      if (activeUser.current !== owner) return;
      // 鉴权失败、幂等冲突和网络故障保留回执；参数拒绝/数据库确定回滚才允许编辑。
      if (attempted && cause instanceof EdgeRequestError && (cause.status === 400 || cause.code === 'publish_group_rejected')) clearReceipt();
      setError(cause instanceof Error ? cause.message : '发布请求结果待确认，请核对原请求');
    } finally {
      if (activeUser.current === owner) { submitting.current = false; setBusy(''); void history.refetch(); }
    }
  };
  const changeAccount = (id: string, checked: boolean) => {
    if (checked && form.targets.length >= 10) { toast.info('一次最多选择10个账号'); return; }
    patch({ targets: checked ? [...form.targets, { connection_id: id, options: initialOptions() }]
      : form.targets.filter(target => target.connection_id !== id) });
  };
  const cancel = async (id: string) => {
    const owner = user?.id; if (!owner) return;
    setBusy(id);
    try { await platformRequest('platform-publish', { action: 'cancel', task_id: id }, owner);
      if (activeUser.current === owner) await history.refetch(); }
    catch (cause) { if (activeUser.current === owner) toast.error((cause as Error).message); }
    finally { if (activeUser.current === owner) setBusy(''); }
  };
  const accountName = (id?: string) => connections.find(connection => connection.id === id)?.display_name || '历史账号';
  const renderTask = (task: PlatformPublishTask) => <div key={task.id} className="py-3 flex flex-wrap justify-between gap-3">
    <div className="min-w-0 flex-1"><p className="font-medium break-words">{accountName(task.connection_id)} · {task.platform}</p>
      <p className="text-sm text-muted-foreground mt-1">{statuses[task.status] || task.status}{task.scheduled_at ? ` · ${new Date(task.scheduled_at).toLocaleString()}` : ''}</p>
      {task.error_message && <p className="text-sm text-destructive mt-2 break-words">{task.error_message}</p>}</div>
    <div className="flex gap-2 items-start">{task.platform_url?.startsWith('https://') && <Button asChild size="sm" variant="outline"><a href={task.platform_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" />查看</a></Button>}
      {['draft', 'scheduled'].includes(task.status) && <Button disabled={!!busy} variant="ghost" size="sm" onClick={() => void cancel(task.id)}>取消</Button>}</div>
  </div>;
  const locked = !!pending || !!busy || storageError;
  const valid = !!project && form.targets.length > 0 && form.targets.every(target =>
    target.options.consent && !creatorErrors[target.connection_id] && !capabilityError(creators[target.connection_id], target.options, project.duration));
  const knownGroups = new Set(groups.map(group => group.id));

  return <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <PageHeader title="跨平台发布" description="一份成片可发布到多个账号。逐个确认可见范围和内容声明，发布后分别跟踪进度。" actions={
      <Button variant="outline" disabled={!!busy} onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button>
    } />
    {(error || accounts.error || history.error || works.error) && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      {error || accounts.error?.message || history.error?.message || works.error?.message}</p>}
    {pending && <FloatingNotice id={`publish-pending-${user?.id}`} title="上一发布请求结果待确认" tone="warning" duration={Infinity}>
      <p>原内容已保留，请刷新核对或按原参数重试。</p>
      <p className="break-all text-muted-foreground">请求编号：{pending.request_key}</p>
      <Button variant="outline" disabled={!!busy} onClick={() => void load()}>核对原请求</Button>
    </FloatingNotice>}
    <section aria-label="平台授权" className="grid gap-4 sm:grid-cols-2">{platforms.map(platform => <div key={platform.id} className="border border-border rounded-xl p-5 bg-card">
      <div className="flex justify-between gap-3"><h2 className="font-semibold">{platform.name}</h2><Button size="sm" disabled={!platform.enabled || locked} onClick={() => void authorize(platform.id)}>{platform.enabled ? '授权账号' : '待管理员配置'}</Button></div>
      <div className="space-y-2 mt-3">{connections.filter(connection => connection.platform === platform.id).map(connection => <div key={connection.id} className="flex justify-between text-sm items-center gap-2">
        <span className="break-words min-w-0">{connection.display_name} · {connection.status === 'active' ? '已连接' : '已断开'}</span>
        <Button size="sm" variant="ghost" disabled={locked || connection.status !== 'active'} onClick={async () => {
          setBusy(connection.id);
          try {
            const owner = user?.id; if (!owner) return;
            await platformRequest('platform-accounts', { action: 'disconnect', connection_id: connection.id }, owner);
            if (activeUser.current !== owner) return;
            patch({ targets: form.targets.filter(target => target.connection_id !== connection.id) }); await load();
          } catch (cause) { toast.error((cause as Error).message); } finally { setBusy(''); }
        }}>断开</Button></div>)}</div>
    </div>)}</section>
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-5">
      <h2 className="text-lg font-semibold">创建发布组</h2>
      <fieldset disabled={locked} className="space-y-4 min-w-0">
        <label className="block text-sm space-y-2">成片<select required value={form.project_id} onChange={event => {
          const item = projects.find(p => p.id === event.target.value); patch({ project_id: event.target.value, title: item?.title || '' });
        }} className="block w-full h-10 rounded-md border border-input bg-background px-3"><option value="">选择已完成作品</option>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        {project?.video_url && <video src={project.video_url} controls playsInline className="w-full max-h-64 rounded-lg bg-black" />}
        {!projects.length && !loading && <p className="text-sm text-muted-foreground">还没有成片，请先在作品库完成生成或渲染。</p>}
        <label className="block text-sm space-y-2">标题<Input required maxLength={150} value={form.title} onChange={event => patch({ title: event.target.value })} /></label>
        <label className="block text-sm space-y-2">简介<Textarea maxLength={1000} value={form.description} onChange={event => patch({ description: event.target.value })} /></label>
        <div className="grid gap-4 md:grid-cols-2"><label className="text-sm space-y-2">标签<Input value={form.tags} onChange={event => patch({ tags: event.target.value })} placeholder="逗号分隔，最多10个" /></label>
          <label className="text-sm space-y-2">定时发布<Input type="datetime-local" value={form.scheduled_at} onChange={event => patch({ scheduled_at: event.target.value })} /><span className="block text-xs text-muted-foreground">本地时间，未来30天内；留空立即排队。</span></label></div>
        <fieldset className="space-y-3"><legend className="text-sm font-medium mb-2">发布账号 · 已选 {form.targets.length}/10</legend>
          {!connections.some(item => item.status === 'active') && <p className="text-sm text-muted-foreground">请先在上方授权一个平台账号。</p>}
          {connections.filter(item => item.status === 'active').map(connection => <label key={connection.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.targets.some(target => target.connection_id === connection.id)} onChange={event => changeAccount(connection.id, event.target.checked)} />
            {connection.platform} · {connection.display_name}</label>)}
        </fieldset>
        <div className="divide-y divide-border">{form.targets.map(target => {
          const info = creators[target.connection_id], options = target.options;
          const invalid = info && project ? capabilityError(info, options, project.duration) : null;
          return <fieldset key={target.connection_id} className="py-4 space-y-3 min-w-0">
            <legend className="font-medium pt-3 break-words">{accountName(target.connection_id)}</legend>
            {!info && !creatorErrors[target.connection_id] && <p role="status" className="text-sm text-muted-foreground">正在读取账号权限…</p>}
            {creatorErrors[target.connection_id] && <div className="text-sm text-destructive"><p>{creatorErrors[target.connection_id]}</p><Button type="button" variant="outline" size="sm" onClick={() => void fetchCreator(target.connection_id)}>重试读取权限</Button></div>}
            {info && <><p className="text-sm text-muted-foreground">{info.platform} · 最长 {info.max_video_post_duration_sec} 秒</p>
              <label className="block text-sm space-y-2">可见范围<select required value={options.privacy_level}
                onChange={event => patchTarget(target.connection_id, { privacy_level: event.target.value })} className="block w-full h-10 rounded-md border border-input bg-background px-3">
                <option value="">请选择</option>{info.privacy_level_options.map(value => <option key={value} value={value}>{privacyNames[value] || value}</option>)}</select></label>
              {info.platform === 'tiktok' && <div className="flex flex-wrap gap-4 text-sm">{(Object.keys(optionLabels) as (keyof typeof optionLabels)[]).map(field => <label key={field} className="flex items-center gap-2">
                <input type="checkbox" checked={options[field]} disabled={(field === 'disable_comment' && info.comment_disabled) || (field === 'disable_duet' && info.duet_disabled) || (field === 'disable_stitch' && info.stitch_disabled)}
                  onChange={event => patchTarget(target.connection_id, { [field]: event.target.checked })} />{optionLabels[field]}</label>)}</div>}
              {info.platform === 'douyin' && <p className="text-sm text-muted-foreground">抖音评论、商业推广与 AI 内容标识请在平台按实际内容确认；此处设置内容与可见范围。</p>}
              {invalid && <p className="text-sm text-destructive">{invalid}</p>}
              <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={options.consent} className="mt-1"
                onChange={event => patchTarget(target.connection_id, { consent: event.target.checked })} />
                我已预览当前视频，确认发布到 {info.display_name}，并确认音乐使用权和平台条款。</label>
            </>}
          </fieldset>;
        })}</div>
      </fieldset>
      <p className="text-sm text-muted-foreground">发布服务当前不额外扣积分。全部账号通过校验后一起保存，平台受理和审核进度各自更新。</p>
      <Button type="submit" disabled={storageError || !!busy || (!pending && !valid)}><Send className="mr-2 h-4 w-4" />
        {busy === 'publish' ? '正在提交…' : pending ? '按原参数重试' : `提交到 ${form.targets.length} 个账号`}</Button>
    </form>
    <section aria-label="发布记录" className="space-y-3"><h2 className="text-lg font-semibold">发布记录</h2>
      <p className="text-sm text-muted-foreground">最近20个发布组与100条任务，每15秒更新。已提交平台的任务继续核对，不会因重试整组而重复发布。</p>
      {loading && <p role="status" className="text-sm text-muted-foreground">正在读取发布记录…</p>}
      {!loading && !tasks.length && !groups.length && <p className="py-8 text-muted-foreground text-sm">暂无发布任务。</p>}
      {groups.map(group => <article key={group.id} className="rounded-xl border border-border p-4">
        <h3 className="font-semibold break-words">{group.request.title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{group.tasks.filter(task => task.status === 'published').length}/{group.tasks.length} 个账号已发布 · {new Date(group.created_at).toLocaleString()}</p>
        <div className="divide-y divide-border mt-2">{group.tasks.map(renderTask)}</div>
      </article>)}
      {tasks.filter(task => !task.group_id || !knownGroups.has(task.group_id)).map(task => <article key={task.id} className="border border-border rounded-xl p-4">
        <h3 className="font-semibold break-words">{task.title}</h3>{renderTask(task)}</article>)}
    </section>
  </div>;
}
