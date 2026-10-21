import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { createRenderExport, createProductionJob, productionRequest, listRenderExports, type RenderExport, type RenderExportRequest, ProductionJobError } from '@/api/productionJobs';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

const ratios = ['9:16', '16:9', '1:1', '4:3', '3:4', '4:5'];
const groupLabels = { completed: '全部完成', partial: '部分完成', failed: '导出失败', attention: '需要处理', processing: '后台处理中' };
const jobLabels = { pending: '排队中', running: '渲染中', completed: '已完成', failed: '失败', unknown: '需要处理', cancelled: '已取消' };
interface Project { id: string; title: string; duration: number }
export default function ExportFormatsPage() {
  const { user } = useAuth(), [params] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get('projectId') || '');
  const [selectedRatios, setSelectedRatios] = useState(['9:16']), [heights, setHeights] = useState([1080]);
  const [exports, setExports] = useState<RenderExport[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [pending, setPending] = useState<RenderExportRequest | null>(null);
  const [legacy, setLegacy] = useState<{ request_key: string; project_id: string; input: unknown } | null>(null);
  const lock = useRef(false);
  const currentUser = useRef(user?.id); currentUser.current = user?.id;
  const storageKey = user ? `shopro:exports:${user.id}` : '';
  const load = useCallback(async () => {
    if (!user) return;
    const [source, groups] = await Promise.all([
      supabase.from('video_projects').select('id,title,duration').eq('user_id', user.id).eq('status', 'completed')
        .order('created_at', { ascending: false }).limit(100),
      listRenderExports(),
    ]);
    if (currentUser.current !== user.id) return;
    if (source.error) throw new Error('作品读取失败，请刷新重试');
    setProjects(source.data || []); setExports(groups);
  }, [user?.id]);
  useEffect(() => {
    let stopped = false, polling = false;
    setPending(null); setLegacy(null); setProjects([]); setExports([]); setLoading(true);
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) setPending(JSON.parse(stored));
        const old = localStorage.getItem(`shopro:format:${user!.id}`);
        if (old) setLegacy(JSON.parse(old));
      } catch { setError('上次导出回执无法读取，请在导出记录核对结果'); }
    }
    const refresh = async () => {
      if (polling || stopped) return;
      polling = true;
      try { await load(); }
      catch (cause) { if (!stopped) setError(cause instanceof Error ? cause.message : '导出查询失败'); }
      finally { polling = false; if (!stopped) setLoading(false); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => { stopped = true; clearInterval(timer); };
  }, [load, storageKey]);
  const recoverLegacy = async () => {
    if (!legacy || !user || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      try { await productionRequest({ action: 'query', request_key: legacy.request_key }); }
      catch (cause) {
        if (!(cause instanceof ProductionJobError) || cause.status !== 404) throw cause;
        await createProductionJob('render', legacy.request_key, legacy.input, legacy.project_id);
      }
      localStorage.removeItem(`shopro:format:${user.id}`); setLegacy(null);
      toast.info('原单规格导出已恢复，可在任务中心查看进度');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '旧导出恢复失败，请保留原请求'); }
    finally { lock.current = false; setBusy(false); }
  };
  const submit = async () => {
    if (!user || lock.current) return;
    if (!pending && (!projectId || !selectedRatios.length || !heights.length)) return;
    lock.current = true; setBusy(true); setError('');
    let request = pending;
    try {
      if (!request) {
        request = { request_key: crypto.randomUUID(), source_project_id: projectId,
          formats: selectedRatios.flatMap(ratio => heights.map(height => ({ ratio, height }))) };
        // 写回执失败时不提交，避免失去幂等请求。
        localStorage.setItem(storageKey, JSON.stringify(request)); setPending(request);
      }
      const group = await createRenderExport(request);
      localStorage.removeItem(storageKey); setPending(null);
      setExports(previous => [group, ...previous.filter(item => item.id !== group.id)]);
      toast.info(`${group.total_count} 种规格已进入后台渲染队列`);
    } catch (cause) {
      if (cause instanceof ProductionJobError && [400, 401, 403, 409, 422, 429].includes(cause.status)) {
        localStorage.removeItem(storageKey); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : '导出提交结果待确认，请恢复原请求');
    } finally { lock.current = false; setBusy(false); }
  };
  const count = selectedRatios.length * heights.length;
  return <div className="mx-auto max-w-5xl p-4 md:p-8 space-y-6">
    <div className="flex flex-wrap justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">跨平台格式导出</h1><p className="text-sm text-muted-foreground mt-2">一次选择多种画幅和分辨率，后台生成独立 MP4 成片。</p></div>
      <Button asChild variant="outline"><Link to={`/publish${projectId ? `?projectId=${projectId}` : ''}`}>平台发布</Link></Button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive break-words">{error}</div>}
    {pending && <div role="status" className="rounded-lg border p-4 space-y-3">
      <p className="text-sm">上次导出结果待确认。恢复时使用原作品和规格，避免重复渲染。</p>
      <Button disabled={busy} onClick={() => void submit()}>{busy ? '正在恢复…' : '恢复上次导出'}</Button>
    </div>}
    {legacy && <div role="status" className="rounded-lg border p-4 space-y-3">
      <p className="text-sm">检测到升级前尚未确认的单规格导出。</p>
      <Button disabled={busy} onClick={() => void recoverLegacy()}>恢复旧版导出</Button>
    </div>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="border rounded-xl p-5 bg-card space-y-5">
      <div className="text-sm space-y-2"><label htmlFor="export-source" className="block">选择成片</label>
        <select id="export-source" required disabled={busy || !!pending || !!legacy || loading} className="w-full h-10 rounded-md border bg-background px-3" value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">{loading ? '正在加载作品…' : '请选择'}</option>
          {projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </div>
      {!loading && !projects.length && <p className="text-sm text-muted-foreground">暂无已完成作品。<Link className="underline" to="/video/create">先创建视频</Link></p>}
      <fieldset disabled={busy || !!pending || !!legacy} className="space-y-3"><legend className="text-sm font-medium mb-2">画幅（可多选）</legend>
        <div className="flex flex-wrap gap-3">{ratios.map(ratio => <label key={ratio} className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer">
          <input type="checkbox" checked={selectedRatios.includes(ratio)} onChange={event => setSelectedRatios(previous => event.target.checked ? [...previous, ratio] : previous.filter(item => item !== ratio))} />{ratio}
        </label>)}</div>
      </fieldset>
      <fieldset disabled={busy || !!pending || !!legacy} className="space-y-3"><legend className="text-sm font-medium mb-2">分辨率（可多选）</legend>
        <div className="flex flex-wrap gap-3">{[720, 1080, 2160].map(height => <label key={height} className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm cursor-pointer">
          <input type="checkbox" checked={heights.includes(height)} onChange={event => setHeights(previous => event.target.checked ? [...previous, height] : previous.filter(item => item !== height))} />{height === 2160 ? '4K' : `${height}p`}
        </label>)}</div>
        <p className="text-xs text-muted-foreground">分辨率按短边计算，画面等比缩放并补黑边，保留全部内容。</p>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !!pending || !!legacy || !projectId || !count || loading}>{busy && !pending ? '正在提交…' : `创建 ${count} 种规格导出`}</Button>
        <p className="text-sm text-muted-foreground">每种规格独立处理，关闭页面后仍继续。</p>
      </div>
    </form>
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">导出记录</h2>
      <Button variant="outline" size="sm" disabled={busy || loading} onClick={() => void load().then(() => setError('')).catch(cause => setError(cause.message))}>刷新记录</Button>
    </div>
    <p className="text-sm text-muted-foreground">升级前的单规格导出与其他剪辑任务可在<Link to="/task-queue" className="underline ml-1">任务中心</Link>查看。</p>
    {!loading && !exports.length && <p className="text-sm text-muted-foreground">暂无导出记录。</p>}
    <div className="space-y-5">{exports.map(group => <article key={group.id} className="border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium min-w-0 break-words">{group.title}</h3>
        <span className="text-sm text-muted-foreground">{groupLabels[group.status]} · {group.completed_count}/{group.total_count}</span></div>
      <Progress value={group.progress} aria-label={`${group.title} 导出进度`} />
      <div className="divide-y">{group.jobs.map(job => <div key={job.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-sm">{job.output_ratio} · {job.output_height === 2160 ? '4K' : `${job.output_height}p`} · {jobLabels[job.status]} · {job.progress}%</p>
          {job.error_message && <p className="text-sm text-destructive break-words mt-1">{job.error_message}</p>}</div>
        {job.status === 'completed' && job.result?.url && <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><a href={job.result.url} target="_blank" rel="noreferrer">下载 {job.output_ratio}</a></Button>
          {job.project_id && <Button asChild variant="outline" size="sm"><Link to={`/publish?projectId=${job.project_id}`}>发布成片</Link></Button>}
        </div>}
      </div>)}</div>
    </article>)}</div>
  </div>;
}
