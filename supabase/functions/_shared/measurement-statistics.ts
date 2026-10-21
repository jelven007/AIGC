export const countFields = ['view_count', 'like_count', 'comment_count', 'share_count'] as const;
export function ratio(numerator: number | null, denominator: number | null): number | null {
  return typeof numerator === 'number' && Number.isFinite(numerator) && typeof denominator === 'number'
    && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null;
}
// 双尾标准正态尾部：erfc(|z|/sqrt(2))，避免旧近似将单尾误乘二。
export function normalTwoSided(z: number): number {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + .3275911 * x);
  return Math.min(1, Math.max(0, (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x)));
}
export function wilson(successes: number, trials: number): [number, number] | null {
  if (!Number.isSafeInteger(trials) || trials <= 0 || successes < 0 || successes > trials) return null;
  const z = 1.959963984540054, p = successes / trials, d = 1 + z * z / trials;
  const c = (p + z * z / (2 * trials)) / d;
  const margin = z / d * Math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials));
  return [Math.max(0, c - margin), Math.min(1, c + margin)];
}
export function proportionTest(a: number, n: number, b: number, m: number): number | null {
  if (![a, n, b, m].every(value => Number.isSafeInteger(value) && value >= 0) || !n || !m || a > n || b > m) return null;
  const pooled = (a + b) / (n + m);
  // 稀疏样本不套正态近似；不输出误导性的显著结论。
  if (Math.min(n * pooled, n * (1 - pooled), m * pooled, m * (1 - pooled)) < 5) return null;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n + 1 / m));
  return se > 0 ? normalTwoSided((a / n - b / m) / se) : null;
}
export function holm(values: Array<number | null>): Array<number | null> {
  const sorted = values.map((p, index) => ({ p: p ?? 1, index })).sort((a, b) => a.p - b.p);
  const adjusted: Array<number | null> = Array(values.length).fill(null);
  let previous = 0;
  sorted.forEach(({ p, index }, rank) => {
    previous = Math.max(previous, Math.min(1, p * (values.length - rank)));
    adjusted[index] = values[index] === null ? null : previous;
  });
  return adjusted;
}
interface Variant {
  id: string; label: string; title: string; project_id: string;
  assigned: number; impressions: number; clicks: number; conversions: number;
}
export interface Experiment {
  id: string; status: string; primary_metric: string; planned_sample: number; variants: Variant[];
  [key: string]: unknown;
}
export function experimentStatistics(experiment: Experiment) {
  const variants = experiment.variants || [], control = variants[0];
  const successes = (v: Variant) => experiment.primary_metric === 'ctr' ? v.clicks : v.conversions;
  let reason = experiment.status !== 'closed' ? '实验尚未结案，结果只供观察' : '';
  if (!reason && variants.some(v => v.impressions < experiment.planned_sample)) reason = '未达到预设每组样本量';
  if (!reason && variants.some(v => v.assigned !== v.impressions)) reason = '部分已分组用户缺少曝光，无法确认随机样本完整性';
  if (!reason && control && variants.slice(1).some(v => {
    const n = control.assigned + v.assigned;
    return n > 0 && normalTwoSided((v.assigned - n / 2) / Math.sqrt(n / 4)) < .01 / (variants.length - 1);
  })) reason = '分组样本比例异常，需要核对投放与采集';
  if (!control || variants.length < 2) reason = '需要至少两个变体';
  const pValues = variants.slice(1).map(v => reason ? null
    : proportionTest(successes(control), control.impressions, successes(v), v.impressions));
  const adjusted = holm(pValues);
  return {
    ...experiment,
    inference_reason: reason || (pValues.some(p => p === null) ? '部分变体成功或失败样本过少，暂不做显著性判断' : ''),
    variants: variants.map((v, index) => {
      const value = ratio(successes(v), v.impressions), base = control ? ratio(successes(control), control.impressions) : null;
      const p = index ? adjusted[index - 1] : null;
      return { ...v, ctr: ratio(v.clicks, v.impressions), cvr: ratio(v.conversions, v.clicks),
        conversion_per_exposure: ratio(v.conversions, v.impressions), primary_rate: value,
        interval: wilson(successes(v), v.impressions),
        uplift: index && base !== null && base > 0 && value !== null ? value / base - 1 : null,
        p_value: index ? pValues[index - 1] : null, adjusted_p_value: p,
        recommended: p !== null && p < .05 && value !== null && base !== null && value > base };
    }),
  };
}
export function reportStatistics(report: any) {
  const natural = report.natural || [];
  const totals = report.natural_totals || Object.fromEntries(countFields.map(field => {
    const numbers = natural.map((item: any) => item[field]).filter((value: unknown) => typeof value === 'number');
    return [field, { value: numbers.length ? numbers.reduce((a: number, b: number) => a + b, 0) : null,
      observed: numbers.length, total: natural.length }];
  }));
  for (const field of countFields) if (totals[field].value !== null && !Number.isSafeInteger(totals[field].value)) totals[field].value = null;
  const delivery = (report.delivery || []).map((original: any) => {
    const group = { ...original };
    for (const field of ['impressions', 'clicks', 'conversions', 'spend_minor', 'gmv_minor', 'refunds_minor']) {
      if (group[field] !== null && !Number.isSafeInteger(group[field])) group[field] = null;
    }
    const net = group.gmv_minor !== null && group.refunds_minor !== null ? group.gmv_minor - group.refunds_minor : null;
    return { ...group, ctr: ratio(group.clicks, group.impressions), cvr: ratio(group.conversions, group.clicks),
      net_revenue_minor: net, roas: ratio(net, group.spend_minor),
      cpa_minor: ratio(group.spend_minor, group.conversions),
      // 未接商品成本、税费、履约等，不能把ROAS标为利润ROI。
      profit_roi: null };
  });
  return { ...report, natural_totals: totals, delivery };
}
