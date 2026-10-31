import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { configurationSlots, defaultSettings } from '../_shared/model-catalog.ts';
import { ConfigError, encryptKey, resolveModel, validateEndpoint, validateSettings } from '../_shared/model-registry.ts';
import { legacyModelConfigs } from '../_shared/model-env-import.ts';
import { imageCapabilities } from '../_shared/image-contract.ts';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { headers, status });
export async function handleModelSettings(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return reply({ error: '仅支持 POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return reply({ error: '请求格式不正确' }, 400);
    const db = createServiceClient();
    const admin = auth.user.app_metadata?.role === 'admin';
    if (body.scope !== undefined && !['models', 'integrations'].includes(body.scope)) {
      return reply({ error: '不支持的配置范围' }, 400);
    }
    const slots = configurationSlots(body.scope);
    if (body.action === 'catalog' || body.action === 'list') {
      if (body.action === 'list' && !admin) return reply({ error: '仅平台管理员可管理模型接口' }, 403);
      const { data, error } = await db.from('model_configs')
        .select('slot,enabled,current_version_id,updated_at,model_config_versions!model_current_version(settings,key_ciphertext)');
      if (error) throw new Error('读取失败');
      const configs = slots.map(definition => {
        const row = data?.find(item => item.slot === definition.id);
        const version = row?.model_config_versions as unknown as { settings: ReturnType<typeof defaultSettings>; key_ciphertext?: string } | null;
        if (body.action === 'catalog') return {
          slot: definition.id, name: version?.settings?.name || definition.name, category: definition.category,
          enabled: row?.enabled ?? false, provider: definition.category === 'video' ? definition.protocols[0] : undefined,
          ...(definition.category === 'image' ? { version_id: row?.current_version_id || null,
            image_capabilities: imageCapabilities(version?.settings) } : {}),
        };
        return { slot: definition.id, enabled: row?.enabled ?? false, version_id: row?.current_version_id || null,
          updated_at: row?.updated_at, has_key: !!version?.key_ciphertext, settings: version?.settings || defaultSettings(definition.id) };
      });
      return reply({ configs, admin });
    }
    if (!admin) return reply({ error: '仅平台管理员可管理模型接口' }, 403);
    if (['save', 'test'].includes(body.action) && body.scope !== undefined
      && !slots.some(item => item.id === body.slot)) return reply({ error: '配置项不属于当前设置范围' }, 400);
    if (body.action === 'save') {
      if (typeof body.enabled !== 'boolean' || (body.version_id !== null
        && (typeof body.version_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.version_id)))) {
        return reply({ error: '缺少配置版本或启用状态' }, 400);
      }
      const settings = await validateSettings(body.slot, body.settings, body.enabled);
      const replace = typeof body.api_key === 'string' && body.api_key.length > 0;
      const ciphertext = replace ? await encryptKey(body.slot, body.api_key.trim()) : null;
      const { data, error } = await db.rpc('save_model_config', {
        p_slot: body.slot, p_expected_version: body.version_id, p_settings: settings, p_enabled: body.enabled,
        p_key_ciphertext: ciphertext, p_actor: auth.user.id, p_replace_key: replace,
      });
      if (error) {
        if (error.message.includes('配置已被更新')) return reply({ error: '配置已被更新，请刷新后重试' }, 409);
        if (error.message.includes('API Key')) return reply({ error: '启用前请填写 API Key' }, 400);
        throw new Error('保存失败');
      }
      return reply({ version_id: data });
    }
    if (body.action === 'import') {
      const { data, error } = await db.from('model_configs').select('slot,current_version_id');
      if (error) throw new Error('读取失败');
      const imported: string[] = [], skipped: string[] = [];
      for (const entry of legacyModelConfigs()) {
        if (!slots.some(item => item.id === entry.slot)) continue;
        if (data?.some(item => item.slot === entry.slot && item.current_version_id)) { skipped.push(entry.slot); continue; }
        try {
          const settings = await validateSettings(entry.slot, entry.settings, true);
          const ciphertext = await encryptKey(entry.slot, entry.key);
          const result = await db.rpc('save_model_config', {
            p_slot: entry.slot, p_expected_version: null, p_settings: settings, p_enabled: true,
            p_key_ciphertext: ciphertext, p_actor: auth.user.id, p_replace_key: true,
          });
          if (result.error) throw new Error('导入失败');
          imported.push(entry.slot);
        } catch { skipped.push(entry.slot); }
      }
      return reply({ imported, skipped });
    }
    if (body.action === 'test') {
      const config = await resolveModel(body.slot, db);
      if (!config.settings.test_endpoint) return reply({
        error: '请配置供应商提供的只读健康检查或模型列表地址；测试不会发起生成任务',
      }, 400);
      await validateEndpoint(config.settings.test_endpoint);
      const started = Date.now();
      const response = await fetch(config.settings.test_endpoint, {
        method: 'GET', headers: config.headers, redirect: 'error', signal: AbortSignal.timeout(10000),
      }).catch(() => null);
      if (response?.body) await response.body.cancel().catch(() => {});
      return reply({ ok: !!response?.ok, status: response?.status || null, latency_ms: Date.now() - started,
        message: response?.ok ? `只读接口连接成功，${body.scope === 'integrations' ? '数据访问' : '模型'}权限需实际业务验收`
          : '只读接口连接失败，请核对地址和凭据' });
    }
    return reply({ error: '不支持的配置操作' }, 400);
  } catch (cause) {
    return reply({ error: cause instanceof ConfigError ? cause.message : '模型配置服务暂时不可用' },
      cause instanceof ConfigError ? 400 : 503);
  }
}
Deno.serve(handleModelSettings);
