import { useCallback, useEffect, useRef, useState } from 'react';
import { platformRequest, type PlatformApplication } from '@/api/platforms';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { backendUrl } from '@/lib/backendConfig';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const platforms = ['tiktok', 'douyin'];
const callback = `${backendUrl}/functions/v1/platform-oauth-callback`;
const defaults = (): PlatformApplication[] => platforms.map(platform => ({
  platform, client_key: '', redirect_uri: callback, scopes: [], enabled: false, has_secret: false, updated_at: null,
}));
function validApp(app: PlatformApplication) {
  return app && platforms.includes(app.platform) && typeof app.client_key === 'string'
    && typeof app.redirect_uri === 'string' && typeof app.enabled === 'boolean' && typeof app.has_secret === 'boolean'
    && Array.isArray(app.scopes) && app.scopes.every(scope => typeof scope === 'string')
    && (app.updated_at === null || typeof app.updated_at === 'string' && Number.isFinite(Date.parse(app.updated_at)));
}

export function PlatformAppEditor({ request = platformRequest }: { request?: typeof platformRequest }) {
  const [apps, setApps] = useState<PlatformApplication[]>(defaults);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const dirty = useRef(new Set<string>());
  const active = useRef(true);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const load = async () => {
    if (inFlight.current) return;
    const generation = ++sequence.current;
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true); setLoaded(false); setError('');
    try {
      const result = await request<{ apps: PlatformApplication[] }>('platform-accounts', { action: 'apps' }, undefined, controller.current.signal);
      if (!active.current || generation !== sequence.current) return;
      if (!Array.isArray(result.apps) || result.apps.some(app => !validApp(app))
        || new Set(result.apps.map(app => app.platform)).size !== result.apps.length) throw new Error('平台配置响应不完整，请重试加载');
      setApps(previous => defaults().map(base => {
        const saved = result.apps.find(app => app.platform === base.platform) || base;
        const draft = previous.find(app => app.platform === base.platform)!;
        return dirty.current.has(base.platform) ? { ...saved, client_key: draft.client_key,
          redirect_uri: draft.redirect_uri, enabled: draft.enabled } : saved;
      }));
      setLoaded(true);
    } catch (e) { if (active.current && generation === sequence.current) setError(e instanceof Error ? e.message : '平台配置读取失败'); }
    finally { if (active.current && generation === sequence.current) setLoading(false); }
  };
  useEffect(() => {
    active.current = true; void load();
    return () => { active.current = false; ++sequence.current; controller.current?.abort(); };
  }, [request]);
  const patch = (platform: string, values: Partial<PlatformApplication>) => {
    dirty.current.add(platform);
    setApps(previous => previous.map(app => app.platform === platform ? { ...app, ...values } : app));
  };
  const save = async (app: PlatformApplication) => {
    if (!loaded || loading || inFlight.current || !active.current) return;
    inFlight.current = true;
    setBusy(app.platform); setError('');
    try {
      const result = await request<{ ok: boolean; app: PlatformApplication }>('platform-accounts', { action: 'save_app', ...app,
        redirect_uri: app.redirect_uri || callback,
        client_secret: secrets[app.platform] || '' });
      if (!active.current) return;
      if (result.ok !== true || !validApp(result.app) || result.app.platform !== app.platform
        || !result.app.updated_at || result.app.updated_at === app.updated_at) throw new Error('服务端未返回新的保存版本，请重新加载核对');
      setApps(previous => previous.map(item => item.platform === app.platform ? result.app : item));
      dirty.current.delete(app.platform);
      setSecrets(previous => ({ ...previous, [app.platform]: '' }));
      toast.success('平台应用配置已保存');
    } catch (e) {
      if (active.current) { setLoaded(false); setError(e instanceof Error ? e.message : '保存失败'); }
    } finally { inFlight.current = false; if (active.current) setBusy(''); }
  };
  return <section className="platform-app-section px-4 pb-8">
    <h2 className="text-lg font-semibold mb-2">发布平台应用</h2>
    <p className="text-sm text-muted-foreground mb-5">配置官方开放平台应用后，用户在发布页授权自己的账号。账号令牌加密保存在服务端。</p>
    {error && <p role="alert" className="text-sm text-destructive mb-3">{error}</p>}
    <Button type="button" variant="outline" className="mb-4" disabled={!!busy || loading} onClick={() => void load()}>{loaded ? '刷新平台配置' : '重试加载'}</Button>
    {loading && <p role="status" className="text-sm text-muted-foreground mb-3">正在加载平台配置…</p>}
    {!loading && !loaded && <p className="text-sm text-muted-foreground mb-3">尚未读取服务端配置。可填写草稿，读取原版本后才能保存；草稿仅保留在当前页面。</p>}
    <div className="grid gap-4 md:grid-cols-2">{apps.map(app => <form key={app.platform} onSubmit={event => { event.preventDefault(); void save(app); }} className="space-y-4 border border-border rounded-xl p-5 bg-card">
      <fieldset disabled={!!busy} className="space-y-4">
      <div className="flex justify-between items-center"><h3 className="font-medium">{app.platform === 'tiktok' ? 'TikTok' : '抖音'}</h3><label className="flex gap-2 text-sm items-center">启用<Switch checked={app.enabled} disabled={!!busy} aria-label={`启用${app.platform}`} onCheckedChange={enabled => patch(app.platform, { enabled })} /></label></div>
      <label className="block space-y-2 text-sm">Client Key<Input required value={app.client_key} onChange={event => patch(app.platform, { client_key: event.target.value })} /></label>
      <label className="block space-y-2 text-sm">Client Secret · {!loaded ? '未读取' : app.has_secret ? '留空保留' : '尚未保存'}<Input type="password" autoComplete="new-password" maxLength={4096} value={secrets[app.platform] || ''} onChange={event => {
        dirty.current.add(app.platform); setSecrets(previous => ({ ...previous, [app.platform]: event.target.value }));
      }} /></label>
      <label className="block space-y-2 text-sm">OAuth 回调地址<Input type="url" required value={app.redirect_uri || `${backendUrl}/functions/v1/platform-oauth-callback`} onChange={event => patch(app.platform, { redirect_uri: event.target.value })} /></label>
      <p className="text-xs text-muted-foreground break-all">申请权限：{app.scopes.join('、')}</p>
      <Button type="submit" disabled={!!busy || loading || !loaded}>{busy === app.platform ? '正在保存…' : '保存平台应用'}</Button>
      </fieldset>
    </form>)}</div>
  </section>;
}
export default function PlatformAppSettings() {
  const { user } = useAuth();
  const request = useCallback<typeof platformRequest>((endpoint, body, _userId, signal) =>
    platformRequest(endpoint, body, user?.id, signal), [user?.id]);
  if (!user) return null;
  return <PlatformAppEditor key={user.id} request={request} />;
}
