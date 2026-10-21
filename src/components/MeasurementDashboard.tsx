import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { measurementRequest, numberText, percentText, moneyText, type MeasurementReport, type MeasuredProject } from '@/api/measurements';
import { platformRequest } from '@/api/platforms';
import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
import { Button } from '@/components/ui/button';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { toast } from 'sonner';

const naturalFields = ['view_count', 'like_count', 'comment_count', 'share_count'] as const;
const naturalLabels = ['播放量', '点赞', '评论', '分享'];
export default function MeasurementDashboard({ mode }: { mode: 'project' | 'report' | 'feedback' }) {
  const { user } = useAuth(), [params, setParams] = useSearchParams();
  const projectId = params.get('projectId') || '';
  const [days, setDays] = useState(30), [platform, setPlatform] = useState('all'), [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<MeasurementReport | null>(null), [projects, setProjects] = useState<MeasuredProject[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<Array<{ title: string; description: string; priority: string }>>([]);
  const [brief, setBrief] = useState(''), [advising, setAdvising] = useState(false);
  const [adviceCost, setAdviceCost] = useState<number | null>(null);
  const currentAdviceOwner = useRef('');
  currentAdviceOwner.current = `${user?.id}:${projectId}`;
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setAdviceCost(null);
    void measurementRequest<{ projects: MeasuredProject[] }>({ action: 'projects' }, controller.signal)
      .then(result => setProjects(result.projects)).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    if (mode === 'project') void measurementRequest<{ cost: number }>({ action: 'advice-price' }, controller.signal)
      .then(result => setAdviceCost(result.cost)).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [user?.id, mode, refresh]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoading(true); setReport(null); setError(''); setAdvice([]);
    void measurementRequest<{ report: MeasurementReport }>({ action: 'report', days, project_id: projectId || null }, controller.signal)
      .then(result => { setReport(result.report); }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.id, days, projectId, refresh]);
  const sync = async () => {
    setBusy(true);
    try { const result = await platformRequest<{ collected: number }>('platform-publish', { action: 'sync' });
      toast.info(`已更新 ${result.collected} 条官方视频指标`); setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '同步失败'); }
    finally { setBusy(false); }
  };
  const exportReport = async () => {
    if (!report) return;
    setBusy(true);
    try {
      const { utils, writeFile } = await import('xlsx'), workbook = utils.book_new();
      const sheet = (name: string, rows: unknown[]) => utils.book_append_sheet(workbook, utils.json_to_sheet(rows), name);
      sheet('作品明细', report.projects.map(p => ({ 标题: p.title, 状态: p.status, 风格: p.video_style, 时长秒: p.duration, 创建UTC: p.created_at })));
      sheet('官方累计视频指标', report.natural.map(m => ({ 标题: m.title, 平台: m.platform, 视频ID: m.video_id, 播放: m.view_count,
        点赞: m.like_count, 评论: m.comment_count, 分享: m.share_count, 发布时间UTC: m.published_at, 采集时间UTC: m.collected_at })));
      sheet('授权投放与交易', report.delivery.map(g => ({ 数据源: g.source_name, 币种: g.currency, 日期起: g.since, 日期止: g.until,
        曝光: g.impressions, 点击: g.clicks, 点击转化: g.conversions, CTR: g.ctr, CVR: g.cvr, 消耗最小货币单位: g.spend_minor,
        GMV最小货币单位: g.gmv_minor, 退款最小货币单位: g.refunds_minor, 净交易额最小货币单位: g.net_revenue_minor, ROAS: g.roas, 利润ROI: null })));
      sheet('口径', [{ 时间范围: `最近${days}天UTC`, 作品总数: report.project_count, 作品明细上限: 100, 视频明细上限: 500, 已采集视频数: report.natural_count, 生成时间: report.generated_at,
        自然指标: '发布时间在区间内视频的最后累计快照；非区间新增流量', 投放口径: '按数据源和币种分别汇总；缺失不填零',
        ROI: '未接商品成本和履约费用，利润ROI未知' }]);
      writeFile(workbook, `经营数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('观测报表已导出');
    } catch { toast.error('报表导出失败，请重试'); }
    finally { setBusy(false); }
  };
  const askAdvice = async () => {
    if (!projectId || !brief.trim() || adviceCost === null) return;
    const owner = currentAdviceOwner.current;
    setAdvising(true); setAdvice([]);
    try {
      const response = await authenticatedEdgeRequest('ai-assistant', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'analyze_traffic',
          project_id: projectId, creative_brief: brief.trim(), confirmed_credit_cost: adviceCost }) });
      const data = await response.json();
      if (data.code !== 0 || !Array.isArray(data.data?.suggestions)) throw new Error(data.message || '建议结果不完整');
      if (owner !== currentAdviceOwner.current) return;
      setAdvice(data.data.suggestions); toast.success('创意建议已生成，可带入剪辑和脚本测试');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '建议生成失败'); }
    finally { setAdvising(false); }
  };
  const natural = report?.natural.filter(item => platform === 'all' || item.platform === platform) || [];
  const title = mode === 'project' ? '作品表现与优化' : mode === 'report' ? '数据看板与报表' : '发布数据回流';
  return <div className="mx-auto max-w-7xl p-4 md:p-8 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" />{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">统一查看官方视频指标、授权投放和交易观测；数据缺失时显示「—」。</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="h-4 w-4 mr-2" />刷新报告</Button>
        <Button disabled={busy} onClick={() => void sync()}>同步官方数据</Button>
        {mode === 'report' && <Button variant="outline" disabled={!report || busy} onClick={() => void exportReport()}><Download className="h-4 w-4 mr-2" />导出 Excel</Button>}</div>
    </div>
    <div className="flex flex-wrap gap-4 items-end">
      <label className="text-sm space-y-1 min-w-0"><span className="block">作品（最近100个）</span>
        <select aria-label="选择作品" className="h-10 rounded-md border bg-background px-3 max-w-full w-64" value={projectId}
          onChange={event => { const next = new URLSearchParams(params); if (event.target.value) next.set('projectId', event.target.value); else next.delete('projectId'); setParams(next); }}>
          <option value="">全部作品</option>{projectId && !projects.some(p => p.id === projectId) && <option value={projectId}>当前作品</option>}
          {projects.map(p => <option key={p.id} value={p.id}>{p.title || '未命名作品'}</option>)}</select>
      </label>
      <label className="text-sm space-y-1"><span className="block">时间范围（UTC）</span><select aria-label="报告时间范围" value={days}
        onChange={event => setDays(Number(event.target.value))} className="h-10 rounded-md border bg-background px-3">
        {[7, 30, 90, 365].map(value => <option key={value} value={value}>最近{value}天</option>)}</select></label>
      <Button asChild variant="outline"><Link to="/publish">平台授权与发布</Link></Button><Button asChild variant="outline"><Link to="/ab-test">创建对照实验</Link></Button>
    </div>
    {error && <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</div>}
    {loading ? <p role="status" className="py-8 text-muted-foreground">正在读取观测报告…</p> : report && <>
      <div className="grid grid-cols-2 lg:grid-cols-6 border rounded-xl divide-x bg-card">
        {[{ label: '区间创建作品', value: numberText(report.project_count), note: `${report.completed_count}个当前已完成` },
          { label: '已采集视频', value: numberText(report.natural_count), note: '按账号和视频去重' },
          ...naturalFields.map((field, index) => ({ label: naturalLabels[index], value: numberText(report.natural_totals[field].value),
            note: `${report.natural_totals[field].observed}/${report.natural_totals[field].total}视频有该指标` }))].map(item =>
          <div key={item.label} className="p-4 min-w-0"><p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-2xl font-semibold tabular-nums my-2 break-all">{item.value}</p><p className="text-xs text-muted-foreground">{item.note}</p></div>)}
      </div>
      <p className="text-sm text-muted-foreground">概览汇总全部平台；自然指标统计发布时间在所选区间内的视频，取最后成功采集的累计快照，不能视作区间新增流量。
        {` 报告生成：${new Date(report.generated_at).toLocaleString('zh-CN')}。`}</p>
      {report.sync_issues.length > 0 && <div className="border rounded-lg p-4 text-sm space-y-2" role="status"><p className="font-medium">以下视频采集失败，保留最后成功结果</p>
        {report.sync_issues.map(issue => <p key={issue.id} className="text-muted-foreground break-words">{issue.platform} · {issue.title}：{issue.error}</p>)}</div>}
      {mode === 'report' && <div className="border rounded-xl p-5 bg-card"><h2 className="font-medium mb-4">作品创建趋势（UTC）</h2>
        {report.creation_trend.length ? <div className="h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={report.creation_trend}>
          <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
          <Line dataKey="created" name="创建" stroke="hsl(var(--primary))" /><Line dataKey="completed" name="当前已完成" stroke="hsl(var(--success))" />
        </LineChart></ResponsiveContainer></div> : <p className="text-sm text-muted-foreground">区间内没有创建作品。</p>}</div>}
      {mode === 'report' && <div className="grid md:grid-cols-2 gap-4">{[
        { title: '作品风格分布（最多50类）', data: report.style_distribution },
        { title: '作品时长分布', data: report.duration_distribution },
      ].map(chart => <div key={chart.title} className="border rounded-xl bg-card p-5"><h2 className="font-medium mb-4">{chart.title}</h2>
        {!chart.data?.length ? <p className="text-sm text-muted-foreground">暂无作品数据。</p> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart.data}>
          <XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="作品数" fill="hsl(var(--primary))" />
        </BarChart></ResponsiveContainer></div>}</div>)}</div>}
      <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">官方自然视频指标（最近500条明细）</h2>
        <label className="text-sm">筛选平台 <select aria-label="筛选平台" value={platform} onChange={event => setPlatform(event.target.value)} className="h-10 border rounded-md px-3 bg-background">
          <option value="all">全部</option><option value="douyin">抖音</option><option value="tiktok">TikTok</option></select></label></div>
        {!natural.length ? <div className="border border-dashed rounded-xl p-8 text-center text-sm text-muted-foreground">暂无官方采集结果。先授权平台并完成公开发布。</div> : <>
          <div className="h-56 border rounded-xl p-4 bg-card"><ResponsiveContainer width="100%" height="100%"><BarChart data={[...natural].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 10)}>
            <XAxis dataKey="title" tick={{ fontSize: 11 }} /><YAxis /><Tooltip /><Bar dataKey="view_count" name="累计播放" fill="hsl(var(--primary))" /></BarChart></ResponsiveContainer></div>
          <div className="overflow-x-auto border rounded-xl"><table className="w-full text-sm"><thead><tr className="bg-muted/40 text-left">{['作品 / 平台', ...naturalLabels, '最后采集'].map(label => <th key={label} className="p-3 whitespace-nowrap font-medium">{label}</th>)}</tr></thead>
            <tbody>{natural.map(item => <tr key={item.id} className="border-t"><td className="p-3"><Link className="text-primary" to={`/analytics?projectId=${item.project_id}`}>{item.title || '未命名作品'}</Link><p className="text-xs text-muted-foreground break-all">{item.platform} · {item.video_id}</p></td>
              {naturalFields.map(field => <td key={field} className="p-3 tabular-nums">{numberText(item[field])}</td>)}<td className="p-3 whitespace-nowrap text-xs">{new Date(item.collected_at).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>
        </>}
      </section>
      <section className="space-y-4"><h2 className="font-semibold">授权投放与交易数据</h2>
        <p className="text-sm text-muted-foreground">CTR＝点击/曝光，CVR＝转化/点击，ROAS＝扣退款后的交易额/投放消耗。按数据源和币种分别汇总，商品成本和履约费用未接入时利润 ROI 未知。</p>
        {!report.delivery.length ? <div className="border border-dashed rounded-xl p-8 text-sm text-muted-foreground">尚无授权广告或电商观测。管理员登记数据源后，由获授权的采集服务发送签名观测。<Link className="text-primary ml-2" to="/ab-test">管理数据源</Link></div> :
          report.delivery.map(group => <div key={`${group.source_id}:${group.currency}`} className="border rounded-xl p-5 space-y-4 bg-card">
            <div className="flex flex-wrap gap-2 justify-between"><h3 className="font-medium">{group.source_name} · {group.currency}</h3><p className="text-xs text-muted-foreground">{group.since} — {group.until} · {group.buckets}个观测批次</p></div>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">{[
              ['曝光', numberText(group.impressions)], ['点击', numberText(group.clicks)], ['CTR', percentText(group.ctr)], ['CVR', percentText(group.cvr)],
              ['转化', numberText(group.conversions)], ['投放消耗', moneyText(group.spend_minor, group.currency)], ['净交易额', moneyText(group.net_revenue_minor, group.currency)],
              ['ROAS', group.roas === null ? '—' : `${group.roas.toFixed(2)}倍`], ['每次转化成本', moneyText(group.cpa_minor, group.currency)], ['利润ROI', '—'],
            ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold text-lg mt-1 tabular-nums break-all">{value}</dd></div>)}</dl>
            <p className="text-xs text-muted-foreground">某字段有缺失时，该组汇总保持缺失。最后接收：{new Date(group.received_at).toLocaleString('zh-CN')}。</p>
          </div>)}
      </section>
      {mode === 'report' && <section className="space-y-3"><h2 className="font-semibold">作品明细（最近100个）</h2><div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-sm"><thead><tr className="text-left bg-muted/40">{['作品', '风格', '时长', '状态', '创建时间'].map(label => <th key={label} className="p-3 whitespace-nowrap">{label}</th>)}</tr></thead><tbody>
          {report.projects.map(p => <tr key={p.id} className="border-t"><td className="p-3">{p.title}</td><td className="p-3">{p.video_style || '—'}</td><td className="p-3">{p.duration == null ? '—' : `${p.duration}秒`}</td><td className="p-3">{p.status}</td><td className="p-3 whitespace-nowrap">{new Date(p.created_at).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div></section>}
    </>}
    {mode === 'project' && <section className="border rounded-xl p-5 space-y-4 bg-card"><h2 className="font-semibold">创意改进建议</h2>
      <p className="text-sm text-muted-foreground">选择作品并填写希望改进的内容。建议用于制作新版本和对照测试，效果需发布后验证。本次需{adviceCost === null ? '读取价格后确认' : `${adviceCost}积分`}。</p>
      <label className="block text-sm space-y-2">创意背景<textarea aria-label="创意背景" maxLength={3000} rows={4} value={brief} onChange={event => setBrief(event.target.value)}
        className="block w-full border rounded-lg p-3 bg-background" placeholder="说明商品事实、当前文案以及希望改进的部分…" /></label>
      <Button disabled={!projectId || !brief.trim() || adviceCost === null || advising} onClick={() => void askAdvice()}>{advising ? '正在生成建议…' : `生成创意建议${adviceCost === null ? '' : ` · ${adviceCost}积分`}`}</Button>
      {advice.map((item, index) => <div key={`${item.title}:${index}`} className="border-t pt-3"><h3 className="font-medium">{item.title}</h3><p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{item.description}</p></div>)}
      {advice.length > 0 && <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to={`/video/edit?importId=${projectId}`}>带入剪辑</Link></Button>
        <Button asChild variant="outline"><Link to="/script" state={{ prompt: advice.map(item => `${item.title}：${item.description}`).join('\n') }}>带入脚本</Link></Button></div>}
    </section>}
  </div>;
}
