import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlatformAppEditor } from '../../src/components/PlatformAppSettings';
import type { platformRequest, PlatformApplication } from '../../src/api/platforms';
import { Toaster } from '../../src/components/ui/sonner';
import '../../src/index.css';

const mode = new URLSearchParams(location.search).get('failure');
let reads = 0, writes = 0;
const apps: PlatformApplication[] = ['tiktok', 'douyin'].map(platform => ({
  platform, client_key: 'original-client', redirect_uri: 'https://ui-fixture.example/functions/v1/platform-oauth-callback',
  enabled: false, scopes: ['fixture-scope'], has_secret: true, updated_at: '2026-10-30T00:00:00Z',
}));
const request = (async (_endpoint: string, body: Record<string, unknown>) => {
  if (body.action === 'apps') {
    reads++;
    await new Promise(resolve => setTimeout(resolve, 100));
    if (mode === 'offline' || mode === 'recover' && reads <= 2) throw new Error('平台配置读取失败');
    return { apps: mode === 'empty' ? [] : structuredClone(apps) };
  }
  writes++;
  if (mode === 'save') throw new Error('保存失败');
  if (mode === 'conflict' && writes === 1) throw new Error('配置已被修改，请刷新');
  if (mode === 'receipt') return { ok: true };
  const app = apps.find(value => value.platform === body.platform)!;
  Object.assign(app, { client_key: body.client_key, enabled: body.enabled,
    updated_at: `2026-10-31T00:00:0${writes}Z`, has_secret: true });
  return { ok: true, app: structuredClone(app) };
}) as typeof platformRequest;
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <PlatformAppEditor request={request} /><Toaster />
</React.StrictMode>);
