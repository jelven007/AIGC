import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { platformRequest, type PlatformConnection, type CreatorInfo } from '@/api/platforms';
import { EdgeRequestError } from '@/lib/edgeRequest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Globe, RefreshCw, Send, ExternalLink } from 'lucide-react';
type PublishTask = { id: string; project_id: string; connection_id: string; platform: string; title: string;
  request_key?: string;
  status: string; scheduled_at: string | null; platform_url: string | null; error_message: string | null };
const statuses: Record<string, string> = { draft: '已排队', scheduled: '定时发布', publishing: '上传中',
  submitted: '平台处理中', moderating: '平台审核中', published: '已发布', failed: '失败', unknown: '待核对', cancelled: '已取消' };
const privacyNames: Record<string, string> = { PUBLIC_TO_EVERYONE: '所有人', MUTUAL_FOLLOW_FRIENDS: '互关好友',
  FOLLOWER_OF_CREATOR: '关注者', SELF_ONLY: '仅自己', '0': '所有人', '1': '仅自己', '2': '好友' };
export default function PublishPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [platforms, setPlatforms] = useState<{ id: string; name: string; enabled: boolean }[]>([]);
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string; video_url: string; duration: number }[]>([]);
  const [creator, setCreator] = useState<CreatorInfo | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ project_id: params.get('projectId') || '', connection_id: '', title: '',
    description: '', tags: '', scheduled_at: '', privacy_level: '', consent: false,
    disable_comment: true, disable_duet: true, disable_stitch: true, brand_content_toggle: false,
    brand_organic_toggle: false, is_aigc: true });
  const requestKey = useRef<string | null>(null);
  const receipt = useRef<{ request_key: string; form: typeof form } | null>(null);
  useEffect(() => {
    localStorage.removeItem('platform_credentials');
    localStorage.removeItem('platform_auth');
    if (user) localStorage.removeItem(`platform_auths_${user.id}`);
    try {
      receipt.current = user ? JSON.parse(localStorage.getItem(`shopro:publish:${user.id}`) || 'null') : null;
      if (receipt.current) { requestKey.current = receipt.current.request_key; setForm(receipt.current.form); }
    } catch { receipt.current = null; }
  }, [user]);
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const accounts = await platformRequest('platform-accounts', { action: 'list' });
      const publish = await platformRequest('platform-publish', { action: 'list' });
      const result = await supabase.from('video_projects').select('id,title,video_url,duration').eq('user_id', user.id)
        .eq('status', 'completed').order('created_at', { ascending: false }).limit(50);
      if (result.error) throw new Error('作品读取失败');
      setConnections(accounts.connections); setPlatforms(accounts.platforms); setTasks(publish.tasks);
      setProjects(result.data || []); setError('');
      if (receipt.current) {
        const existing = await platformRequest('platform-publish', { action: 'query', request_key: receipt.current.request_key });
        if (existing.task) {
          receipt.current = null; requestKey.current = null; localStorage.removeItem(`shopro:publish:${user.id}`);
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : '发布数据读取失败'); }
  }, [user]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer); }, [load]);
  useEffect(() => {
    let stopped = false;
    setCreator(null);
    if (form.connection_id) platformRequest<CreatorInfo>('platform-accounts', { action: 'creator', connection_id: form.connection_id })
      .then(info => { if (!stopped) setCreator(info); }).catch(e => { if (!stopped) setError(e.message); });
    return () => { stopped = true; };
  }, [form.connection_id]);
  const authorize = async (platform: string) => {
    setBusy(platform);
    try { const result = await platformRequest('platform-accounts', { action: 'authorize', platform }); window.location.assign(result.url); }
    catch (e) { setError(e instanceof Error ? e.message : '授权失败'); setBusy(''); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (!creator || !form.consent || !form.privacy_level) return;
    const project = projects.find(item => item.id === form.project_id);
    if (!project || project.duration > creator.max_video_post_duration_sec) { setError('视频时长超出平台账号限制'); return; }
    setBusy('publish');
    requestKey.current ||= crypto.randomUUID();
    const original = receipt.current?.form || form;
    receipt.current ||= { request_key: requestKey.current, form: original };
    try { localStorage.setItem(`shopro:publish:${user?.id}`, JSON.stringify(receipt.current)); } catch {}
    try {
      await platformRequest('platform-publish', { action: 'create', request_key: requestKey.current,
        project_id: original.project_id, connection_id: original.connection_id, title: original.title,
        description: original.description, tags: original.tags.split(/[,，\s]+/).filter(Boolean),
        scheduled_at: original.scheduled_at ? new Date(original.scheduled_at).toISOString() : null,
        options: { privacy_level: original.privacy_level, consent: original.consent, disable_comment: original.disable_comment,
          disable_duet: original.disable_duet, disable_stitch: original.disable_stitch,
          brand_content_toggle: original.brand_content_toggle, brand_organic_toggle: original.brand_organic_toggle, is_aigc: original.is_aigc } });
      receipt.current = null; localStorage.removeItem(`shopro:publish:${user?.id}`);
      requestKey.current = null; setForm(previous => ({ ...previous, consent: false }));
      toast.success('发布任务已保存，平台完成后自动更新状态'); await load();
    } catch (e) {
      if (e instanceof EdgeRequestError && [400, 401, 403, 409].includes(e.status)) {
        receipt.current = null; requestKey.current = null; localStorage.removeItem(`shopro:publish:${user.id}`);
      }
      setError(e instanceof Error ? e.message : '发布请求结果待确认，请保留原参数重试');
    }
    finally { setBusy(''); }
  };
  const patch = (values: Partial<typeof form>) => {
    if (receipt.current) { toast.info('上一请求结果待确认，请保持原参数重试或刷新任务列表'); return; }
    setForm(previous => ({ ...previous, ...values }));
  };
  const project = projects.find(item => item.id === form.project_id);
  return <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <div className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold flex gap-2 items-center"><Globe className="h-5 w-5" />跨平台发布</h1><p className="text-sm text-muted-foreground mt-2">授权自己的账号，确认内容和可见范围后提交。发布进度在后台持续核对。</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button></div>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    <section className="grid gap-4 sm:grid-cols-2">{platforms.map(platform => <div key={platform.id} className="border border-border rounded-xl p-5 bg-card">
      <div className="flex justify-between gap-3"><h2 className="font-semibold">{platform.name}</h2><Button size="sm" disabled={!platform.enabled || !!busy} onClick={() => void authorize(platform.id)}>{platform.enabled ? '授权账号' : '待管理员配置'}</Button></div>
      <div className="space-y-2 mt-3">{connections.filter(connection => connection.platform === platform.id).map(connection => <div key={connection.id} className="flex justify-between text-sm items-center gap-2"><span>{connection.display_name} · {connection.status === 'active' ? '已连接' : '已断开'}</span><Button size="sm" variant="ghost" onClick={async () => { await platformRequest('platform-accounts', { action: 'disconnect', connection_id: connection.id }); await load(); }}>断开</Button></div>)}</div>
    </div>)}</section>
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-5 md:p-6 space-y-4">
      <h2 className="text-lg font-semibold">创建发布任务</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm space-y-2">成片<select required value={form.project_id} onChange={event => { const item = projects.find(p => p.id === event.target.value); patch({ project_id: event.target.value, title: item?.title || '' }); }} className="block w-full h-10 rounded-md border border-input bg-background px-3"><option value="">选择已完成作品</option>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label className="text-sm space-y-2">发布账号<select required value={form.connection_id} onChange={event => patch({ connection_id: event.target.value, privacy_level: '', consent: false })} className="block w-full h-10 rounded-md border border-input bg-background px-3"><option value="">选择已授权账号</option>{connections.filter(item => item.status === 'active').map(item => <option key={item.id} value={item.id}>{item.platform} · {item.display_name}</option>)}</select></label>
      </div>
      {project?.video_url && <video src={project.video_url} controls playsInline className="w-full max-h-64 rounded-lg bg-black" />}
      {creator && <p className="text-sm text-muted-foreground">发布到：{creator.display_name} · 最长 {creator.max_video_post_duration_sec} 秒</p>}
      <label className="block text-sm space-y-2">标题<Input required maxLength={150} value={form.title} onChange={event => patch({ title: event.target.value })} /></label>
      <label className="block text-sm space-y-2">简介<Textarea maxLength={1000} value={form.description} onChange={event => patch({ description: event.target.value })} /></label>
      <div className="grid gap-4 md:grid-cols-2"><label className="text-sm space-y-2">标签<Input value={form.tags} onChange={event => patch({ tags: event.target.value })} placeholder="逗号分隔，最多10个" /></label><label className="text-sm space-y-2">定时发布<Input type="datetime-local" value={form.scheduled_at} onChange={event => patch({ scheduled_at: event.target.value })} /></label></div>
      <label className="block text-sm space-y-2">可见范围<select required value={form.privacy_level} onChange={event => patch({ privacy_level: event.target.value })} className="w-full h-10 rounded-md border border-input bg-background px-3"><option value="">请选择</option>{creator?.privacy_level_options.map(value => <option key={value} value={value}>{privacyNames[value] || value}</option>)}</select></label>
      {creator?.platform === 'tiktok' && <div className="flex flex-wrap gap-4 text-sm">{(['disable_comment', 'disable_duet', 'disable_stitch', 'brand_content_toggle', 'brand_organic_toggle', 'is_aigc'] as const).map((field, index) => <label key={field} className="flex items-center gap-2"><input type="checkbox" checked={form[field]} disabled={(field === 'disable_comment' && creator?.comment_disabled) || (field === 'disable_duet' && creator?.duet_disabled) || (field === 'disable_stitch' && creator?.stitch_disabled)} onChange={event => patch({ [field]: event.target.checked })} />{['关闭评论', '关闭合拍', '关闭拼接', '付费合作推广', '推广自己的品牌', 'AI生成内容'][index]}</label>)}</div>}
      {creator?.platform === 'douyin' && <p className="text-sm text-muted-foreground">抖音评论、商业推广与 AI 内容标识请在平台按实际内容确认；此处只设置发布内容与可见范围。</p>}
      <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={form.consent} onChange={event => patch({ consent: event.target.checked })} className="mt-1" />我已预览当前视频并确认发布到所选账号，已确认音乐使用权和平台条款。</label>
      <Button type="submit" disabled={!!busy || !creator || !form.consent}><Send className="mr-2 h-4 w-4" />{busy === 'publish' ? '正在提交…' : '提交发布任务'}</Button>
    </form>
    <section><h2 className="text-lg font-semibold mb-3">发布记录</h2>{!tasks.length && <p className="py-8 text-muted-foreground text-sm">暂无发布任务。</p>}<div className="divide-y divide-border">{tasks.map(task => <div key={task.id} className="py-4 flex justify-between gap-4"><div className="min-w-0"><p className="font-medium truncate">{task.title} · {task.platform}</p><p className="text-sm text-muted-foreground mt-1">{statuses[task.status] || task.status}{task.scheduled_at ? ` · ${new Date(task.scheduled_at).toLocaleString()}` : ''}</p>{task.error_message && <p className="text-xs text-muted-foreground mt-2 break-words">{task.error_message}</p>}</div><div className="flex gap-2 shrink-0">{task.platform_url && <Button asChild size="sm" variant="outline"><a href={task.platform_url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-1" />查看</a></Button>}{['draft', 'scheduled'].includes(task.status) && <Button variant="ghost" size="sm" onClick={async () => { try { await platformRequest('platform-publish', { action: 'cancel', task_id: task.id }); await load(); } catch (e) { toast.error((e as Error).message); } }}>取消</Button>}</div></div>)}</div></section>
  </div>;
}
