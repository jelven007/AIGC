import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { storedMedia } from '@/api/media';
import { createProductionJob, productionRequest, ProductionJobError } from '@/api/productionJobs';
import { canonicalMediaTree } from '@/lib/privateMedia';
import { Button } from '@/components/ui/button';
import FloatingNotice from '@/components/common/FloatingNotice';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw } from 'lucide-react';
import { uploadAccountObject } from '@/api/accountSession';
import { taskListOptions, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';

const kinds = { tts: '生成配音', asr: '识别音频', voice_clone: '克隆声纹', avatar: '照片口播', lipsync: '口型同步' };
type MediaKind = keyof typeof kinds;
type Receipt = { kind: MediaKind; request_key: string; input: Record<string, unknown> };
type Voice = { id: string; name: string; requires_verification: boolean; revoked_at?: string | null; provider_deleted_at?: string | null };
type Revocation = { voice_clone_id: string; request_key: string };
const statusLabels: Record<string, string> = { pending: '等待后台处理', running: '后台处理中', completed: '已完成',
  failed: '已失败', unknown: '原任务结果待核对', cancelled: '已取消' };
export default function MediaJobsPanel({ imageUrl = '' }: { imageUrl?: string }) {
  const { user } = useAuth();
  const location = useLocation();
  const [kind, setKind] = useState<MediaKind>('tts');
  const [text, setText] = useState(''), [voice, setVoice] = useState(''), [voiceClone, setVoiceClone] = useState('');
  const [name, setName] = useState(''), [consent, setConsent] = useState(false);
  const [media, setMedia] = useState<Record<string, string>>({}), [audioFilename, setAudioFilename] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const client = useQueryClient();
  const scope = useRef(0), account = useRef(user?.id);
  account.current = user?.id;
  const key = user ? `shopro:media-receipt:${user.id}` : '';
  const savedReceipt = useTaskReceipt<Receipt>(key, value => value && value.kind in kinds && typeof value.request_key === 'string' && value.input);
  const revoked = useTaskReceipt<Revocation>(key ? `${key}:revoke` : '',
    value => value && typeof value.voice_clone_id === 'string' && typeof value.request_key === 'string');
  const receipt = savedReceipt.value, revocation = revoked.value;
  const tasks = useTaskQuery(useMemo(() => taskListOptions('production', user?.id), [user?.id]), 'production', !!user);
  const voiceQuery = useTaskQuery(useMemo(() => ({ queryKey: ['tasks', user?.id, 'voices'],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Voice[]> =>
      (await productionRequest({ action: 'voices' }, user?.id, signal)).voices,
  }), [user?.id]), 'production', !!user);
  const prices = useQuery({ queryKey: ['task-prices', user?.id, 'media'], enabled: !!user, retry: false, staleTime: 300000,
    queryFn: async ({ signal }): Promise<Partial<Record<MediaKind, number>>> =>
      (await productionRequest({ action: 'media-prices' }, user?.id, signal)).costs });
  const jobs = (tasks.data || []).filter(job => job.kind in kinds), voices = voiceQuery.data || [], costs = prices.data || {};
  const problem = savedReceipt.error || revoked.error || error || tasks.error?.message || voiceQuery.error?.message || prices.error?.message;
  const refresh = async () => {
    if (!user) return;
    await Promise.all([tasks.refetch({ throwOnError: true }), voiceQuery.refetch({ throwOnError: true }), prices.refetch({ throwOnError: true })]);
  };
  useEffect(() => {
    scope.current++;
    setVoiceClone(''); setMedia({}); setText(''); setName(''); setConsent(false); setBusy(''); setError(''); setAudioFilename('');
    return () => { scope.current++; };
  }, [key]);
  useEffect(() => {
    if (voices.some(item => item.id === voiceClone && item.revoked_at)) setVoiceClone('');
  }, [voices, voiceClone]);
  useEffect(() => { if (imageUrl) { setMedia(prev => ({ ...prev, image_url: imageUrl })); setKind('avatar'); } }, [imageUrl, user?.id]);
  useEffect(() => {
    const input = location.state?.text;
    if (typeof input === 'string' && input.length <= 8000) { setText(input); setKind('tts'); }
  }, [location.state]);
  const upload = async (field: string, file?: File) => {
    if (!user || !file) return;
    const revision = scope.current;
    const current = () => revision === scope.current && account.current === user.id;
    const max = field === 'image_url' ? 5 : field === 'video_url' ? 80 : 20;
    const expected = field === 'image_url' ? 'image/' : field === 'video_url' ? 'video/' : 'audio/';
    if (!file.size || file.size > max * 1024 * 1024 || !file.type.startsWith(expected)) {
      setError(`请选择不超过${max}MB的${field === 'image_url' ? '图片' : field === 'video_url' ? '视频' : '音频'}`); return;
    }
    setBusy(field); setError('');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!extension || !/^(jpg|jpeg|png|webp|mp4|mov|wav|mp3|m4a|ogg|webm|flac)$/.test(extension)) throw new Error('文件格式不支持');
      const path = `${user.id}/media-inputs/${crypto.randomUUID()}.${extension}`;
      await uploadAccountObject(user.id, 'materials', path, file);
      if (!current()) return;
      setMedia(prev => ({ ...prev, [field]: storedMedia('materials', path) }));
      if (field === 'audio_url') setAudioFilename(`audio.${extension}`);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : '素材上传失败'); }
    finally { if (current()) setBusy(''); }
  };
  const submit = async (saved?: Receipt) => {
    if (!user) { setError('请先登录'); return; }
    if (busy || receipt && !saved || !saved && savedReceipt.error) return;
    const revision = scope.current;
    const current = () => revision === scope.current && account.current === user.id;
    setBusy('submit'); setError('');
    let request = saved;
    try {
      if (!request) {
        const input = kind === 'tts' ? { input: text, voice, ...(voiceClone ? { voice_clone_id: voiceClone } : {}) }
          : kind === 'asr' ? { audio_url: media.audio_url, filename: audioFilename }
            : kind === 'voice_clone' ? { name, audio_url: media.audio_url, filename: audioFilename, consent }
              : { title: name, audio_url: media.audio_url, consent,
                ...(kind === 'avatar' ? { image_url: media.image_url } : { video_url: media.video_url }) };
        request = { kind, request_key: crypto.randomUUID(), input: canonicalMediaTree({ ...input, confirmed_credit_cost: costs[kind] }) };
        // 在提交之前持久化，断网与刷新后继续使用同一请求。
        if (!savedReceipt.write(request)) return;
      }
      const job = await createProductionJob(request.kind, request.request_key, request.input, undefined, user.id);
      if (!current()) return;
      rememberTask(client, 'production', user.id, job);
      savedReceipt.write(null);
      void refresh().catch(cause => { if (current()) setError(cause.message); });
    } catch (cause) {
      if (!current()) return;
      setError(cause instanceof Error ? cause.message : '任务创建失败');
      if (cause instanceof ProductionJobError && [400, 401, 403, 402, 409, 424, 429].includes(cause.status)) {
        savedReceipt.write(null);
        if (cause.status === 409) void refresh().catch(refreshError => { if (current()) setError(refreshError.message); });
      }
    } finally { if (current()) setBusy(''); }
  };
  const revoke = async (item?: Voice) => {
    if (!user || busy) return;
    const revision = scope.current;
    const current = () => revision === scope.current && account.current === user.id;
    if (item && !window.confirm(`撤销「${item.name}」的声音授权？未提交配音会取消并返还积分，后台将删除供应商声纹。已生成文件继续保留。`)) return;
    const request = revocation || (item ? { voice_clone_id: item.id, request_key: crypto.randomUUID() } : null);
    if (!request) return;
    setBusy('revoke'); setError('');
    try {
      if (!revoked.write(request)) return;
      await productionRequest({ action: 'revoke-voice', ...request }, user.id);
      if (!current()) return;
      revoked.write(null);
      if (voiceClone === request.voice_clone_id) setVoiceClone('');
      await refresh();
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : '撤销响应待确认，请恢复原请求');
    } finally { if (current()) setBusy(''); }
  };
  const needsAudio = kind !== 'tts', needsVisual = kind === 'avatar' || kind === 'lipsync';
  const ready = kind === 'tts' ? text.trim() : media.audio_url && audioFilename && (kind === 'asr'
    || consent && name.trim() && (!needsVisual || media[kind === 'avatar' ? 'image_url' : 'video_url']));
  return <section id="media-jobs" aria-labelledby="media-jobs-title" className="border rounded-xl p-4 md:p-6 mx-4 md:mx-6 my-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-3">
      <div><h2 id="media-jobs-title" className="font-semibold text-lg">语音与数字人工作台</h2>
        <p className="text-sm text-muted-foreground mt-1">任务提交后在后台继续执行，完成结果保存到私有素材与作品库。</p></div>
      <Button variant="outline" disabled={!!busy} onClick={() => { void refresh().catch(cause => setError(cause.message)); }}>
        <RefreshCw className="w-4 h-4 mr-2" />刷新任务</Button>
    </div>
    {problem && <p role="alert" className="text-sm text-destructive break-words">{problem}</p>}
    {receipt && <FloatingNotice id={`media-pending-${user?.id}`} title="上次媒体任务提交结果尚未确认" tone="warning" duration={Infinity}>
      <p>恢复时会核对原请求。</p>
      <Button disabled={!!busy} onClick={() => void submit(receipt)}>恢复原媒体任务</Button>
    </FloatingNotice>}
    {revocation && <FloatingNotice id={`voice-revocation-${user?.id}`} title="声纹撤销响应待确认" tone="warning" duration={Infinity}>
      <p>恢复时会核对同一声纹。</p>
      <Button disabled={!!busy} onClick={() => void revoke()}>恢复原声纹撤销</Button>
    </FloatingNotice>}
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4">
      <fieldset disabled={!!busy || !!receipt || !!savedReceipt.error} className="space-y-4">
        <label className="block text-sm space-y-2">任务类型<select aria-label="媒体任务类型" value={kind}
          onChange={event => setKind(event.target.value as MediaKind)} className="h-10 rounded-md border bg-background px-3 w-full">
          {Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        {kind === 'tts' ? <>
          <label className="block text-sm space-y-2">配音文本<Textarea aria-label="配音文本" value={text} onChange={event => setText(event.target.value)} required maxLength={8000} rows={3} /></label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm space-y-2">供应商音色ID<Input value={voice} onChange={event => setVoice(event.target.value)} placeholder="留空使用管理员默认音色" maxLength={200} disabled={!!voiceClone} /></label>
            <label className="block text-sm space-y-2">克隆声纹<select aria-label="克隆声纹" value={voiceClone} onChange={event => setVoiceClone(event.target.value)}
              className="h-10 rounded-md border bg-background px-3 w-full"><option value="">使用普通音色</option>
              {voices.filter(item => !item.revoked_at).map(item => <option key={item.id} value={item.id} disabled={item.requires_verification}>
                {item.name}{item.requires_verification ? '（需供应商验证）' : ''}</option>)}</select></label>
          </div>
        </> : <>
          {kind !== 'asr' && <label className="block text-sm space-y-2">{kind === 'voice_clone' ? '声纹名称' : '作品名称'}
            <Input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label>}
          {needsAudio && <label className="block text-sm space-y-2">上传音频（最大20MB）<Input type="file" aria-label="上传口播音频"
            accept="audio/*" onChange={event => void upload('audio_url', event.target.files?.[0])} />
            {media.audio_url && <span className="text-xs text-muted-foreground">音频已上传</span>}</label>}
          {needsVisual && <label className="block text-sm space-y-2">{kind === 'avatar' ? '上传人物照片（最大5MB）' : '上传人物视频（最大80MB）'}
            <Input type="file" aria-label="上传人物素材" accept={kind === 'avatar' ? 'image/png,image/jpeg' : 'video/mp4'}
              onChange={event => void upload(kind === 'avatar' ? 'image_url' : 'video_url', event.target.files?.[0])} />
            {media[kind === 'avatar' ? 'image_url' : 'video_url'] && <span className="text-xs text-muted-foreground">人物素材已选择</span>}</label>}
          {kind !== 'asr' && <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={consent}
            onChange={event => setConsent(event.target.checked)} required className="mt-1" />我已取得声音及人物形象的使用授权。</label>}
        </>}
      </fieldset>
      <div className="flex flex-wrap gap-3 items-center">
        <Button type="submit" disabled={!!busy || !!receipt || !!savedReceipt.error || !ready || !Number.isInteger(costs[kind])}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}提交{kinds[kind]}任务</Button>
        <span className="text-sm text-muted-foreground">{Number.isInteger(costs[kind]) ? `本次预占 ${costs[kind]} 积分，确定失败自动返还` : '正在读取积分价格'}</span>
        <Link to="/credits" className="text-sm underline text-muted-foreground">查看积分计费</Link>
      </div>
    </form>
    {!!voices.length && <section aria-label="我的声纹" className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">我的声纹</h3>
      <p className="text-xs text-muted-foreground">撤销后停止新配音。供应商受理结果未知的原任务需先核对，删除状态将在后台更新。</p>
      {voices.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="min-w-0"><p className="break-words">{item.name}</p><p className="text-xs text-muted-foreground">
          {item.provider_deleted_at ? '已撤销 · 供应商声纹已删除' : item.revoked_at ? '已撤销 · 供应商删除待确认'
            : item.requires_verification ? '需供应商验证' : '可用于配音'}</p></div>
        {!item.revoked_at && <Button size="sm" variant="outline" disabled={!!busy || !!revocation}
          onClick={() => void revoke(item)}>撤销「{item.name}」</Button>}
      </div>)}
    </section>}
    <div aria-live="polite" className="space-y-3">
      {jobs.map(job => <article key={job.id} className="border-t pt-3 space-y-2 min-w-0">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{kinds[job.kind as MediaKind]} · {job.id.slice(0, 8)}</span>
          <span>{statusLabels[job.status]} · {job.credit_cost}积分{['failed', 'cancelled'].includes(job.status) ? '已返还' : job.status === 'completed' ? '已结算' : '预占'}</span></div>
        {job.error_message && <p className="text-sm text-destructive break-words">{job.error_message}</p>}
        {job.status === 'completed' && job.result?.url && <div className="flex flex-wrap gap-3 items-center">
          {job.kind === 'tts' && <audio controls src={job.result.url} className="max-w-full" preload="none" />}
          <a href={job.result.url} target="_blank" rel="noreferrer" className="text-sm underline">下载生成文件</a>
          {job.project_id && <Link to={`/video/edit?importId=${job.project_id}`} className="text-sm underline">剪辑成片</Link>}
        </div>}
        {job.result?.media_deleted && <p className="text-sm text-muted-foreground">生成文件已删除，任务计费回执继续保留。</p>}
        {job.result?.text && <Textarea value={job.result.text} readOnly aria-label="语音识别结果" rows={4} />}
        {job.result?.voice_clone_id && <p className="text-sm">{voices.some(item => item.id === job.result?.voice_clone_id && item.revoked_at)
          ? '此声纹已撤销。' : job.result.requires_verification ? '声纹已创建，请在供应商控制台完成验证后由管理员核对。' : '声纹已创建，可在配音任务中选择。'}</p>}
      </article>)}
      {!jobs.length && <p className="text-sm text-muted-foreground">暂无媒体任务。启用相应模型后即可提交。</p>}
    </div>
  </section>;
}
