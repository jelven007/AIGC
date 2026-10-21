import { backendUrl } from './backendConfig';

const cache = new Map<string, { url: string; until: number }>();
const base = new URL(backendUrl);
export function canonicalMedia(value: string): string {
  try {
    const url = new URL(value, backendUrl);
    if (url.origin !== base.origin) return value;
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/(materials|videos|thumbnails)\/(.+)$/);
    return match ? `${base.origin}/storage/v1/object/authenticated/${match[1]}/${match[2]}` : value;
  } catch { return value; }
}
export function canonicalMediaTree<T>(value: T): T {
  if (typeof value === 'string') return canonicalMedia(value) as T;
  if (Array.isArray(value)) return value.map(canonicalMediaTree) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, canonicalMediaTree(item)])) as T;
  return value;
}
async function sign(value: string, headers: Headers): Promise<string> {
  const canonical = canonicalMedia(value);
  if (!canonical.startsWith(`${base.origin}/storage/v1/object/authenticated/`)) return value;
  const cacheKey = `${headers.get('authorization') || ''}:${canonical}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.url;
  const path = new URL(canonical).pathname.replace('/object/authenticated/', '/object/sign/');
  const response = await fetch(`${base.origin}${path}`, {
    method: 'POST', headers: { Authorization: headers.get('authorization') || '', apikey: headers.get('apikey') || '',
      'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 900 }),
  });
  if (!response.ok) return canonical;
  const data = await response.json();
  const url = data.signedURL ? data.signedURL.startsWith('http') ? data.signedURL
    : `${base.origin}/storage/v1${data.signedURL.startsWith('/') ? '' : '/'}${data.signedURL}` : canonical;
  if (data.signedURL) cache.set(cacheKey, { url, until: Date.now() + 600000 });
  return url;
}
export async function hydrateMediaTree<T>(value: T, headers: Headers): Promise<T> {
  if (typeof value === 'string') return await sign(value, headers) as T;
  if (Array.isArray(value)) return Promise.all(value.map(item => hydrateMediaTree(item, headers))) as Promise<T>;
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await hydrateMediaTree(item, headers)]));
    return Object.fromEntries(entries) as T;
  }
  return value;
}
export function clearMediaCache() { cache.clear(); }

/** Data API 写稳定对象引用，读取时按当前 JWT 签名；签名接口由 Storage RLS 授权。 */
export async function privateMediaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin !== base.origin || !url.pathname.startsWith('/rest/v1/')) return fetch(req);
  let outgoing = req;
  if (['POST', 'PATCH', 'PUT'].includes(req.method) && req.headers.get('content-type')?.includes('application/json')) {
    const body = await req.clone().json().catch(() => null);
    if (body !== null) outgoing = new Request(req, { body: JSON.stringify(canonicalMediaTree(body)) });
  }
  const response = await fetch(outgoing);
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return response;
  const data = await response.clone().json().catch(() => null);
  if (data === null) return response;
  const headers = new Headers(response.headers); headers.delete('content-length');
  return new Response(JSON.stringify(await hydrateMediaTree(data, req.headers)), { status: response.status, headers });
}
