// 隔离 UI 验收：真实表单、内存配置，无生产登录或网络写入。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ModelSettingsEditor } from '../../src/pages/ModelSettingsPage';
import { MODEL_SLOTS, defaultSettings, type ModelConfigView, type modelSettingsRequest } from '../../src/api/modelSettings';
import { Toaster } from '../../src/components/ui/sonner';
import '../../src/index.css';

const configs: ModelConfigView[] = MODEL_SLOTS.map(item => ({
  slot: item.id, settings: defaultSettings(item.id), enabled: false, version_id: null, has_key: false,
}));
const request = (async (body: Record<string, unknown>) => {
  if (body.action === 'list') return { configs: structuredClone(configs) };
  if (body.action === 'save') {
    const item = configs.find(config => config.slot === body.slot)!;
    if (body.enabled && !body.api_key && !item.has_key) throw new Error('启用前请填写 API Key');
    Object.assign(item, { settings: body.settings, enabled: body.enabled, version_id: crypto.randomUUID(),
      has_key: item.has_key || !!body.api_key });
    return { version_id: item.version_id };
  }
  if (body.action === 'test') return { ok: true, latency_ms: 12, message: '只读接口连接成功，模型权限需实际业务验收' };
  return { imported: [], skipped: [] };
}) as typeof modelSettingsRequest;
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <ModelSettingsEditor request={request} /><Toaster />
</React.StrictMode>);
