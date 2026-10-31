import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ServiceConfigEditor, { RetiredModels } from '@/components/ServiceConfigEditor';
import { configurationSlots, modelSettingsErrorMessage, modelSettingsRequest, type ModelCatalogEntry } from '@/api/modelSettings';

export function ModelSettingsEditor({ request = modelSettingsRequest }: { request?: typeof modelSettingsRequest }) {
  return <ServiceConfigEditor scope="models" request={request} />;
}

export default function ModelSettingsPage() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const admin = user?.app_metadata?.role === 'admin';
  useEffect(() => {
    if (admin) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    modelSettingsRequest<{ configs: ModelCatalogEntry[] }>({ action: 'catalog', scope: 'models' }, user?.id, controller.signal)
      .then(result => {
        if (!Array.isArray(result.configs)) throw new Error('模型目录响应不完整，请刷新重试。');
        const slots = configurationSlots('models');
        if (!controller.signal.aborted) setCatalog(result.configs.filter(item => slots.some(slot => slot.id === item.slot)));
      })
      .catch(e => { if (!controller.signal.aborted) setError(modelSettingsErrorMessage(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [admin, user?.id]);
  if (admin) return <ModelSettingsEditor key={user.id} />;
  return <div className="mx-auto max-w-4xl p-6 md:p-10">
    <h1 className="text-2xl font-semibold">模型接口</h1>
    <p className="text-muted-foreground mt-2 mb-6">平台管理员负责模型 API 配置。这里显示文本、向量与多模态模型的启用状态。</p>
    <RetiredModels />
    {loading && <p role="status" className="text-muted-foreground">正在读取模型目录…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="divide-y divide-border">{catalog.map(item => <div key={item.slot} className="flex justify-between gap-4 py-4">
      <span>{item.name}</span><span className={item.enabled ? 'text-success' : 'text-muted-foreground'}>{item.enabled ? '已启用' : '未启用'}</span>
    </div>)}</div>
  </div>;
}
