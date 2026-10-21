import type { ResolvedModel } from './model-registry.ts';
import { validateEndpoint } from './model-registry.ts';
import { encodeAudio, responseBytes } from './audio-provider.ts';

export const INTELLIGENCE_KINDS = ['intelligence_competitor', 'intelligence_products'];
export const EBAY_MARKETS = ['US', 'GB', 'DE', 'FR', 'IT', 'ES', 'AU', 'CA'];
export const LICENSED_PLATFORMS = ['douyin', 'tiktok', 'xiaohongshu', 'kuaishou'];
export const INTELLIGENCE_SLOTS = ['intelligence.youtube', 'intelligence.ebay', 'intelligence.licensed'];
export class IntelligenceError extends Error {}
const text = (value: unknown, max: number) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new IntelligenceError('数据源文本字段非法');
  return value.trim();
};
export function intelligenceParams(kind: string, slot: string, raw: unknown): Record<string,string> {
  if (!INTELLIGENCE_KINDS.includes(kind) || !INTELLIGENCE_SLOTS.includes(slot) || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IntelligenceError('情报对象参数非法');
  }
  const input = raw as Record<string, unknown>;
  if (kind === 'intelligence_competitor') {
    if (slot === 'intelligence.ebay') throw new IntelligenceError('商品数据源不能监控账号');
    const platform = slot === 'intelligence.youtube' ? 'youtube' : text(input.platform, 30);
    if (slot === 'intelligence.licensed' && !LICENSED_PLATFORMS.includes(platform)) throw new IntelligenceError('授权数据商平台不支持');
    const account = text(input.account_id, 100);
    if (platform === 'youtube' && !/^UC[\w-]{22}$/.test(account) && !/^@[\p{L}\p{N}_.-]{3,30}$/u.test(account)) {
      throw new IntelligenceError('YouTube账号请填写UC频道ID或@handle');
    }
    return { platform, account_id: account };
  }
  if (slot === 'intelligence.youtube') throw new IntelligenceError('频道数据源不能搜索商品');
  const market = text(input.market, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(market)) throw new IntelligenceError('商品市场非法');
  if (slot === 'intelligence.ebay' && !EBAY_MARKETS.includes(market)) throw new IntelligenceError('eBay市场不支持');
  if (input.search_mode === 'image') {
    if (slot !== 'intelligence.ebay') throw new IntelligenceError('当前数据源尚未支持图片搜索');
    const image_url = text(input.image_url, 2048), image_hash = text(input.image_hash, 64);
    if (!/^[a-f0-9]{64}$/.test(image_hash)) throw new IntelligenceError('图片内容标识非法');
    return { search_mode: 'image', image_url, image_hash, market };
  }
  if (input.search_mode !== undefined && input.search_mode !== 'keyword') throw new IntelligenceError('搜索方式非法');
  const query = text(input.query, 100);
  if (query.includes('*')) throw new IntelligenceError('商品关键词非法');
  const platform = slot === 'intelligence.licensed' ? text(input.platform, 30) : '';
  if (platform && !['douyin','tiktok','xiaohongshu','kuaishou','shopee','lazada','amazon'].includes(platform)) throw new IntelligenceError('授权商品平台不支持');
  return { query, market, ...(platform ? { platform } : {}) };
}
function count(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw new IntelligenceError('指标数值非法');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new IntelligenceError('指标数值超出范围');
  return n;
}
function date(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new IntelligenceError('数据源时间非法');
  return new Date(value).toISOString();
}
function link(value: unknown): string {
  const raw = text(value, 2048), url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443'
    || !host.includes('.') || /^[\d.:]+$/.test(host) || /\.(local|internal|test|lan)$/.test(host)
    || [...url.searchParams.keys()].some(key => /token|secret|api.?key|signature|authorization/i.test(key))) {
    throw new IntelligenceError('数据源页面链接非法');
  }
  return url.href;
}
function seconds(value: unknown): number | null {
  if (value === undefined) return null;
  const match = String(value).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}
async function read(config: ResolvedModel, path: string, params: Record<string, string>, headers = config.headers, body?: string) {
  await validateEndpoint(config.settings.endpoint);
  const url = new URL(`${config.settings.endpoint.replace(/\/$/, '')}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  let response: Response;
  try { response = await fetch(url, { headers, ...(body ? { method: 'POST', body } : {}),
    redirect: 'error', signal: AbortSignal.timeout(config.settings.timeout_ms) }); }
  catch { throw new Error('数据源连接中断或超时'); }
  if (!response.ok) {
    if ([400,401,402,403,404,405,410,413,415,422].includes(response.status)) throw new IntelligenceError(`数据源返回 HTTP ${response.status}，请检查授权和参数`);
    throw new Error(`数据源返回 HTTP ${response.status}`);
  }
  try { return JSON.parse(new TextDecoder().decode(await responseBytes(response, 2 * 1024 * 1024))); }
  catch { throw new IntelligenceError('数据源返回正文非法或超过2MB'); }
}
export async function collectIntelligence(config: ResolvedModel, kind: string, raw: unknown, image?: Uint8Array) {
  const params = intelligenceParams(kind, config.slot, raw);
  if (params.search_mode === 'image' && (!image?.length || image.length > 5 * 1024 * 1024)) throw new IntelligenceError('图片搜索内容缺失或过大');
  const source = { slot: config.slot, protocol: config.settings.protocol, version_id: config.version_id,
    name: config.settings.name, collected_at: new Date().toISOString(), observed_at: new Date().toISOString(), definition: '' };
  if (config.slot === 'intelligence.youtube') {
    const channels = await read(config, 'channels', { part: 'snippet,statistics,contentDetails', maxResults: '1',
      ...(/^UC/.test(params.account_id!) ? { id: params.account_id! } : { forHandle: params.account_id! }) });
    const channel = channels.items?.[0];
    if (!channel || !/^UC[\w-]{22}$/.test(channel.id) || !channel.contentDetails?.relatedPlaylists?.uploads) throw new IntelligenceError('频道不存在或无公开上传列表');
    const uploads = await read(config, 'playlistItems', { part: 'contentDetails', playlistId: channel.contentDetails.relatedPlaylists.uploads, maxResults: '20' });
    if (!Array.isArray(uploads.items) || uploads.items.length > 20) throw new IntelligenceError('频道上传列表非法');
    const ids = uploads.items.map((item: any) => item.contentDetails?.videoId);
    if (ids.some((id: unknown) => typeof id !== 'string' || !/^[\w-]{11}$/.test(id))) throw new IntelligenceError('视频标识非法');
    const videos = ids.length ? await read(config, 'videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }) : { items: [] };
    if (!Array.isArray(videos.items) || videos.items.length > 20) throw new IntelligenceError('频道视频统计非法');
    const items = videos.items.map((video: any) => {
      if (!ids.includes(video.id) || video.snippet?.channelId !== channel.id) throw new IntelligenceError('返回视频不属于所选频道');
      return { id: video.id, title: text(video.snippet.title, 200), url: `https://www.youtube.com/watch?v=${video.id}`,
        views: count(video.statistics?.viewCount), likes: count(video.statistics?.likeCount),
        comments: count(video.statistics?.commentCount), shares: null, duration: seconds(video.contentDetails?.duration),
        published_at: date(video.snippet.publishedAt) };
    });
    if (new Set(items.map((item: any) => item.id)).size !== items.length) throw new IntelligenceError('数据源返回重复视频');
    source.definition = '近期最多20条公开上传视频的累计公开统计，非全频道均值或销量；订阅数按官方规则舍入。2025-03-31起Shorts播放统计包含开始播放与重播，不能与旧口径直接比较。';
    return { source, params, account: { id: channel.id, name: text(channel.snippet?.title, 200),
      url: `https://www.youtube.com/channel/${channel.id}`,
      followers: channel.statistics?.hiddenSubscriberCount ? null : count(channel.statistics?.subscriberCount) }, items };
  }
  if (config.slot === 'intelligence.ebay') {
    // Basic凭据只发送到官方OAuth端点，access_token仅存在本次服务端调用内。
    let response: Response;
    try { response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', { method: 'POST',
      headers: { ...config.headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
      redirect: 'error', signal: AbortSignal.timeout(config.settings.timeout_ms) }); }
    catch { throw new Error('eBay授权连接中断'); }
    if (!response.ok) throw new IntelligenceError(`eBay授权返回 HTTP ${response.status}`);
    let oauth: any;
    try { oauth = JSON.parse(new TextDecoder().decode(await responseBytes(response, 16384))); }
    catch { throw new IntelligenceError('eBay授权响应非法'); }
    if (oauth.token_type?.toLowerCase() !== 'bearer' || typeof oauth.access_token !== 'string'
      || !oauth.access_token || /[\r\n]/.test(oauth.access_token)) throw new IntelligenceError('eBay授权凭据非法');
    const byImage = params.search_mode === 'image';
    const data = await read(config, byImage ? 'item_summary/search_by_image' : 'item_summary/search',
      { ...(byImage ? {} : { q: params.query! }), limit: '20', offset: '0' },
      { Authorization: `Bearer ${oauth.access_token}`, 'X-EBAY-C-MARKETPLACE-ID': `EBAY_${params.market}`,
        ...(byImage ? { 'Content-Type': 'application/json' } : {}) },
      byImage ? JSON.stringify({ image: encodeAudio(image!) }) : undefined);
    if (data.itemSummaries !== undefined && (!Array.isArray(data.itemSummaries) || data.itemSummaries.length > 20)) throw new IntelligenceError('eBay商品列表非法');
    if (data.itemSummaries === undefined && data.total !== 0) throw new IntelligenceError('eBay商品列表缺失');
    const items = (data.itemSummaries || []).map((item: any) => {
      const amount = item.price?.value, currency = item.price?.currency;
      if (typeof amount !== 'string' || !/^\d{1,12}(\.\d{1,4})?$/.test(amount)
        || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new IntelligenceError('商品价格或币种非法');
      return { id: text(item.itemId, 100), title: text(item.title, 200), url: link(item.itemWebUrl),
        price: amount, currency, seller: item.seller?.username ? text(item.seller.username, 200) : null,
        sold_7d: null, revenue_7d: null, commission_rate: null, stock: null };
    });
    if (new Set(items.map((item: any) => item.id)).size !== items.length) throw new IntelligenceError('数据源返回重复商品');
    source.definition = `eBay Browse官方${byImage ? '图片相似商品' : 'Best Match商品'}搜索，最多20条；含标价与原币种，不含销量排行、佣金、库存、运费税费或投放收益。`;
    const { image_url: _privateInput, ...searchParams } = params;
    return { source, params: searchParams, items };
  }
  const data = await read(config, kind === 'intelligence_competitor' ? 'accounts/snapshot' : 'products/search',
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])));
  if (data.schema !== 'intelligence-v1' || data.environment !== 'production' || data.platform !== params.platform
    || data.licensed !== true || !Array.isArray(data.items) || data.items.length > 20) throw new IntelligenceError('授权数据商响应不符合生产契约');
  const observed = date(data.observed_at);
  if (!observed || Date.now() - Date.parse(observed) > 72 * 3600000 || Date.parse(observed) > Date.now() + 300000) throw new IntelligenceError('数据源观测时间缺失、过期或超前');
  source.observed_at = observed; source.definition = text(data.metric_definition, 1500);
  if (kind === 'intelligence_competitor') {
    if (data.account?.id !== params.account_id) throw new IntelligenceError('数据商返回不同账号');
    const items = data.items.map((item: any) => ({ id: text(item.id, 100), title: text(item.title, 200), url: link(item.url),
      views: count(item.views), likes: count(item.likes), comments: count(item.comments), shares: count(item.shares),
      duration: count(item.duration), published_at: date(item.published_at) }));
    if (new Set(items.map((item: any) => item.id)).size !== items.length) throw new IntelligenceError('数据源返回重复视频');
    return { source, params, account: { id: params.account_id, name: text(data.account.name, 200),
      url: link(data.account.url), followers: count(data.account.followers) }, items };
  }
  if (data.query !== params.query || data.market !== params.market) throw new IntelligenceError('数据商返回不同查询或市场');
  const items = data.items.map((item: any) => {
    if (typeof item.price !== 'string' || !/^\d{1,12}(\.\d{1,4})?$/.test(item.price) || !/^[A-Z]{3}$/.test(item.currency)) {
      throw new IntelligenceError('商品价格或币种非法');
    }
    if (item.sold_7d !== undefined && item.sold_7d !== null && data.sales_window_days !== 7) throw new IntelligenceError('销量缺少7天窗口定义');
    return { id: text(item.id, 100), title: text(item.title, 200), url: link(item.url), price: item.price,
      currency: item.currency, seller: item.seller ? text(item.seller, 200) : null,
      sold_7d: count(item.sold_7d), revenue_7d: null, commission_rate: null, stock: count(item.stock) };
  });
  if (new Set(items.map((item: any) => item.id)).size !== items.length) throw new IntelligenceError('数据源返回重复商品');
  return { source, params, items };
}
