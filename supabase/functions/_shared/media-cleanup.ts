import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function processMediaDeletions(db: SupabaseClient): Promise<number> {
  const claimed = await db.rpc('claim_media_deletions');
  if (claimed.error) throw new Error('素材清理队列不可用');
  let completed = 0;
  for (const item of claimed.data || []) {
    try {
      const removed = await db.storage.from(item.bucket).remove([item.path]);
      if (removed.error) throw new Error('对象存储暂不可用');
      const saved = await db.from('media_deletions').update({ completed_at: new Date().toISOString(), last_error: null }).eq('id', item.id);
      if (saved.error) throw new Error('清理回执保存失败');
      completed++;
    } catch {
      await db.from('media_deletions').update({ last_error: '对象删除未确认，后台将重试',
        next_run_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(item.attempts, 7)) * 1000).toISOString() }).eq('id', item.id);
    }
  }
  return completed;
}
