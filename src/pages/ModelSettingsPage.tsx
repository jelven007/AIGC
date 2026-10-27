import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save, Settings2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { MODEL_SLOTS, RETIRED_MODELS, modelSettingsRequest, type ModelConfigView, type ModelCatalogEntry } from '@/api/modelSettings';
import { cn } from '@/lib/utils';
import PlatformAppSettings from '@/components/PlatformAppSettings';

const categories = [
  { id: 'text', label: '文本', description: '脚本、提示词优化、分析与翻译共用主备模型。' },
  { id: 'embedding', label: '知识检索', description: 'OpenAI兼容的Embeddings接口，浮点向量维度2–1536。更新后需按新版本重新建索引。' },
  { id: 'intelligence', label: '市场情报', description: 'YouTube用Google API Key；eBay用Base64编码的应用ID:应用密钥。其他平台需已获授权的数据商及intelligence-v1契约。' },
  { id: 'video', label: '视频', description: '选择供应商协议，提交与查询地址分别配置。' },
  { id: 'image', label: '图片', description: '绘图与封面共用此模型。GPT Image配置编辑地址后可使用参考图、扩图和局部重绘；其他协议以实际能力为准。' },
  { id: 'audio', label: '音频', description: '语音合成与识别分别设置模型和接口。' },
  { id: 'avatar', label: '数字人', description: '照片口播与视频口型同步使用独立供应商，音频需先上传或生成。' },
  { id: 'reader', label: '网页读取', description: '读取商品网页后交给文本模型提炼卖点。' },
];
function RetiredModels() {
  return <div className="text-sm text-muted-foreground border rounded-lg p-4 my-5">
    {RETIRED_MODELS.map(model => <p key={model.id}>{model.reason}
      <a href={model.source} target="_blank" rel="noreferrer" className="underline ml-2">查看官方退役说明（{model.retired_on}）</a>
    </p>)}
  </div>;
}
export function ModelSettingsEditor({ request = modelSettingsRequest }: { request?: typeof modelSettingsRequest }) {
  const [configs, setConfigs] = useState<ModelConfigView[]>([]);
  const [category, setCategory] = useState('text');
  const [slot, setSlot] = useState('text.primary');
  const [draft, setDraft] = useState<ModelConfigView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latency_ms: number } | null>(null);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await request<{ configs: ModelConfigView[] }>({ action: 'list' });
      setConfigs(result.configs); setDirty(false); setApiKey('');
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    setDraft(configs.find(item => item.slot === slot) || null); setApiKey(''); setDirty(false); setTestResult(null);
  }, [configs, slot]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const changeSlot = (value: string) => {
    if (dirty && !window.confirm('当前配置尚未保存，是否放弃修改？')) return;
    setSlot(value);
    setCategory(MODEL_SLOTS.find(item => item.id === value)?.category || 'text');
  };
  const patch = (key: string, value: string | number | boolean) => {
    if (!draft) return;
    setDraft({ ...draft, settings: { ...draft.settings, [key]: value } }); setDirty(true); setTestResult(null);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!draft) return;
    setBusy('save'); setError('');
    try {
      await request({ action: 'save', slot: draft.slot, enabled: draft.enabled,
        version_id: draft.version_id, settings: draft.settings, ...(apiKey ? { api_key: apiKey } : {}) });
      setApiKey(''); toast.success('配置已保存，新请求使用新版本'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(''); }
  };
  const test = async () => {
    setBusy('test'); setError('');
    try { setTestResult(await request({ action: 'test', slot })); }
    catch (e) { setError(e instanceof Error ? e.message : '连接失败'); }
    finally { setBusy(''); }
  };
  const importLegacy = async () => {
    if (dirty && !window.confirm('导入会刷新页面并放弃未保存修改，是否继续？')) return;
    setBusy('import'); setError('');
    try {
      const result = await request<{ imported: string[]; skipped: string[] }>({ action: 'import' });
      toast.info(`已导入 ${result.imported.length} 项，跳过 ${result.skipped.length} 项（已有配置或配置不完整）`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : '导入失败'); }
    finally { setBusy(''); }
  };
  const definition = MODEL_SLOTS.find(item => item.id === slot);
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10 text-foreground">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-primary mb-2"><Settings2 className="h-4 w-4" />平台设置</div>
          <h1 className="text-2xl font-semibold tracking-tight">模型接口</h1>
          <p className="text-sm text-muted-foreground mt-2">统一管理创作流程使用的模型、接口地址与凭据。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!!busy || loading || dirty} onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />刷新</Button>
          <Button variant="outline" disabled={!!busy || loading} onClick={() => void importLegacy()}>导入旧服务端配置</Button>
        </div>
      </div>
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex gap-3 mb-6 text-sm">
        <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
        <p className="text-muted-foreground">密钥加密保存在服务端。更新或禁用配置只影响新任务，已创建的视频任务继续使用原配置版本。</p>
      </div>
      <RetiredModels />
      {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm flex gap-2"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      {loading ? <div role="status" className="flex justify-center gap-2 py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />正在加载配置</div> : (
        <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="模型类别" className="grid grid-cols-2 gap-3 md:block md:space-y-5">
            {categories.map(group => <div key={group.id}>
              <h2 className="px-3 mb-2 text-xs font-medium text-muted-foreground">{group.label}</h2>
              {MODEL_SLOTS.filter(item => item.category === group.id).map(item => {
                const saved = configs.find(config => config.slot === item.id);
                return <button key={item.id} type="button" aria-current={slot === item.id ? 'page' : undefined}
                  onClick={() => changeSlot(item.id)} className={cn('w-full flex gap-2 items-center rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', slot === item.id && 'bg-primary/10 text-primary')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', saved?.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                  <span className="flex-1">{item.name}</span><span className="text-[10px] text-muted-foreground">{saved?.enabled ? '启用' : '关闭'}</span>
                </button>;
              })}
            </div>)}
          </nav>
          {draft && <form onSubmit={save} className="min-w-0 rounded-xl border border-border bg-card p-5 md:p-7 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-5 border-b border-border">
              <div><h2 className="text-lg font-semibold">{definition?.name}</h2><p className="text-sm mt-1 text-muted-foreground">{categories.find(item => item.id === category)?.description}</p></div>
              <label className="flex gap-2 items-center text-sm shrink-0">启用<Switch checked={draft.enabled} onCheckedChange={enabled => { setDraft({ ...draft, enabled }); setDirty(true); }} aria-label="启用模型" /></label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">显示名称<Input required value={draft.settings.name} onChange={event => patch('name', event.target.value)} maxLength={200} /></label>
              <label className="space-y-2 text-sm">接口协议<select value={draft.settings.protocol} onChange={event => patch('protocol', event.target.value)} className="flex w-full h-10 border border-input rounded-md bg-background px-3 text-sm">
                {definition?.protocols.map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
              </select></label>
            </div>
            {category === 'text' && <div className="rounded-lg border border-border p-4 space-y-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                支持图像审核
                <Switch checked={draft.settings.supports_vision === true}
                  onCheckedChange={value => patch('supports_vision', value)} aria-label="支持图像审核" />
              </label>
              <p className="text-xs text-muted-foreground">确认该模型已开通图片理解能力后启用。未启用时图片转待复核，文本审核仍可使用。</p>
            </div>}
            <label className="block space-y-2 text-sm">完整调用地址<Input type="url" required={draft.enabled} value={draft.settings.endpoint} onChange={event => patch('endpoint', event.target.value)} placeholder="https://供应商域名/v1/chat/completions" />
              <p className="text-xs text-muted-foreground">填写完整 HTTPS 接口路径。请选择与供应商文档一致的协议。</p></label>
            {slot === 'image.primary' && draft.settings.protocol === 'openai-images' && <label className="block space-y-2 text-sm">图片编辑地址（可选）
              <Input type="url" value={draft.settings.edit_endpoint || ''} onChange={event => patch('edit_endpoint', event.target.value)} placeholder="https://api.openai.com/v1/images/edits" />
              <p className="text-xs text-muted-foreground">仅已开通的GPT Image模型可用；生成地址需为同域的images/generations。留空时仅提供文本绘图。</p>
            </label>}
            {['video', 'avatar'].includes(category) && <label className="block space-y-2 text-sm">任务查询地址<Input type="url" required={draft.enabled} value={draft.settings.query_endpoint} onChange={event => patch('query_endpoint', event.target.value)} /><p className="text-xs text-muted-foreground">填写任务查询基础路径，服务端按协议追加任务 ID。</p></label>}
            {!['reader', 'intelligence'].includes(category) && <label className="block space-y-2 text-sm">模型 ID<Input required={draft.enabled && !['video.Kling', 'avatar.photo'].includes(slot)} value={draft.settings.model} onChange={event => patch('model', event.target.value)} placeholder="账号已开通的 Model ID 或 Endpoint ID" /></label>}
            {slot === 'audio.tts' && <label className="block space-y-2 text-sm">默认音色<Input value={draft.settings.voice} onChange={event => patch('voice', event.target.value)} /></label>}
            <label className="block space-y-2 text-sm">API Key <span className="text-xs text-muted-foreground">{draft.has_key ? '已保存 · 留空保留原密钥' : '尚未保存'}</span>
              <Input type="password" autoComplete="new-password" value={apiKey} onChange={event => { setApiKey(event.target.value); setDirty(true); }} placeholder={draft.has_key ? '输入新密钥可替换' : '输入供应商密钥'} maxLength={4096} /></label>
            <details className="rounded-lg border border-border p-4">
              <summary className="text-sm cursor-pointer">认证、超时与连接检查</summary>
              <div className="grid gap-4 sm:grid-cols-2 pt-4">
                <label className="space-y-2 text-sm">认证请求头<select className="w-full h-10 rounded-md border border-input bg-background px-3" value={draft.settings.auth_header} onChange={event => patch('auth_header', event.target.value)}>
                  {['Authorization', 'X-Gateway-Authorization', 'api-key', 'x-api-key', 'xi-api-key', 'x-goog-api-key'].map(value => <option key={value}>{value}</option>)}
                </select></label>
                <label className="space-y-2 text-sm">认证格式<select className="w-full h-10 rounded-md border border-input bg-background px-3" value={draft.settings.auth_scheme} onChange={event => patch('auth_scheme', event.target.value)}>
                  <option value="Bearer">Bearer + 密钥</option><option value="raw">仅密钥</option><option value="Basic">Basic + 已编码凭据</option>
                </select></label>
                <label className="space-y-2 text-sm">超时（秒）<Input type="number" min={1} max={['video', 'avatar', 'intelligence'].includes(category) ? 30 : 120} required value={draft.settings.timeout_ms / 1000} onChange={event => patch('timeout_ms', Number(event.target.value) * 1000)} /></label>
                <label className="space-y-2 text-sm">只读检查地址<Input type="url" value={draft.settings.test_endpoint} onChange={event => patch('test_endpoint', event.target.value)} placeholder="供应商模型列表或健康检查地址" /></label>
              </div>
              <p className="text-xs text-muted-foreground mt-3">连接检查使用已保存配置，仅发出 GET 请求。模型生成权限仍需业务验收。</p>
            </details>
            {testResult && <p role="status" className={cn('text-sm flex gap-2 items-center', testResult.ok ? 'text-emerald-600' : 'text-destructive')}><CheckCircle2 className="h-4 w-4" />{testResult.message} · {testResult.latency_ms}ms</p>}
            <div className="flex flex-wrap gap-3 items-center border-t border-border pt-5">
              <Button type="submit" disabled={!!busy || !dirty}>{busy === 'save' ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}保存配置</Button>
              <Button type="button" variant="outline" disabled={!!busy || dirty || !draft.enabled || !draft.version_id} onClick={() => void test()}>检查连接</Button>
              <span className="text-xs text-muted-foreground">{dirty ? '有未保存修改' : draft.version_id ? `版本 ${draft.version_id.slice(0, 8)}` : '尚未配置'}</span>
            </div>
          </form>}
        </div>
      )}
    </div>
  );
}
export default function ModelSettingsPage() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [error, setError] = useState('');
  const admin = user?.app_metadata?.role === 'admin';
  useEffect(() => {
    if (!admin) modelSettingsRequest<{ configs: ModelCatalogEntry[] }>({ action: 'catalog' })
      .then(result => setCatalog(result.configs)).catch(e => setError(e.message));
  }, [admin]);
  if (admin) return <><ModelSettingsEditor /><PlatformAppSettings /></>;
  return <div className="mx-auto max-w-4xl p-6 md:p-10">
    <h1 className="text-2xl font-semibold">模型接口</h1><p className="text-muted-foreground mt-2 mb-6">平台管理员负责接口配置。这里显示当前可用模型。</p>
    <RetiredModels />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="divide-y divide-border">{catalog.map(item => <div key={item.slot} className="flex justify-between py-4"><span>{item.name}</span><span className={item.enabled ? 'text-emerald-600' : 'text-muted-foreground'}>{item.enabled ? '已启用' : '未启用'}</span></div>)}</div>
  </div>;
}
