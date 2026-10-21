import { useEffect, useState } from 'react';
import { platformRequest, type PlatformApplication } from '@/api/platforms';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { backendUrl } from '@/lib/backendConfig';
import { toast } from 'sonner';

export default function PlatformAppSettings() {
  const [apps, setApps] = useState<PlatformApplication[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => {
    try {
      const result = await platformRequest<{ apps: PlatformApplication[] }>('platform-accounts', { action: 'apps' });
      setApps(result.apps); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '平台配置读取失败'); }
  };
  useEffect(() => { void load(); }, []);
  const patch = (platform: string, values: Partial<PlatformApplication>) => setApps(previous => previous.map(app => app.platform === platform ? { ...app, ...values } : app));
  const save = async (app: PlatformApplication) => {
    setBusy(app.platform);
    try {
      await platformRequest('platform-accounts', { action: 'save_app', ...app,
        redirect_uri: app.redirect_uri || `${backendUrl}/functions/v1/platform-oauth-callback`,
        client_secret: secrets[app.platform] || '' });
      setSecrets(previous => ({ ...previous, [app.platform]: '' }));
      toast.success('平台应用配置已保存'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(''); }
  };
  return <section className="mx-auto max-w-6xl px-4 pb-8 md:px-8">
    <h2 className="text-lg font-semibold mb-2">发布平台应用</h2>
    <p className="text-sm text-muted-foreground mb-5">配置官方开放平台应用后，用户在发布页授权自己的账号。账号令牌加密保存在服务端。</p>
    {error && <p role="alert" className="text-sm text-destructive mb-3">{error}</p>}
    <div className="grid gap-4 md:grid-cols-2">{apps.map(app => <form key={app.platform} onSubmit={event => { event.preventDefault(); void save(app); }} className="space-y-4 border border-border rounded-xl p-5 bg-card">
      <div className="flex justify-between items-center"><h3 className="font-medium">{app.platform === 'tiktok' ? 'TikTok' : '抖音'}</h3><label className="flex gap-2 text-sm items-center">启用<Switch checked={app.enabled} aria-label={`启用${app.platform}`} onCheckedChange={enabled => patch(app.platform, { enabled })} /></label></div>
      <label className="block space-y-2 text-sm">Client Key<Input required value={app.client_key} onChange={event => patch(app.platform, { client_key: event.target.value })} /></label>
      <label className="block space-y-2 text-sm">Client Secret · {app.has_secret ? '留空保留' : '尚未保存'}<Input type="password" autoComplete="new-password" value={secrets[app.platform] || ''} onChange={event => setSecrets(previous => ({ ...previous, [app.platform]: event.target.value }))} /></label>
      <label className="block space-y-2 text-sm">OAuth 回调地址<Input type="url" required value={app.redirect_uri || `${backendUrl}/functions/v1/platform-oauth-callback`} onChange={event => patch(app.platform, { redirect_uri: event.target.value })} /></label>
      <p className="text-xs text-muted-foreground break-all">申请权限：{app.scopes.join('、')}</p>
      <Button type="submit" disabled={!!busy}>{busy === app.platform ? '正在保存…' : '保存平台应用'}</Button>
    </form>)}</div>
  </section>;
}
