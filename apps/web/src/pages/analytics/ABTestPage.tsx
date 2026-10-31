import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { EdgeRequestError } from '@/lib/edgeRequest';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import FloatingNotice from '@/components/common/FloatingNotice';
import { measurementRequest, numberText, percentText, type ContentExperiment, type ExperimentSpecification, type MeasurementSource, type MeasuredProject } from '@/api/measurements';
import { Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
const inputClass = 'w-full h-10 border rounded-md px-3 bg-background';
export default function ABTestPage() {
  const { user } = useAuth();
  const [experiments, setExperiments] = useState<ContentExperiment[]>([]), [sources, setSources] = useState<MeasurementSource[]>([]), [projects, setProjects] = useState<MeasuredProject[]>([]);
  const [admin, setAdmin] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [title, setTitle] = useState(''), [source, setSource] = useState(''), [metric, setMetric] = useState('ctr'), [sample, setSample] = useState(1000);
  const [endsAt, setEndsAt] = useState(''), [variants, setVariants] = useState(['', '']);
  const [pending, setPending] = useState<ExperimentSpecification | null>(null);
  const [sourceName, setSourceName] = useState(''), [reference, setReference] = useState(''), [secret, setSecret] = useState('');
  const receiptKey = user ? `shoproai:experiment-request:${user.id}` : '';
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const e = await measurementRequest<{ experiments: ContentExperiment[] }>({ action: 'experiments' }, signal);
      const s = await measurementRequest<{ sources: MeasurementSource[]; admin: boolean }>({ action: 'sources' }, signal);
      const p = await measurementRequest<{ projects: MeasuredProject[] }>({ action: 'projects' }, signal);
      setExperiments(e.experiments); setSources(s.sources); setAdmin(s.admin); setProjects(p.projects.filter(item => item.status === 'completed'));
      const sourceReceipt = localStorage.getItem(`${receiptKey}:source`);
      if (sourceReceipt && s.sources.some(item => item.id === sourceReceipt)) {
        localStorage.removeItem(`${receiptKey}:source`); setSecret(''); setSourceName(''); setReference('');
      }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '实验读取失败'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [user?.id, receiptKey]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setExperiments([]); setSources([]); setProjects([]); setPending(null);
    try {
      const saved = localStorage.getItem(receiptKey);
      if (saved) {
        const spec = JSON.parse(saved);
        if (typeof spec.request_key === 'string' && Array.isArray(spec.variants)) setPending(spec);
        else setError('实验回执格式不正确，请核对已创建实验');
      }
    } catch { setError('实验回执无法读取，请核对已创建实验'); }
    void load(controller.signal);
    return () => controller.abort();
  }, [user?.id, receiptKey, load]);
  const create = async (recovery?: ExperimentSpecification) => {
    if (!user) return;
    setBusy(true); setError('');
    try {
      const spec = recovery || { request_key: crypto.randomUUID(), source_id: source, title: title.trim(),
        primary_metric: metric, planned_sample: sample, ends_at: new Date(endsAt).toISOString(),
        variants: variants.map(id => ({ project_id: id, title: projects.find(p => p.id === id)?.title || '' })) };
      localStorage.setItem(receiptKey, JSON.stringify(spec)); setPending(spec);
      const result = await measurementRequest<{ experiment: ContentExperiment }>({ action: 'experiment-create', specification: spec });
      if (!result.experiment?.id) throw new Error('创建结果未确认，请恢复原请求');
      localStorage.removeItem(receiptKey); setPending(null); setTitle(''); toast.success('实验草稿已创建'); await load();
    } catch (cause) {
      // 首次请求得到明确参数/事务拒绝时允许修正；受理未知或恢复请求保留原回执。
      if (!recovery && cause instanceof EdgeRequestError && [400, 409].includes(cause.status)) {
        localStorage.removeItem(receiptKey); setPending(null);
      }
      setError(cause instanceof Error ? cause.message : '实验创建失败，请恢复原请求');
    }
    finally { setBusy(false); }
  };
  const transition = async (id: string, action: string) => {
    setBusy(true); setError('');
    try { await measurementRequest({ action, id }); await load(); toast.success('实验状态已更新'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '状态更新失败'); }
    finally { setBusy(false); }
  };
  const saveSource = async () => {
    setBusy(true); setError('');
    try {
      const storageKey = `${receiptKey}:source`, id = localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, id);
      await measurementRequest({ action: 'source-create', request_key: id, name: sourceName.trim(), authorization_reference: reference.trim(), secret });
      localStorage.removeItem(storageKey);
      setSecret(''); setSourceName(''); setReference(''); await load(); toast.success('授权数据源已登记');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '数据源保存失败'); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
    <PageHeader title="A/B 对照实验" description="固定实验目标和样本量，按匿名用户分组，接收授权服务的曝光、点击和转化。" actions={
      <Button variant="outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw className="h-4 w-4 mr-2" />刷新实验</Button>
    } />
    {error && <p role="alert" className="border border-destructive/30 p-4 rounded-lg text-sm text-destructive">{error}</p>}
    {pending ? <FloatingNotice id={`experiment-pending-${user?.id}`} title="实验创建回执待确认" tone="warning" duration={Infinity}>
      <p className="text-sm text-muted-foreground">「{pending.title}」提交后尚未确认。恢复将使用原请求，已创建的实验会直接返回。</p>
      <p className="text-xs text-muted-foreground break-all">请求：{pending.request_key}</p>
      <Button disabled={busy} onClick={() => void create(pending)}>恢复原实验请求</Button></FloatingNotice> :
      <form className="border rounded-xl p-5 space-y-4 bg-card" onSubmit={event => { event.preventDefault(); void create(); }}>
        <h2 className="font-semibold">新建实验</h2><div className="grid md:grid-cols-2 gap-4">
          <label className="text-sm space-y-2"><span className="block">实验名称</span><input aria-label="实验名称" className={inputClass} required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label className="text-sm space-y-2"><span className="block">授权数据源</span><select aria-label="授权数据源" className={inputClass} required value={source} onChange={event => setSource(event.target.value)}><option value="">请选择</option>{sources.filter(s => s.enabled).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="text-sm space-y-2"><span className="block">预设主指标</span><select aria-label="预设主指标" className={inputClass} value={metric} onChange={event => setMetric(event.target.value)}><option value="ctr">点击 / 曝光</option><option value="conversion_per_exposure">转化 / 曝光</option></select></label>
          <label className="text-sm space-y-2"><span className="block">每组最低曝光用户数</span><input aria-label="每组最低曝光用户数" className={inputClass} type="number" required min={100} max={1000000} step={1} value={sample} onChange={event => setSample(Number(event.target.value))} /></label>
          <label className="text-sm space-y-2"><span className="block">投放结束时间（本地时区）</span><input aria-label="投放结束时间" className={inputClass} type="datetime-local" required value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label>
        </div>
        <div className="grid md:grid-cols-2 gap-4">{variants.map((id, index) => <label key={`variant-${index}`} className="text-sm space-y-2"><span className="block">变体 {String.fromCharCode(65 + index)}{index === 0 ? '（对照）' : ''}</span>
          <select aria-label={`变体${String.fromCharCode(65 + index)}作品`} className={inputClass} required value={id} onChange={event => setVariants(values => values.map((value, i) => i === index ? event.target.value : value))}>
            <option value="">选择已完成作品</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>)}</div>
        <p className="text-sm text-muted-foreground">2至8个变体等比例分组，A为预设对照。启动后固定配置；窗口结束并等待24小时回流后才能结案。平台原生视频播放不会自动成为随机分流样本，采集服务需要调用实验分组接口并按分组展示内容。</p>
        <div className="flex flex-wrap gap-2">{variants.length < 8 && <Button type="button" variant="outline" disabled={busy} onClick={() => setVariants(values => [...values, ''])}><Plus className="h-4 w-4 mr-2" />增加变体</Button>}
          {variants.length > 2 && <Button type="button" variant="outline" disabled={busy} onClick={() => setVariants(values => values.slice(0, -1))}>移除末尾变体</Button>}
          <Button type="submit" disabled={busy || !sources.some(s => s.enabled) || projects.length === 0}>创建实验草稿</Button></div>
      </form>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取实验…</p> : !experiments.length ?
      <div className="border border-dashed rounded-xl p-8 text-sm text-muted-foreground">尚无新协议实验。旧变体记录保留为历史草稿，其计数不能作为本系统的随机实验样本。</div> :
      experiments.map(exp => <section key={exp.id} className="border rounded-xl bg-card p-5 space-y-4">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">{exp.title}</h2><p className="text-xs text-muted-foreground mt-2">
          {({ draft: '草稿', running: '采集中', closed: '已结案' })[exp.status]} · 主指标{exp.primary_metric === 'ctr' ? '点击/曝光' : '转化/曝光'} · 每组至少{exp.planned_sample}用户 · 结束{new Date(exp.ends_at).toLocaleString('zh-CN')}</p>
          <p className="text-xs text-muted-foreground mt-1 break-all">实验ID：{exp.id}</p></div>
          {exp.status === 'draft' && <Button disabled={busy} onClick={() => void transition(exp.id, 'experiment-start')}>启动实验</Button>}
          {exp.status !== 'closed' && <Button variant="outline" disabled={busy} onClick={() => void transition(exp.id, 'experiment-close')}>{exp.status === 'draft' ? '关闭草稿' : '结案并分析'}</Button>}</div>
        <p className="text-sm text-muted-foreground">{exp.inference_reason || '已满足预设窗口和样本条件。采用双尾比例检验，并对多变体比较做Holm校正（0.05）。'}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-sm"><thead><tr className="text-left border-b">{['变体', '分组', '曝光', '点击', '转化', 'CTR', 'CVR', '主指标95%区间', '相对提升', '校正p值', '结论'].map(label => <th key={label} className="p-2 whitespace-nowrap font-medium">{label}</th>)}</tr></thead>
          <tbody>{exp.variants.map(v => <tr key={v.id} className="border-b"><td className="p-2 min-w-40"><Link className="text-primary" to={`/analytics?projectId=${v.project_id}`}>{v.label} · {v.title}</Link></td>
            {[v.assigned, v.impressions, v.clicks, v.conversions].map((count, i) => <td key={`count-${i}`} className="p-2 tabular-nums">{numberText(count)}</td>)}
            <td className="p-2">{percentText(v.ctr)}</td><td className="p-2">{percentText(v.cvr)}</td><td className="p-2 whitespace-nowrap">{v.interval ? `${percentText(v.interval[0])} – ${percentText(v.interval[1])}` : '—'}</td>
            <td className="p-2">{v.uplift === null ? '—' : `${v.uplift > 0 ? '+' : ''}${percentText(v.uplift)}`}</td><td className="p-2">{v.adjusted_p_value === null ? '—' : v.adjusted_p_value.toPrecision(3)}</td>
            <td className="p-2 whitespace-nowrap">{v.label === 'A' ? '对照组' : v.recommended ? '观察到显著改善' : v.adjusted_p_value === null ? '暂不判断' : '未观察到显著改善'}</td></tr>)}</tbody></table></div>
        <p className="text-xs text-muted-foreground">一名匿名用户每个阶段最多计一次。CVR仅描述点击后转化，不作为主指标检验；区间是各组的Wilson区间。显著改善可用于新内容测试，自动训练或自动发布需独立策略与授权。</p>
      </section>)}
    <section className="border rounded-xl p-5 bg-card space-y-4"><h2 className="font-semibold">授权观测数据源</h2>
      {sources.map(s => <div key={s.id} className="border-t pt-3 space-y-2"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{s.name} · {s.enabled ? '已启用' : '已停用'}</p>
        {admin && s.enabled && <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try {
          await measurementRequest({ action: 'source-disable', id: s.id }); await load();
        } catch (cause) { setError(cause instanceof Error ? cause.message : '停用失败'); } finally { setBusy(false); } }}>停用数据源</Button>}</div>
        <p className="text-xs text-muted-foreground break-all">{s.id}</p><p className="text-sm text-muted-foreground">{s.authorization_reference}</p></div>)}
      {admin ? <form className="space-y-3 border-t pt-4" onSubmit={event => { event.preventDefault(); void saveSource(); }}>
        <p className="text-sm text-muted-foreground">登记已取得授权的广告、交易或实验采集服务。签名密钥仅在保存时提交，服务器加密保存；更换密钥需登记新数据源。</p>
        <label className="block text-sm space-y-1"><span className="block">数据源名称</span><input aria-label="数据源名称" required maxLength={100} className={inputClass} value={sourceName} onChange={event => setSourceName(event.target.value)} /></label>
        <label className="block text-sm space-y-1"><span className="block">授权依据</span><input aria-label="授权依据" required minLength={10} maxLength={1000} className={inputClass} value={reference} onChange={event => setReference(event.target.value)} /></label>
        <label className="block text-sm space-y-1"><span className="block">签名密钥（至少32字符）</span><input aria-label="签名密钥" autoComplete="new-password" type="password" required minLength={32} maxLength={256} className={inputClass} value={secret} onChange={event => setSecret(event.target.value)} /></label>
        <Button disabled={busy} type="submit">登记授权数据源</Button></form> : <p className="text-sm text-muted-foreground">数据源由平台管理员登记；普通账号不能手填计数或签名密钥来改变观测结果。</p>}
    </section>
  </div>;
}
