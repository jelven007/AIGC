import { useCallback, useEffect, useState } from 'react';
import { accessRequest } from '@/api/accessControl';
import { backendUrl } from '@/lib/backendConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Code2, Copy, Key, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ApiKey {
  id: string; name: string; key_prefix: string; scopes: string[]; rate_limit: number;
  is_active: boolean; total_calls: number; expires_at: string | null;
}
const permissions = [
  ['video:create', '创建视频'], ['video:read', '查看视频任务'], ['image:create', '生成图片'],
  ['render:create', '渲染成片'], ['jobs:read', '查看生产任务'], ['script:generate', '文本生成'],
  ['publish:create', '发布作品'], ['publish:read', '查看发布任务'], ['metrics:read', '读取平台指标'],
];
const examples = [
  { name: '创建视频 · video:create', endpoint: 'video-jobs', body: {
    action: 'create', request_key: '请替换为每次业务请求的UUID', provider: 'ArkSeedance',
    input: { prompt: '展示商品的外观和使用场景', title: '商品展示', duration: 5, ratio: '9:16', resolution: '720p' },
  } },
  { name: '任务查询 · video:read', endpoint: 'video-jobs', body: { action: 'query', request_key: '原请求UUID' } },
  { name: '生成图片 · image:create', endpoint: 'production-jobs', body: {
    action: 'create', request_key: '新UUID', kind: 'image', input: { prompt: '商品主图', size: '1024x1024' },
  } },
  { name: '文本生成 · script:generate', endpoint: 'text-generation', body: {
    messages: [{ role: 'user', content: '根据已确认的商品卖点编写视频脚本' }], stream: false,
  } },
  { name: '官方指标 · metrics:read', endpoint: 'platform-publish', body: { action: 'metrics' } },
];

export default function OpenAPIPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState(['video:create', 'video:read']);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState('');
  const [rawKey, setRawKey] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setKeys((await accessRequest('api-keys', { action: 'list' })).keys); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '密钥列表读取失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await accessRequest('api-keys', { action: 'create', name, scopes, expires_in_days: days });
      setKeys(previous => [result.key, ...previous]); setRawKey(result.raw_key); setName('');
      toast.success('密钥已创建，请保存');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '创建失败'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setRevoking(id);
    try {
      await accessRequest('api-keys', { action: 'revoke', key_id: id });
      setKeys(previous => previous.map(key => key.id === id ? { ...key, is_active: false } : key));
      toast.success('密钥已撤销');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '撤销失败'); }
    finally { setRevoking(''); }
  }
  return <div className="p-4 md:p-6 space-y-6">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div><h1 className="text-xl font-bold flex items-center gap-2"><Code2 className="w-5 h-5" />开放 API</h1>
        <p className="text-sm text-muted-foreground mt-1">按权限调用生产接口，任务与网页共用积分和状态。</p></div>
      <Button onClick={() => setOpen(true)}><Plus className="w-4 h-4 mr-2" />创建 Key</Button>
    </div>
    <p className="text-sm text-muted-foreground">每个 Key 每分钟最多 100 次请求。旧版密钥已停用，请重新创建。密钥只显示一次。</p>
    {error && <div role="alert" className="border border-destructive/40 rounded-xl p-4 flex gap-3 items-center">
      <p className="text-sm flex-1">{error}</p><Button variant="outline" onClick={load}>重试</Button></div>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取密钥…</p> : !error && !keys.length
      ? <div className="border rounded-xl p-10 text-center"><Key className="w-8 h-8 mx-auto mb-3" /><p>还没有 API Key</p></div>
      : <div className="space-y-3">{keys.map(key => {
        const active = key.is_active && (!key.expires_at || Date.parse(key.expires_at) > Date.now());
        return <div key={key.id} className="border rounded-xl p-4 flex gap-3 items-start">
          <div className="min-w-0 flex-1"><p className="font-medium break-words">{key.name} <span className="text-xs text-muted-foreground">{active ? '有效' : '已停用或过期'}</span></p>
            <code className="text-xs text-muted-foreground">{key.key_prefix}…</code>
            <p className="text-xs text-muted-foreground mt-2 break-words">{key.scopes.join(' · ')}</p>
            <p className="text-xs text-muted-foreground mt-1">{key.total_calls} 次鉴权通过 · {key.rate_limit} 次/分钟 · {key.expires_at ? `到期 ${new Date(key.expires_at).toLocaleDateString('zh-CN')}` : '长期有效'}</p>
          </div>
          {active && <Button variant="outline" size="sm" disabled={!!revoking} onClick={() => revoke(key.id)} aria-label={`撤销 ${key.name}`}>
            {revoking === key.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}</Button>}
        </div>;
      })}</div>}
    <div className="space-y-4"><h2 className="font-semibold">调用示例</h2>
      <p className="text-sm text-muted-foreground">在服务端发送 Authorization: Bearer YOUR_API_KEY；创建任务保留原 UUID，响应丢失后用它查询。模型需由管理员启用，发布需先授权账号。</p>
      {examples.map(example => <div key={example.name} className="border rounded-xl p-4 min-w-0">
        <p className="text-sm font-medium mb-2">{example.name}</p>
        <code className="text-xs break-all">POST {backendUrl}/functions/v1/{example.endpoint}</code>
        <pre className="text-xs bg-muted rounded-lg p-3 mt-2 overflow-x-auto">{JSON.stringify(example.body, null, 2)}</pre>
      </div>)}
    </div>
    <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (!value) setRawKey(''); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>创建 API Key</DialogTitle></DialogHeader>
        {rawKey ? <div className="space-y-4"><p className="text-sm">请立即保存，此密钥不会再次显示。</p>
          <Input value={rawKey} readOnly aria-label="新 API Key" className="font-mono text-xs" />
          <Button onClick={async () => { try { await navigator.clipboard.writeText(rawKey); toast.success('已复制'); } catch { toast.error('复制失败，请手动保存'); } }}><Copy className="w-4 h-4 mr-2" />复制密钥</Button>
        </div> : <div className="space-y-4">
          <label className="block text-sm">名称<Input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="生产服务" /></label>
          <label className="block text-sm">有效天数（1–365）<Input type="number" min={1} max={365} value={days} onChange={e => setDays(Number(e.target.value))} /></label>
          <fieldset className="grid grid-cols-2 gap-3"><legend className="text-sm mb-2">权限</legend>
            {permissions.map(([scope, label]) => <label key={scope} className="flex items-center gap-2 text-sm">
              <Checkbox checked={scopes.includes(scope)} onCheckedChange={checked => setScopes(previous => checked === true ? [...previous, scope] : previous.filter(item => item !== scope))} />{label}</label>)}</fieldset>
          <Button disabled={busy || !name.trim() || !scopes.length || !Number.isInteger(days) || days < 1 || days > 365} onClick={create} className="w-full">{busy ? '创建中…' : '生成密钥'}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}
