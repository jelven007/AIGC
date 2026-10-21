import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveModel, validateEndpoint } from './model-registry.ts';
import { responseBytes } from './audio-provider.ts';

export async function processMediaDeletions(db: SupabaseClient): Promise<number> {
  const claimed = await db.rpc('claim_media_deletions');
  if (claimed.error) throw new Error('素材清理队列不可用');
  let completed = 0;
  for (const item of claimed.data || []) {
    try {
      const removed = await db.storage.from(item.bucket).remove([item.path]);
      if (removed.error) throw new Error('对象存储暂不可用');
      const saved = await db.rpc('finish_media_deletion', { p_id: item.id, p_lease: item.lease_token, p_success: true });
      if (saved.error || !saved.data) throw new Error('清理回执保存失败');
      completed++;
    } catch {
      await db.rpc('finish_media_deletion', { p_id: item.id, p_lease: item.lease_token, p_success: false });
    }
  }
  return completed;
}

export async function processVoiceDeletions(db: SupabaseClient): Promise<number> {
  const claimed = await db.rpc('claim_voice_deletions');
  if (claimed.error) throw new Error('声纹清理队列不可用');
  let completed = 0;
  for (const item of claimed.data || []) {
    try {
      const clone = await db.from('voice_clones').select('*').eq('id', item.clone_id).eq('user_id', item.user_id).single();
      if (clone.error || !clone.data?.revoked_at) throw new Error('撤销声纹核对失败');
      const config = await resolveModel('audio.voice_clone', db, clone.data.model_config_version_id);
      if (config.settings.protocol !== 'elevenlabs-ivc') throw new Error('声纹删除协议不支持');
      const endpoint = `${config.settings.endpoint.replace(/\/$/, '')}/voices/${encodeURIComponent(clone.data.provider_voice_id)}`;
      await validateEndpoint(endpoint);
      const response = await fetch(endpoint, { method: 'DELETE', headers: config.headers,
        redirect: 'error', signal: AbortSignal.timeout(20000) });
      const data = JSON.parse(new TextDecoder().decode(await responseBytes(response, 16384)));
      // 幂等恢复仅认可供应商明确的已删除/声纹不存在回执。
      if (!(response.ok && data.status === 'ok') && !(response.status === 404 && data.detail?.status === 'voice_not_found')) {
        throw new Error('供应商未确认声纹删除');
      }
      const saved = await db.rpc('finish_voice_deletion', { p_id: item.id, p_lease: item.lease_token, p_success: true });
      if (saved.error || !saved.data) throw new Error('声纹清理回执保存失败');
      completed++;
    } catch {
      await db.rpc('finish_voice_deletion', { p_id: item.id, p_lease: item.lease_token, p_success: false });
    }
  }
  return completed;
}
