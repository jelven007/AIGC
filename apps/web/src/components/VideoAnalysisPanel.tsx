import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { storedMedia } from '@/api/media';
import { canonicalMediaTree } from '@/lib/privateMedia';
import { createProductionJob, productionRequest, ProductionJobError, type ProductionJob } from '@/api/productionJobs';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import FloatingNotice from '@/components/common/FloatingNotice';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Loader2, RefreshCw } from 'lucide-react';
import { uploadAccountObject } from '@/api/accountSession';
import { taskListOptions, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';

type Receipt = { kind: 'analysis' | 'render'; request_key: string; input: Record<string, unknown> };
const statuses: Record<string, string> = { pending: '等待后台处理', running: '后台处理中', completed: '已完成',
  failed: '已失败', unknown: '模型结果待核对', cancelled: '已取消' };
const dimensions: Record<string, string> = { openingHook: '开场钩子', paceRhythm: '节奏设计', emotionCurve: '情绪表达',
  productShow: '商品展示', ctaStrength: '行动号召' };
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`;

export default function VideoAnalysisPanel({ mode }: { mode: 'live' | 'style' }) {
  const { user } = useAuth();
  const navigate = useNavigate(), location = useLocation();
  const reference = mode === 'style' && location.state?.competitor_reference;
  const linked = reference && typeof reference.sample_id === 'string' && typeof reference.item_id === 'string'
    ? { sample_id: reference.sample_id, item_id: reference.item_id } : null;
  const [rights, setRights] = useState(false);
  const [title, setTitle] = useState(''), [source, setSource] = useState(''), [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const scope = useRef(0), account = useRef(user?.id);
  account.current = user?.id;
  const key = user ? `shopro:analysis:${user.id}:${mode}` : '';
  const client = useQueryClient();
  const saved = useTaskReceipt<Receipt[]>(key, value => Array.isArray(value) && value.every(item =>
    item && ['analysis', 'render'].includes(item.kind) && typeof item.request_key === 'string' && item.input));
  const receipts = saved.value || [];
  const tasks = useTaskQuery(useMemo(() => taskListOptions('production', user?.id), [user?.id]), 'production', !!user);
  const price = useQuery({ queryKey: ['task-prices', user?.id, 'analysis'], enabled: !!user, retry: false, staleTime: 300000,
    queryFn: async ({ signal }): Promise<number> => (await productionRequest({ action: 'analysis-price' }, user?.id, signal)).cost });
  const jobs = (tasks.data || []).filter(job => ['analysis', 'render'].includes(job.kind)), cost = price.data ?? null;
  const problem = saved.error || error || tasks.error?.message || price.error?.message;
  const label = mode === 'live' ? '直播高光切片' : '爆款视频复刻';
  const refresh = async () => {
    if (!user) return;
    await tasks.refetch({ throwOnError: true });
  };
  useEffect(() => {
    scope.current++;
    setSelected({}); setError(''); setSource(''); setFilename(''); setTitle(''); setBusy(false);
    return () => { scope.current++; };
  }, [key]);
  useEffect(() => {
    setRights(false);
    if (mode === 'style' && location.state?.competitor_reference) setTitle(String(location.state.title || '').slice(0, 80));
  }, [location.key, key, mode]);
  const remember = (requests: Receipt[]) => saved.write(requests);
  const submit = async (requests: Receipt[]) => {
    if (!user || busy || saved.error) return;
    const revision = scope.current;
    const current = () => revision === scope.current && account.current === user.id;
    setBusy(true); setError('');
    let pending = requests;
    try {
      // 先保存整个批次；刷新后每个片段仍用原幂等标识恢复。
      if (!remember(pending)) return;
      for (const request of requests) {
        const job = await createProductionJob(request.kind, request.request_key, request.input, undefined, user.id);
        if (!current()) return;
        rememberTask(client, 'production', user.id, job);
        pending = pending.filter(item => item.request_key !== request.request_key);
        if (!remember(pending)) return;
      }
      await refresh();
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : '创建结果待确认，请恢复原请求');
      if (cause instanceof ProductionJobError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) {
        // 已明确拒绝的请求可重新编辑；之前成功创建的任务仍保留。
        remember([]); void refresh().catch(() => {});
      }
    } finally { if (current()) setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!user || !file || busy) return;
    const revision = scope.current;
    const current = () => revision === scope.current && account.current === user.id;
    if (!file.size || file.size > 100 * 1024 * 1024 || !file.type.startsWith('video/')
      || !/\.(mp4|mov|webm)$/i.test(file.name)) { setError('请选择不超过100MB的MP4、MOV或WebM视频'); return; }
    setBusy(true); setError('');
    try {
      const path = `${user.id}/analysis-inputs/${crypto.randomUUID()}.${file.name.split('.').pop()!.toLowerCase()}`;
      await uploadAccountObject(user.id, 'materials', path, file);
      if (!current()) return;
      setSource(storedMedia('materials', path)); setFilename(file.name);
      if (!title) setTitle(file.name.slice(0, 80));
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '视频上传失败'); }
    finally { if (current()) setBusy(false); }
  };
  const exportClips = (job: ProductionJob) => {
    const result = job.result;
    if (!result?.source_url) return;
    const requests: Receipt[] = (result.highlights || []).filter((_, index) => selected[`${job.id}:${index}`]).map((clip) => ({
      kind: 'render', request_key: crypto.randomUUID(), input: canonicalMediaTree({
        version: 1, title: clip.suggested_title.slice(0, 80), duration: clip.end_sec - clip.start_sec,
        ratio: '9:16', height: 720, fps: 30, transition: 'none',
        tracks: [{ id: 'source', type: 'video', start: 0, duration: clip.end_sec - clip.start_sec,
          sourceStart: clip.start_sec, url: result.source_url }],
      }),
    }));
    if (requests.length) void submit(requests);
  };
  const analyses = jobs.filter(job => job.kind === 'analysis' && job.mode === mode);
  return <div className="p-4 md:p-6 space-y-6 min-w-0">
    <PageHeader title={label} description="读取视频画面与音轨，在后台分析，完成结果可随时恢复。" actions={
      <Button variant="outline" disabled={busy || !user} onClick={() => void refresh().catch(cause => setError(cause.message))}>
        <RefreshCw className="w-4 h-4 mr-2" />刷新任务</Button>
    } />
    {problem && <p role="alert" className="text-sm text-destructive break-words">{problem}</p>}
    {!user && <p className="text-sm">请先<Link to="/login" className="underline ml-1">登录</Link>后上传素材。</p>}
    {receipts.length > 0 && <FloatingNotice id={`analysis-pending-${user?.id}-${mode}-${receipts.length}`}
      title={`有 ${receipts.length} 个分析请求结果待确认`} tone="warning" duration={Infinity}>
      <p className="text-sm">恢复时会核对原任务。</p>
      <Button disabled={busy} onClick={() => void submit(receipts)}>恢复原请求</Button>
    </FloatingNotice>}
    <form className="rounded-xl border bg-card p-4 md:p-5 space-y-4" onSubmit={event => {
      event.preventDefault();
      if (linked && !rights) return;
      void submit([{ kind: 'analysis', request_key: crypto.randomUUID(), input: { mode, title, source_url: source, confirmed_credit_cost: cost,
        ...(linked ? { competitor_reference: { ...linked, rights_confirmed: rights } } : {}) } }]);
    }}>
      <fieldset disabled={busy || !!receipts.length || !!saved.error || !user} className="space-y-4">
        {linked && <FloatingNotice id={`analysis-reference-${user?.id}-${linked.item_id}`}
          title={`已关联竞品统计参考：${String(location.state.title || linked.item_id)}`} duration={10000}>
          <p className="text-xs text-muted-foreground">请上传你有使用权的视频。分析会附上已采集的原平台统计；上传素材与原作品的关系由你确认。</p>
        </FloatingNotice>}
        {linked && <label className="flex gap-2 items-start text-sm"><input className="mt-1" type="checkbox" checked={rights}
          onChange={event => setRights(event.target.checked)} />我确认拥有上传素材的使用权</label>}
        <label className="block text-sm space-y-2">素材标题<Input aria-label="素材标题" value={title} maxLength={80} required onChange={event => setTitle(event.target.value)} /></label>
        <label className="block text-sm space-y-2">上传视频<Input aria-label="上传分析视频" type="file" accept="video/mp4,video/quicktime,video/webm"
          onChange={event => void upload(event.target.files?.[0])} />{filename && <span className="block text-xs text-muted-foreground break-all">已上传：{filename}</span>}</label>
        <p className="text-xs text-muted-foreground">支持最大100MB、10分钟的视频，较长直播请分段上传。{mode === 'live'
          ? '高光位置依据实际字幕时间戳；每个片段最长120秒。' : '均匀抽取8帧并分析转录，评分用于编辑建议。'}</p>
        <Button type="submit" disabled={busy || !!receipts.length || !source || !title.trim() || cost === null || !!linked && !rights}>
          {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}提交{label}任务</Button>
        <p className="text-sm text-muted-foreground">{cost === null ? '正在读取积分价格' : `本次预占 ${cost} 积分，确定失败自动返还。`}</p>
      </fieldset>
    </form>
    {!analyses.length && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">上传素材后提交分析，结果会显示在这里。</div>}
    {analyses.map(job => <article key={job.id} className="rounded-xl border p-4 md:p-5 space-y-4 min-w-0">
      <div className="flex justify-between flex-wrap gap-2 text-sm"><strong>{job.result?.report ? '风格分析结果' : '素材分析任务'}</strong>
        <span>{statuses[job.status]} · {job.credit_cost} 积分</span></div>
      {['pending', 'running'].includes(job.status) && <Progress value={job.progress} aria-label="后台任务进度" />}
      {job.error_message && <p className="text-sm text-destructive break-words">{job.error_message}</p>}
      {job.result && <><p className="text-xs text-muted-foreground">{job.result.score_basis}</p>
        {job.result.competitor_reference && <div className="border rounded-lg p-3 space-y-2 text-sm">
          <a href={job.result.competitor_reference.item.url} target="_blank" rel="noreferrer" className="text-primary underline break-words">
            竞品来源：{job.result.competitor_reference.item.title}</a>
          <p className="text-xs text-muted-foreground">{job.result.competitor_reference.source.name} · 观测 {
            new Date(job.result.competitor_reference.source.observed_at).toLocaleString('zh-CN')}</p>
          <p className="text-xs text-muted-foreground break-words">{job.result.competitor_reference.relationship}</p>
        </div>}
        <p className="text-sm leading-relaxed break-words">{job.result.transcript_summary || job.result.report?.analysis}</p>
        {job.result.report && <><dl className="grid sm:grid-cols-2 gap-3 text-sm">
          {Object.entries({ 节奏: job.result.report.rhythm, 镜头: job.result.report.pacing, 字幕: job.result.report.subtitle_summary,
            转场: job.result.report.transitions_summary, 色调: job.result.report.color_tone, 音乐: job.result.report.bgm_summary }).map(([name, value]) =>
            <div key={name} className="bg-muted/40 rounded-lg p-3"><dt className="text-muted-foreground">{name}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
          <div className="space-y-3">{Object.entries(job.result.report.dna_scores).map(([name, value]) => <div key={name}>
            <p className="flex justify-between text-xs mb-1"><span>{dimensions[name]}</span><span>{value}/100</span></p><Progress value={value} /></div>)}</div>
          <ul className="list-disc pl-5 text-sm space-y-2">{job.result.report.improvements.map(item => <li key={item}>{item}</li>)}</ul>
          <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => navigate('/script', { state: {
            prompt: `参考风格：${job.result?.report?.analysis}\n字幕：${job.result?.report?.subtitle_style}\n色调：${job.result?.report?.color_tone}`,
          } })}>按此风格创作脚本</Button><Button onClick={() => navigate('/video/create', { state: {
            prompt: `参考镜头与风格：${job.result?.report?.analysis}\n节奏：${job.result?.report?.rhythm}`,
          } })}>带入视频创作</Button></div></>}
        {job.result.highlights?.map((clip, index) => <label key={`${clip.start_sec}:${clip.end_sec}`} className="flex items-start gap-3 rounded-lg bg-muted/40 p-3">
          <input type="checkbox" aria-label={`选择片段${index + 1}`} checked={!!selected[`${job.id}:${index}`]} className="mt-1"
            onChange={event => setSelected(previous => ({ ...previous, [`${job.id}:${index}`]: event.target.checked }))} />
          <div className="space-y-1 min-w-0"><p className="text-sm font-medium break-words">{clip.title}</p>
            <p className="text-xs text-muted-foreground">{time(clip.start_sec)} — {time(clip.end_sec)} · 编辑评分 {clip.score}</p>
            <p className="text-sm break-words">{clip.transcript}</p><p className="text-xs text-muted-foreground break-words">{clip.reason}</p></div></label>)}
        {!!job.result.highlights?.length && <div className="space-y-2"><Button disabled={busy || !!receipts.length
          || !job.result.highlights.some((_, index) => selected[`${job.id}:${index}`])} onClick={() => exportClips(job)}>生成所选片段 MP4</Button>
          <p className="text-xs text-muted-foreground">每段创建独立渲染任务，输出720p竖屏，完成后保存到作品库。当前渲染免积分。</p></div>}
        <details className="text-xs text-muted-foreground break-all"><summary className="cursor-pointer">查看分析依据</summary>
          <p className="mt-2">源视频指纹：{job.result.source_hash}</p><p>抽帧时间：{job.result.evidence?.frame_times.join(', ')} 秒</p>
          <p>文本模型版本：{job.result.model_versions?.text}</p><p>ASR版本：{job.result.model_versions?.asr}</p></details>
      </>}
    </article>)}
    <Link to="/task-queue" className="inline-block text-sm underline">到任务中心查看分析与渲染进度</Link>
  </div>;
}
