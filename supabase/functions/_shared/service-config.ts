/** 专属网关必须由部署环境显式指定，缺失时拒绝调用。 */
export function requiredServiceUrl(name: string): string {
  const value = Deno.env.get(name)?.replace(/\/+$/, '');
  if (!value) throw new Error(`服务端未配置 ${name}`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${name} 必须使用 HTTPS`);
  return value;
}
