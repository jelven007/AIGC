import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { createProductionJob, listProductionJobs, productionRequest, ProductionJobError, type ProductionJob } from '@/api/productionJobs';
import { Button } from '@/components/ui/button';
import { stableMedia } from '@/api/media';
import { toast } from 'sonner';
export default function ExportFormatsPage() {
  const { user } = useAuth(), [params] = useSearchParams();
  const [projects, setProjects] = useState<any[]>([]);
  const [projectId, setProjectId] = useState(params.get('projectId') || '');
  const [ratio, setRatio] = useState('9:16'), [height, setHeight] = useState(1080);
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const receipt = useRef<{ request_key: string; project_id: string; input: any } | null>(null);
  useEffect(() => {
    if (!user) return;
    try { receipt.current = JSON.parse(localStorage.getItem(`shopro:format:${user.id}`) || 'null'); } catch {}
    supabase.from('video_projects').select('id,title,video_url,duration').eq('user_id', user.id).eq('status', 'completed')
      .then(result => { if (result.error) setError(result.error.message); else setProjects(result.data || []); });
    const load = async () => {
      try {
        if (receipt.current) {
          const original = receipt.current;
          let found;
          try { found = (await productionRequest({ action: 'query', request_key: original.request_key })).job; }
          catch (cause) {
            if (!(cause instanceof ProductionJobError) || cause.status !== 404) throw cause;
            found = await createProductionJob('render', original.request_key, original.input, original.project_id);
          }
          if (found) { receipt.current = null; localStorage.removeItem(`shopro:format:${user.id}`); }
        }
        setJobs((await listProductionJobs()).filter(job => job.kind === 'render'));
      } catch (e) { setError(e instanceof Error ? e.message : '任务恢复失败'); }
    };
    void load(); const timer = setInterval(load, 10000); return () => clearInterval(timer);
  }, [user]);
  const submit = async () => {
    const project = projects.find(item => item.id === projectId);
    if (!project || !user) return;
    if (receipt.current) { setError('上一导出请求结果待确认，正在恢复原任务'); return; }
    setBusy(true);
    try {
      const source = await stableMedia(project.video_url, user.id);
      const output = await supabase.from('video_projects').insert({ user_id: user.id,
        title: `${project.title} ${ratio}`, status: 'draft', duration: project.duration }).select('id').single();
      if (output.error) throw new Error('导出作品创建失败');
      const original = { request_key: crypto.randomUUID(), project_id: output.data.id, input: { version: 1,
        title: `${project.title} ${ratio}`.slice(0, 80), duration: project.duration, ratio, height, fps: 30,
        tracks: [{ id: 'source', type: 'video', start: 0, duration: project.duration, url: source }] } };
      receipt.current = original;
      localStorage.setItem(`shopro:format:${user.id}`, JSON.stringify(original));
      const job = await createProductionJob('render', original.request_key, original.input, original.project_id);
      receipt.current = null; localStorage.removeItem(`shopro:format:${user.id}`);
      setJobs(previous => [job, ...previous]); toast.info('格式转换已进入后台渲染队列');
    } catch (e) { setError(e instanceof Error ? e.message : '导出失败'); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-5xl p-4 md:p-8 space-y-6">
    <div className="flex justify-between gap-4"><div><h1 className="text-2xl font-semibold">跨平台格式导出</h1><p className="text-sm text-muted-foreground mt-2">FFmpeg实际编码生成新成片，关闭页面后任务仍继续。</p></div><Button asChild variant="outline"><Link to={`/publish${projectId ? `?projectId=${projectId}` : ''}`}>平台发布</Link></Button></div>
    {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    <div className="border rounded-xl p-5 bg-card space-y-4">
      <label className="block text-sm space-y-2">选择成片<select className="w-full h-10 rounded-md border bg-background px-3" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">请选择</option>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="flex flex-wrap gap-4"><label className="text-sm">画幅<select className="ml-2 border rounded-md h-10 px-3 bg-background" value={ratio} onChange={event => setRatio(event.target.value)}>{['9:16', '16:9', '1:1', '4:3', '3:4'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-sm">分辨率<select className="ml-2 border rounded-md h-10 px-3 bg-background" value={height} onChange={event => setHeight(Number(event.target.value))}><option value={720}>720p</option><option value={1080}>1080p</option><option value={2160}>4K</option></select></label></div>
      <Button disabled={busy || !projectId} onClick={() => void submit()}>{busy ? '正在提交…' : '开始后台转码'}</Button>
    </div>
    <div className="divide-y">{jobs.map(job => <div key={job.id} className="py-4 flex justify-between gap-3"><div><p className="text-sm">{job.result?.resolution || '渲染任务'} · {job.status} · {job.progress}%</p>{job.error_message && <p className="text-sm text-muted-foreground">{job.error_message}</p>}</div>{job.result?.url && <Button asChild variant="outline" size="sm"><a href={job.result.url} target="_blank" rel="noreferrer">下载成片</a></Button>}</div>)}</div>
  </div>;
}
