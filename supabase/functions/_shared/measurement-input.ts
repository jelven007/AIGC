export class MeasurementInputError extends Error {}
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
export function checkMeasurementInput(body: any) {
  const bad = (message: string): never => { throw new MeasurementInputError(message); };
  if (!body || !isUuid(body.request_key)) bad('需要固定的请求UUID');
  if (body.action === 'assign') {
    if (!isUuid(body.experiment_id) || !hash(body.unit_hash)) bad('需要实验ID和匿名用户摘要');
  } else if (body.action === 'events') {
    if (!isUuid(body.experiment_id) || !Array.isArray(body.events) || !body.events.length || body.events.length > 100) bad('事件批次需1到100条');
    for (const event of body.events) {
      if (!hash(event?.unit_hash) || !['exposure', 'click', 'conversion'].includes(event.type) || !timestamp(event.occurred_at)) bad('实验事件格式不正确');
    }
  } else if (body.action === 'daily') {
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 100) bad('观测批次需1到100条');
    const seen = new Set<string>();
    for (const row of body.rows) {
      if (!isUuid(row?.project_id) || typeof row.dataset_key !== 'string' || !row.dataset_key.trim()
        || row.dataset_key.length > 200 || !/^\d{4}-\d\d-\d\d$/.test(row.business_date)
        || !timestamp(row.observed_at) || !Number.isSafeInteger(row.revision) || row.revision <= 0
        || !['CNY', 'USD', 'EUR', 'GBP', 'SGD', 'HKD', 'AUD', 'CAD'].includes(row.currency)) bad('观测归属、日期、版本或币种不正确');
      const key = `${row.dataset_key}:${row.business_date}`;
      if (seen.has(key)) bad('同一批次不能重复数据集日期');
      seen.add(key);
      for (const field of ['impressions', 'clicks', 'conversions', 'spend_minor', 'gmv_minor', 'refunds_minor']) {
        if (row[field] !== null && (!Number.isSafeInteger(row[field]) || row[field] < 0)) bad('观测字段需非负整数或null，金额使用最小货币单位');
      }
      if (row.clicks !== null && row.impressions !== null && row.clicks > row.impressions
        || row.conversions !== null && row.clicks !== null && row.conversions > row.clicks
        || row.refunds_minor !== null && row.gmv_minor !== null && row.refunds_minor > row.gmv_minor) bad('漏斗或退款口径不一致');
    }
  } else bad('观测操作不支持');
}
export async function measurementSignature(secret: string, timestampValue: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestampValue}.${raw}`));
  return [...new Uint8Array(signed)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function verifyMeasurementSignature(secret: string, timestampValue: string | null, signature: string | null, raw: string, now = Date.now()) {
  if (!timestampValue || !/^\d{10}$/.test(timestampValue) || Math.abs(now - Number(timestampValue) * 1000) > 300000
    || !signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = await measurementSignature(secret, timestampValue, raw);
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return difference === 0;
}
