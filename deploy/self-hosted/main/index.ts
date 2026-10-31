/** 固定生产入口清单；每个原函数保留其JWT验证和业务授权。 */
const manifest = JSON.parse(await Deno.readTextFile('/home/deno/manifest.json'));
const routes = new Map<string, boolean>(manifest.functions.map((item: { name: string; verify_jwt: boolean }) =>
  [item.name, item.verify_jwt]));
const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' };
const secret = Deno.env.get('JWT_SECRET') || '';
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
  { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)),
    character => character.charCodeAt(0));
}
async function validJwt(req: Request): Promise<boolean> {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    return header.alg === 'HS256' && typeof claims.exp === 'number' && claims.exp > Date.now() / 1000
      && await crypto.subtle.verify('HMAC', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch { return false; }
}
Deno.serve(async req => {
  const name = new URL(req.url).pathname.split('/').filter(Boolean)[0];
  if (!routes.has(name)) return Response.json({ error: 'Function not found' }, { status: 404, headers: cors });
  const probe = req.headers.get('x-shopro-function-probe') === Deno.env.get('VIDEO_WORKER_SECRET')
    && !!Deno.env.get('VIDEO_WORKER_SECRET') && req.method === 'OPTIONS';
  if (req.method === 'OPTIONS' && !probe) return new Response(null, { status: 204, headers: cors });
  if (!probe && routes.get(name) && !await validJwt(req)) {
    return Response.json({ error: 'Invalid JWT' }, { status: 401, headers: cors });
  }
  try {
    console.log('Loading function', name);
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: '/home/deno/functions/' + name,
      memoryLimitMb: 256, workerTimeoutMs: 150000, noModuleCache: true,
      envVars: Object.entries(Deno.env.toObject()),
    });
    console.log('Function loaded', name);
    const response = await worker.fetch(req);
    if (probe && response.status < 500) return Response.json({ loaded: name }, { headers: cors });
    return response;
  } catch (error) {
    console.error('Function unavailable', name, error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: 'Function unavailable' }, { status: 503, headers: cors });
  }
});
