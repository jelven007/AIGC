import { supabase } from '@/db/supabase';
import type { Script } from '@/types/types';

type Table = 'scripts' | 'knowledge_entries';
interface Receipt { id: string; table: Table; input: Record<string, unknown>; confirmed: boolean }
const storageKey = (owner: string) => `shopro:script-writes:${owner}`;
const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
function read(owner: string): Receipt[] {
  try {
    const items = JSON.parse(localStorage.getItem(storageKey(owner)) || '[]');
    return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string'
      && ['scripts', 'knowledge_entries'].includes(item.table) && item.input && typeof item.input === 'object') : [];
  } catch { return []; }
}
async function requireOwner(owner: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id !== owner) throw new Error('账号已切换，请在原账号继续保存脚本');
}
/** 保存前持久化原UUID，响应未知后只读取/重试原内容，确认记录仍复用原ID。 */
async function save(table: Table, owner: string, input: Record<string, unknown>): Promise<any> {
  await requireOwner(owner);
  const fingerprint = stable(input);
  const history = read(owner);
  let receipt = history.find(item => item.table === table && stable(item.input) === fingerprint);
  if (!receipt) {
    if (history.filter(item => !item.confirmed).length >= 20) throw new Error('有20份保存结果待确认，请先恢复原脚本');
    receipt = { id: crypto.randomUUID(), table, input, confirmed: false };
    localStorage.setItem(storageKey(owner), JSON.stringify([...history.filter(item => !item.confirmed),
      ...history.filter(item => item.confirmed).slice(-19), receipt]));
  }
  const find = async () => {
    await requireOwner(owner);
    const result = await supabase.from(table).select('*').eq('id', receipt.id).eq('user_id', owner)
      .abortSignal(AbortSignal.timeout(15000)).maybeSingle();
    if (result.error) throw new Error('原脚本保存结果读取失败，请重试');
    return result.data;
  };
  let row = await find();
  if (!row) {
    if (receipt.confirmed) throw new Error('原保存记录已不存在，请修改内容后保存新版本');
    await requireOwner(owner);
    const inserted = await supabase.from(table).insert({ ...input, id: receipt.id, user_id: owner })
      .select().maybeSingle();
    if (inserted.error && inserted.error.code !== '23505') throw new Error('脚本保存结果未确认，请重试原内容');
    row = inserted.data || await find();
  }
  await requireOwner(owner);
  if (!row || stable(Object.fromEntries(Object.keys(input).map(key => [key, row[key]]))) !== fingerprint) {
    throw new Error('原脚本内容核对失败，请联系支持');
  }
  localStorage.setItem(storageKey(owner), JSON.stringify(read(owner).map(item => item.id === receipt.id ? { ...item, confirmed: true } : item)));
  return row;
}
export function saveScriptDraft(owner: string, input: Record<string, unknown>): Promise<Script> {
  return save('scripts', owner, input);
}
export function saveScriptKnowledge(owner: string, input: Record<string, unknown>): Promise<{ id: string }> {
  return save('knowledge_entries', owner, input);
}
export function pendingScriptWrites(owner: string): number { return read(owner).filter(item => !item.confirmed).length; }
export async function recoverScriptWrites(owner: string): Promise<{ restored: number; errors: string[] }> {
  await requireOwner(owner);
  const result = { restored: 0, errors: [] as string[] };
  for (const receipt of read(owner).filter(item => !item.confirmed)) {
    try { await save(receipt.table, owner, receipt.input); result.restored++; }
    catch (cause) { result.errors.push(cause instanceof Error ? cause.message : '原保存恢复失败'); }
  }
  return result;
}
