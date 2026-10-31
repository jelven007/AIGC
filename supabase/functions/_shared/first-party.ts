/** 单一自托管origin例外；只用于本站API/Storage，供应商仍用公网校验。 */
export function isFirstParty(value: string): boolean {
  try {
    const origin = Deno.env.get('SELF_HOSTED_BACKEND_ORIGIN');
    return !!origin && new URL(value).origin === origin;
  } catch { return false; }
}
export async function validateFirstParty(value: string, mediaOnly = false): Promise<URL> {
  const url = new URL(value);
  if (!isFirstParty(value) || url.protocol !== 'https:' || url.username || url.password || url.hash
    || !(mediaOnly
      ? /^\/storage\/v1\/object\/(?:public|authenticated|sign)\/(?:materials|videos|thumbnails)\/.+/.test(url.pathname)
      : /^\/(?:auth|rest|storage|functions|realtime)\/v1\//.test(url.pathname))) {
    throw new Error('不属于配置的第一方HTTPS入口');
  }
  const allowed = (Deno.env.get('SELF_HOSTED_BACKEND_IPS') || '').split(',').map(value => value.trim()).filter(Boolean);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = /^[\d.]+$/.test(hostname) || hostname.includes(':') ? [hostname]
    : (await Promise.all([Deno.resolveDns(hostname, 'A').catch(() => []),
      Deno.resolveDns(hostname, 'AAAA').catch(() => [])])).flat();
  if (!allowed.length || !addresses.length || addresses.some(value => !allowed.includes(value))) {
    throw new Error('第一方DNS与部署固定地址不符');
  }
  return url;
}
let firstPartyClient: Deno.HttpClient | undefined;
export async function firstPartyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const value = input instanceof Request ? input.url : String(input);
  if (!isFirstParty(value)) return fetch(input, init);
  try { await validateFirstParty(value); }
  catch (error) {
    console.error('First party validation failed', error instanceof Error ? error.message : 'UnknownError');
    throw error;
  }
  if (!firstPartyClient) {
    const ca = Deno.env.get('SELF_HOSTED_CA_FILE');
    const certificate = Deno.env.get('SELF_HOSTED_CA_PEM') || (ca ? await Deno.readTextFile(ca) : undefined);
    firstPartyClient = Deno.createHttpClient(certificate ? { caCerts: [certificate] } : {});
  }
  // Docker静态DNS alias绑定部署IP，保留域名TLS/SNI；CA仅给第一方客户端。
  try { return await fetch(input, { ...init, redirect: 'error', client: firstPartyClient }); }
  catch (error) {
    console.error('First party connection failed', error instanceof Error ? error.name : 'UnknownError');
    throw error;
  }
}
