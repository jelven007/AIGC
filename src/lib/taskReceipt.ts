const readError = '任务回执读取失败，请在任务中心核对原任务并恢复浏览器存储后再提交';
const writeError = '任务回执无法保存，请恢复浏览器存储后重试；本次尚未提交';
export function readTaskReceipt<T>(key: string, valid: (value: any) => boolean): { value: T | null; error: string } {
  if (!key) return { value: null, error: '' };
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { value: null, error: '' };
    const value = JSON.parse(raw);
    if (!valid(value)) throw new Error(readError);
    return { value, error: '' };
  } catch { return { value: null, error: readError }; }
}
/** 写后读回可检测隐私模式/存储代理静默丢弃，不能仅依赖内存原UUID。 */
export function writeTaskReceipt(key: string, value: unknown) {
  try {
    if (!key) throw new Error(writeError);
    const raw = value === null ? null : JSON.stringify(value);
    if (raw === null) localStorage.removeItem(key); else localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error(writeError);
  } catch { throw new Error(value === null ? '原任务已保留，但回执清理失败，请恢复浏览器存储后核对原任务' : writeError); }
}
