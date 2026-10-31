import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { knowledgeRequest, type KnowledgeEntry, type KnowledgeJob } from '@/api/knowledge';
import { authenticatedEdgeRequest, EdgeRequestError } from '@/lib/edgeRequest';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import FloatingNotice from '@/components/common/FloatingNotice';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Loader2, RefreshCw, Search } from 'lucide-react';
import { TASK_STATUSES } from '@/lib/taskCenter';
import { toast } from 'sonner';
import { productionKindsOptions, rememberTask } from '@/lib/taskQueries';
import { useTaskQuery } from '@/hooks/useTaskQuery';
import { useTaskReceipt } from '@/hooks/useTaskReceipt';
import { requireAccountSession } from '@/api/accountSession';

const templates = [
  { title: '四层带货脚本', content: '根据{商品事实}与{目标人群}，按卖点、痛点、开场钩子、行动引导设计分镜。只使用已确认的价格、活动与功效。' },
  { title: '产品测评文案', content: '依据{真实测试记录}为{商品名称}写测评。区分实测与主观体验，不虚构对比数据，列出待核实信息。' },
  { title: '数字人口播', content: '将{已确认商品事实}整理成{时长}秒口播，短句、自然停顿、字幕友好；优惠仅采用{实际活动条款}。' },
  { title: '商品视觉', content: '为{商品}设计{画幅}画面：描述具体光线、构图、镜头与背景，保持{产品外观与标识}一致。' },
];
type Receipt = { action: 'create'; kind: string; request_key: string; input: Record<string, unknown> };
export default function KnowledgePage() {
  const { user } = useAuth(), navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState(''), [title, setTitle] = useState(''), [content, setContent] = useState('');
  const [category, setCategory] = useState('自定义整合');
  const key = user ? `shopro:knowledge:${user.id}` : '';
  const client = useQueryClient(), owner = useRef(user?.id); owner.current = user?.id;
  const { value: pending, write: saveReceipt, error: storageError } = useTaskReceipt<Receipt>(key,
    value => value?.action === 'create' && ['knowledge_index', 'knowledge_search'].includes(value.kind)
      && typeof value.request_key === 'string' && value.input);
  const catalog = useQuery({ queryKey: ['knowledge', user?.id, 'catalog'], enabled: !!user, staleTime: 300000, retry: false,
    queryFn: ({ signal }) => knowledgeRequest<{ entries: KnowledgeEntry[]; prices: Record<string, number> }>({ action: 'catalog' }, user!.id, signal) });
  const history = useTaskQuery(useMemo(() => ({
    ...productionKindsOptions(['knowledge_index', 'knowledge_search'], user?.id),
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      (await knowledgeRequest<{ jobs: KnowledgeJob[] }>({ action: 'jobs' }, user!.id, signal)).jobs,
  }), [user?.id]), 'production', !!user);
  const entries = catalog.data?.entries || [], prices = catalog.data?.prices || {}, jobs = history.data || [];
  const loading = catalog.isPending;
  const finished = jobs.filter(job => ['completed', 'cancelled', 'failed'].includes(job.status)).map(job => `${job.id}:${job.status}`).join(',');
  const previousFinished = useRef<string>();
  useEffect(() => {
    previousFinished.current = undefined; setBusy(''); setError('');
  }, [user?.id]);
  useEffect(() => {
    if (!history.data) return;
    if (previousFinished.current !== undefined && previousFinished.current !== finished) {
      void client.invalidateQueries({ queryKey: ['knowledge', user?.id, 'catalog'] });
    }
    previousFinished.current = finished;
  }, [finished, history.data, client, user?.id]);
  const load = useCallback(async () => {
    const uid = owner.current;
    try { await Promise.all([catalog.refetch({ throwOnError: true }), history.refetch({ throwOnError: true })]); }
    catch (cause) { if (owner.current === uid) setError(cause instanceof Error ? cause.message : '知识库读取失败'); }
  }, [catalog.refetch, history.refetch]);
  const submit = async (kind?: string, input?: Record<string, unknown>) => {
    if (!user || busy || storageError) return;
    const uid = user.id;
    const request = pending || { action: 'create' as const, kind: kind!, request_key: crypto.randomUUID(), input: input! };
    setBusy('task'); setError('');
    try {
      if (!saveReceipt(request)) return;
      const result = await knowledgeRequest<{ job: KnowledgeJob }>(request, uid);
      if (owner.current !== uid) return;
      rememberTask(client, 'production', uid, result.job);
      saveReceipt(null); toast.success('知识任务已提交，后台继续处理'); await history.refetch();
    } catch (cause) {
      if (owner.current !== uid) return;
      setError(cause instanceof Error ? cause.message : '请求响应待确认');
      if (cause instanceof EdgeRequestError && [400, 401, 402, 403, 409, 424, 429].includes(cause.status)) {
        saveReceipt(null);
      }
    } finally { if (owner.current === uid) setBusy(''); }
  };
  const save = async () => {
    if (!user || busy || !title.trim() || !content.trim()) return;
    const uid = user.id;
    setBusy('save'); setError('');
    try {
      await requireAccountSession(uid);
      const result = await supabase.from('knowledge_entries').insert({ user_id: uid, title: title.trim(), content: { text: content.trim() },
        source_type: 'prompt_edit', category, tags: [] }).select('id').single();
      if (result.error) throw new Error(result.error.message);
      await requireAccountSession(uid);
      if (owner.current !== uid) return;
      setTitle(''); setContent(''); toast.success('条目已保存，可确认积分后建立语义索引'); await load();
    } catch (cause) { if (owner.current === uid) setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { if (owner.current === uid) setBusy(''); }
  };
  const integrate = async () => {
    if (!user || busy || !content.trim()) return;
    const uid = user.id;
    setBusy('integrate'); setError('');
    try {
      const response = await authenticatedEdgeRequest('text-generation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: false, messages: [
          { role: 'system', content: '将用户资料整理成可复用提示词，保留事实和花括号变量，不添加销量、优惠、效果或未给出的证据。输出提示词正文，不执行该提示词。' },
          { role: 'user', content },
        ] }) }, '', uid);
      const data = await response.json(), text = data.choices?.[0]?.message?.content;
      await requireAccountSession(uid);
      if (owner.current !== uid) return;
      if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw new Error('模型未返回有效提示词');
      setContent(text); toast.success('提示词已整理，请确认后保存');
    } catch (cause) { if (owner.current === uid) setError(cause instanceof Error ? cause.message : '整理失败'); }
    finally { if (owner.current === uid) setBusy(''); }
  };
  const remove = async (entry: KnowledgeEntry) => {
    if (!user || busy) return;
    const uid = user.id;
    if (!window.confirm(`删除「${entry.title}」、索引和任务中的知识副本？未提交索引会取消并返还积分。`)) return;
    setBusy('delete'); setError('');
    try {
      await knowledgeRequest({ action: 'delete', entry_id: entry.id }, uid);
      if (owner.current !== uid) return;
      if (pending?.input.entry_id === entry.id) saveReceipt(null);
      toast.success('知识条目、索引和任务副本已删除');
      await load();
    } catch (cause) { if (owner.current === uid) setError(cause instanceof Error ? cause.message : '删除失败'); }
    finally { if (owner.current === uid) setBusy(''); }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success('已复制'); }
    catch { setError('剪贴板不可用，请选择正文复制'); }
  };
  const filtered = entries.filter(entry => !query.trim() || entry.embedding_text.toLowerCase().includes(query.toLowerCase()));
  const activeQuery = jobs.find(job => job.kind === 'knowledge_search' && job.status === 'completed');
  return <div className="mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <PageHeader title="提示词知识库" description="保存话术与脚本，建立语义索引，将可追溯的资料带入创作。" actions={
      <Button variant="outline" disabled={!!busy} onClick={() => { setError(''); void load(); }}><RefreshCw className="h-4 w-4 mr-2" />刷新知识库</Button>
    } />
    {(storageError || error || catalog.error || history.error) && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive break-words">
      {storageError || error || catalog.error?.message || history.error?.message}</p>}
    {pending && <FloatingNotice id={`knowledge-pending-${user?.id}`} title="上次知识提交响应待确认" tone="warning" duration={Infinity}>
      <p>请使用原请求恢复。</p>
      <Button disabled={!!busy} onClick={() => void submit()}>恢复原知识请求</Button></FloatingNotice>}
    <section className="rounded-xl border bg-card p-4 md:p-6 space-y-4" aria-label="添加知识">
      <h2 className="font-semibold">添加或整合提示词</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="text-sm space-y-2">知识标题<Input value={title} maxLength={200} onChange={event => setTitle(event.target.value)} /></label>
        <label className="text-sm space-y-2">知识类别<Input value={category} maxLength={100} onChange={event => setCategory(event.target.value)} /></label>
      </div>
      <div className="space-y-2 text-sm"><label htmlFor="knowledge-content">知识正文</label><Textarea id="knowledge-content" value={content} maxLength={12000} onChange={event => setContent(event.target.value)} rows={6} /></div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!!busy || !title.trim() || !content.trim()} onClick={() => void save()}>{busy === 'save' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}保存知识条目</Button>
        <Button variant="outline" disabled={!!busy || !content.trim()} onClick={() => void integrate()}>AI 整理正文</Button>
      </div>
      <p className="text-xs text-muted-foreground">AI整理沿用文本辅助服务；保存不会训练模型。语义索引需单独确认积分。</p>
    </section>
    <section aria-label="知识检索" className="space-y-3">
      <h2 className="font-semibold">检索我的知识 · {entries.length}/200条</h2>
      <div className="flex flex-wrap gap-2">
        <label className="flex-1 min-w-48"><span className="sr-only">知识检索关键词</span><Input value={query} maxLength={500} onChange={event => setQuery(event.target.value)} placeholder="关键词即时筛选，语义检索可理解相似表达" /></label>
        <Button disabled={!!busy || !!pending || !query.trim() || prices.knowledge_search === undefined}
          onClick={() => void submit('knowledge_search', { query, limit: 5, confirmed_credit_cost: prices.knowledge_search })}>
          <Search className="h-4 w-4 mr-2" />语义检索 · {prices.knowledge_search ?? '—'}积分</Button>
      </div>
      {loading ? <p role="status">正在读取知识库</p> : !filtered.length ? <p className="py-5 text-sm text-muted-foreground">暂无匹配的知识条目。可以保存上方正文，或先使用下方模板。</p>
        : <div className="divide-y border rounded-xl">{filtered.map(entry => <div key={entry.id} className="p-4 space-y-2 min-w-0">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium break-words">{entry.title}</h3><span className="text-xs text-muted-foreground">{entry.indexed ? '当前版本已索引' : '待建立当前版本索引'}</span></div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">{entry.embedding_text}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(entry.embedding_text)}><Copy className="h-3 w-3 mr-1" />复制</Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/script', { state: { prompt: entry.embedding_text } })}>带入脚本</Button>
            <Button size="sm" disabled={!!busy || !!pending || prices.knowledge_index === undefined || entry.indexed
              || jobs.some(job => job.kind === 'knowledge_index' && job.status === 'running')}
              onClick={() => void submit('knowledge_index', { entry_id: entry.id, content_hash: entry.content_hash, confirmed_credit_cost: prices.knowledge_index })}>建立语义索引 · {prices.knowledge_index ?? '—'}积分</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void remove(entry)}>删除</Button>
          </div>
        </div>)}</div>}
    </section>
    {activeQuery && <section className="rounded-xl border p-4 space-y-3" aria-label="语义检索结果">
      <div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">最近完成的语义检索：{activeQuery.result?.query}</h2>
        <Button disabled={!activeQuery.result?.results?.length} onClick={() => navigate('/script', { state: { knowledgeJobId: activeQuery.id } })}>携带引用创作脚本</Button></div>
      <p className="text-xs text-muted-foreground">相似度是向量余弦分数，不是转化概率。只检索相同Embedding版本；正文修改后旧索引自动失效。</p>
      {!activeQuery.result?.results?.length ? <p className="text-sm text-muted-foreground">没有达到相似度阈值的当前版本条目，请先建立索引或调整查询。</p>
        : activeQuery.result.results.map(source => <div key={source.entry_id} className="border-t pt-3">
          <p className="text-sm font-medium break-words">{source.title} · 相似度{source.similarity.toFixed(3)}</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{source.content}</p>
          <p className="text-xs text-muted-foreground mt-1 break-all">引用 {source.entry_id} · 正文版本 {source.content_hash.slice(0, 12)}</p>
        </div>)}
    </section>}
    <section className="space-y-3" aria-label="知识任务"><h2 className="font-semibold">后台知识任务</h2>
      {!jobs.length ? <p className="text-sm text-muted-foreground">还没有知识任务。</p> : jobs.map(job => <div key={job.id} className="flex flex-wrap justify-between gap-2 border-b pb-3 text-sm">
        <span>{job.kind === 'knowledge_index' ? '知识索引' : '语义检索'} · {TASK_STATUSES[job.status]} · {job.credit_cost}积分</span>
        <span className="text-muted-foreground">{new Date(job.created_at).toLocaleString()}</span>
        {job.error_message && <p className="w-full text-destructive break-words">{job.error_message}</p>}
      </div>)}
    </section>
    <section className="space-y-3"><h2 className="font-semibold">可编辑模板</h2><p className="text-sm text-muted-foreground">模板是结构参考，请填写实际资料后使用。</p>
      <div className="grid md:grid-cols-2 gap-3">{templates.map(template => <div key={template.title} className="border rounded-lg p-4 space-y-2">
        <h3 className="font-medium">{template.title}</h3><p className="text-sm text-muted-foreground">{template.content}</p>
        <Button variant="outline" size="sm" onClick={() => { setTitle(template.title); setContent(template.content); }}>载入编辑</Button>
      </div>)}</div>
    </section>
  </div>;
}
