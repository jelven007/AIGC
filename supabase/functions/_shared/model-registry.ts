import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createServiceClient } from './auth.ts';
import { MODEL_SLOTS, defaultSettings, type ModelSettings } from './model-catalog.ts';
import { GPT_IMAGE_EDIT_MODELS } from './image-contract.ts';

export class ConfigError extends Error {}
export function publicHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConfigError('接口地址格式不正确'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || host === 'localhost' || !host.includes('.')
    || /\.(localhost|local|internal|lan|home|test)$/.test(host) || !publicAddressOrHostname(host)) {
    throw new ConfigError('接口必须是无凭据、无查询参数的公网 HTTPS 地址');
  }
  return url;
}
function publicAddressOrHostname(host: string): boolean {
  if (host.includes(':')) return /^[23][0-9a-f]{3}:/.test(host); // 仅全球单播 IPv6
  if (!/^[\d.]+$/.test(host)) return true;
  const [a, b] = host.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b))
    || (a === 198 && [18, 19].includes(b)));
}
export async function validateEndpoint(value: string): Promise<string> {
  const url = publicHttpsUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!/^[\d.]+$/.test(host) && !host.includes(':')) {
    const addresses = (await Promise.all([
      Deno.resolveDns(host, 'A').catch(() => []),
      Deno.resolveDns(host, 'AAAA').catch(() => []),
    ])).flat();
    if (!addresses.length || addresses.some(address => !publicAddressOrHostname(address))) {
      throw new ConfigError('接口域名必须解析到公网地址');
    }
  }
  return url.href;
}
export async function validateSettings(slot: string, raw: unknown, enabled: boolean): Promise<ModelSettings> {
  const definition = MODEL_SLOTS.find(item => item.id === slot);
  if (!definition || !raw || typeof raw !== 'object') throw new ConfigError('配置格式不正确');
  const input = raw as Record<string, unknown>;
  const result = defaultSettings(slot);
  for (const key of ['name', 'protocol', 'endpoint', 'query_endpoint', 'model', 'voice', 'test_endpoint'] as const) {
    if (typeof input[key] !== 'string' || (input[key] as string).length > (key.endsWith('endpoint') ? 2048 : 200)) {
      throw new ConfigError(`配置字段 ${key} 不正确`);
    }
    result[key] = (input[key] as string).trim();
  }
  if (!(definition.protocols as readonly string[]).includes(result.protocol) || !result.name) {
    throw new ConfigError('模型名称或协议不正确');
  }
  if (!['Authorization', 'X-Gateway-Authorization', 'api-key', 'x-api-key', 'xi-api-key', 'x-goog-api-key'].includes(String(input.auth_header))
    || !['Bearer', 'raw', 'Basic'].includes(String(input.auth_scheme))) throw new ConfigError('认证方式不正确');
  result.auth_header = input.auth_header as ModelSettings['auth_header'];
  result.auth_scheme = input.auth_scheme as ModelSettings['auth_scheme'];
  result.timeout_ms = Number(input.timeout_ms);
  if (!Number.isInteger(result.timeout_ms) || result.timeout_ms < 1000 || result.timeout_ms > 120000
    || (['video', 'avatar', 'intelligence'].includes(definition.category) && result.timeout_ms > 30000)) throw new ConfigError('超时应为 1–120 秒，视频及情报请求最多 30 秒');
  for (const key of ['endpoint', 'query_endpoint', 'test_endpoint'] as const) {
    if (result[key]) result[key] = await validateEndpoint(result[key]);
  }
  if (slot === 'image.primary') {
    if (input.edit_endpoint != null && (typeof input.edit_endpoint !== 'string' || input.edit_endpoint.length > 2048)) {
      throw new ConfigError('图片编辑地址格式不正确');
    }
    result.edit_endpoint = typeof input.edit_endpoint === 'string' ? input.edit_endpoint.trim() : '';
    if (result.edit_endpoint) {
      result.edit_endpoint = await validateEndpoint(result.edit_endpoint);
      const generation = new URL(result.endpoint), edit = new URL(result.edit_endpoint);
      if (result.protocol !== 'openai-images' || !(GPT_IMAGE_EDIT_MODELS as readonly string[]).includes(result.model)
        || !generation.pathname.endsWith('/images/generations') || edit.origin !== generation.origin
        || edit.pathname !== generation.pathname.replace(/\/generations$/, '/edits')) {
        throw new ConfigError('图片编辑须使用受支持GPT Image模型，编辑地址应为生成地址同域同路径的images/edits');
      }
    }
  }
  if (slot === 'intelligence.youtube' && (result.endpoint !== 'https://www.googleapis.com/youtube/v3'
    || result.auth_header !== 'x-goog-api-key' || result.auth_scheme !== 'raw')) {
    throw new ConfigError('YouTube须使用官方Data API地址及x-goog-api-key原始密钥');
  }
  if (slot === 'intelligence.ebay' && (result.endpoint !== 'https://api.ebay.com/buy/browse/v1'
    || result.auth_header !== 'Authorization' || result.auth_scheme !== 'Basic')) {
    throw new ConfigError('eBay须使用正式Browse地址及Basic编码应用凭据');
  }
  if (enabled && (!result.endpoint || (['video', 'avatar'].includes(definition.category) && !result.query_endpoint)
    || (definition.category !== 'intelligence' && !['reader.primary', 'video.Kling', 'avatar.photo'].includes(definition.id) && !result.model))) {
    throw new ConfigError('启用前请填写接口、模型及视频查询地址');
  }
  return result;
}
async function encryptionKey(): Promise<CryptoKey> {
  const value = Deno.env.get('MODEL_CONFIG_ENCRYPTION_KEY') || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new ConfigError('请先配置服务端模型配置加密主密钥');
  const bytes = Uint8Array.from(value.match(/../g)!, part => Number.parseInt(part, 16));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptKey(slot: string, value: string): Promise<string> {
  if (!value || value.length > 4096 || /[\r\n]/.test(value)) throw new ConfigError('API Key 格式不正确');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(slot),
  }, await encryptionKey(), new TextEncoder().encode(value)));
  return `${btoa(String.fromCharCode(...iv))}.${btoa(String.fromCharCode(...data))}`;
}
export async function decryptKey(slot: string, value: string): Promise<string> {
  try {
    const [iv, data] = value.split('.').map(part => Uint8Array.from(atob(part), c => c.charCodeAt(0)));
    return new TextDecoder().decode(await crypto.subtle.decrypt({
      name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(slot),
    }, await encryptionKey(), data));
  } catch { throw new ConfigError('模型密钥无法解密，请核对服务端主密钥'); }
}
export interface ResolvedModel {
  slot: string;
  version_id: string;
  settings: ModelSettings;
  headers: Record<string, string>;
}
export async function resolveModel(slot: string, db: SupabaseClient = createServiceClient(), versionId?: string): Promise<ResolvedModel> {
  if (!MODEL_SLOTS.some(item => item.id === slot)) throw new ConfigError('不支持的模型配置项');
  let id = versionId;
  if (!id) {
    const { data, error } = await db.from('model_configs').select('current_version_id,enabled').eq('slot', slot).maybeSingle();
    if (error || !data?.enabled || !data.current_version_id) throw new ConfigError('模型未启用，请在模型设置中配置');
    id = data.current_version_id;
  }
  const { data, error } = await db.from('model_config_versions').select('id,slot,settings,key_ciphertext').eq('id', id).eq('slot', slot).single();
  if (error || !data) throw new ConfigError('任务的模型配置版本不可用');
  const settings = await validateSettings(slot, data.settings, true);
  const headers: Record<string, string> = {};
  if (data.key_ciphertext) {
    const key = await decryptKey(slot, data.key_ciphertext);
    headers[settings.auth_header] = settings.auth_scheme === 'raw' ? key : `${settings.auth_scheme} ${key}`;
  } else if (slot !== 'reader.primary') throw new ConfigError('模型密钥未配置');
  return { slot, version_id: data.id, settings, headers };
}
// 网络错误不暴露供应商原始响应和请求头。
export async function modelFetch(config: ResolvedModel, body: BodyInit, json = true): Promise<Response> {
  await validateEndpoint(config.settings.endpoint);
  let response: Response;
  try {
    response = await fetch(config.settings.endpoint, {
      method: 'POST', headers: { ...config.headers, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body, redirect: 'error', signal: AbortSignal.timeout(config.settings.timeout_ms),
    });
  } catch { throw new Error('模型连接失败或超时'); }
  if (!response.ok) throw new Error(`模型返回 HTTP ${response.status}`);
  return response;
}
