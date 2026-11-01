/** 旧键只用于迁移用户回执；保留原UUID，写入失败时继续使用原键。 */
const validReceipt = (value: any): boolean => {
  if (Array.isArray(value)) return value.every(validReceipt);
  if (!value || typeof value !== 'object') return false;
  return ['request_key', 'key', 'id', 'job_id'].some(key => typeof value[key] === 'string' && value[key].length > 0)
    || typeof value.request?.request_key === 'string' || typeof value.body?.request_key === 'string';
};

export function projectStorageKey(kind: string, userId: string | undefined, scope?: string,
  valid: (value: any) => boolean = validReceipt, storage?: Storage): string {
  if (!userId) return '';
  const suffix = `${kind}:${userId}${scope !== undefined ? `:${scope}` : ''}`;
  const current = `aigc:${suffix}`;
  const aliases: Record<string, string> = {
    'operator-request': `shopro-operator-request-${userId}`,
    'product-mutation': `shopro-product-mutation-${userId}`,
    'product-extraction': `shopro-product-extraction-${userId}`,
  };
  const legacyKeys = [aliases[kind], `shoproai:${suffix}`, `shopro:${suffix}`].filter(Boolean);
  const migrate = (store: Storage, key: string, aliases: string[], validate: (raw: string) => boolean) => {
    const existing = store.getItem(key);
    const clean = () => {
      for (const alias of aliases) {
        try { store.removeItem(alias); } catch { /* 当前回执已读回确认。 */ }
      }
    };
    if (existing !== null && validate(existing)) { clean(); return key; }
    for (const alias of aliases) {
      const receipt = store.getItem(alias);
      if (receipt === null || !validate(receipt)) continue;
      try {
        store.setItem(key, receipt);
        if (store.getItem(key) !== receipt) return alias;
      } catch { return alias; }
      clean();
      return key;
    }
    // 保留损坏值，让原有读取逻辑报告错误，而不是将它当作可新建的空回执。
    return existing !== null ? key : aliases.find(alias => store.getItem(alias) !== null) || key;
  };
  try {
    const store = storage || localStorage;
    const validate = (raw: string) => {
      if (kind === 'experiment-request' && scope === 'source') return /^[0-9a-f-]{36}$/i.test(raw);
      try { return !!valid(JSON.parse(raw)); } catch { return false; }
    };
    return migrate(store, current, legacyKeys, validate);
  } catch {
    throw new Error('任务回执迁移读取失败，请恢复浏览器存储并核对原任务后再提交');
  }
}
