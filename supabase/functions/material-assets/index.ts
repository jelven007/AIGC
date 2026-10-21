import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { mediaObject, ownsMedia, signMediaTree } from '../_shared/private-media.ts';

export async function handleMaterialAssets(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (data: unknown, status = 200) => Response.json(data, { headers, status });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const db = createServiceClient(), body = await req.json(), user = auth.user.id;
    if (body.action === 'shared') {
      const member = await db.from('team_members').select('team_id').eq('user_id', user).eq('status', 'active').maybeSingle();
      if (member.error) throw new Error('团队读取失败');
      if (!member.data) return reply({ materials: [] });
      const shares = await db.from('team_asset_shares').select('material_id').eq('team_id', member.data.team_id);
      if (shares.error) throw new Error('共享列表读取失败');
      if (!shares.data?.length) return reply({ materials: [] });
      const items = await db.from('materials').select('*').in('id', shares.data.map(item => item.material_id));
      if (items.error) throw new Error('共享素材读取失败');
      return reply({ materials: await signMediaTree(db, items.data, user) });
    }
    const material = await db.from('materials').select('*').eq('id', body.material_id).eq('user_id', user).maybeSingle();
    if (material.error) throw new Error('素材读取失败');
    if (!material.data) return reply({ error: '素材不存在或不属于当前账号' }, 404);
    const object = mediaObject(material.data.url, Deno.env.get('SUPABASE_URL')!);
    if (body.action === 'delete') {
      const deleted = await db.rpc('delete_owned_material', { p_user: user, p_material: body.material_id,
        p_bucket: object?.bucket || null, p_path: object?.path || null });
      if (deleted.error) return reply({ error: deleted.error.message.includes('引用') ? '素材仍被作品、形象或任务引用，请先移除引用' : '素材删除失败' }, 409);
      return reply({ ok: true, cleanup_pending: !!object });
    }
    if (['share', 'unshare'].includes(body.action)) {
      if (body.action === 'unshare') {
        const removed = await db.from('team_asset_shares').delete().eq('material_id', body.material_id)
          .eq('team_id', body.team_id).eq('owner_id', user);
        if (removed.error) throw new Error('共享撤销失败');
        return reply({ ok: true });
      }
      const member = await db.from('team_members').select('role').eq('team_id', body.team_id).eq('user_id', user).eq('status', 'active').maybeSingle();
      if (member.error) throw new Error('团队权限读取失败');
      if (!member.data || member.data.role === 'viewer') return reply({ error: '当前角色不能共享素材' }, 403);
      if (!object) return reply({ error: '请先将素材上传至私有素材库' }, 400);
      if (!ownsMedia(object.path, user)) {
        const legacy = await db.from('legacy_media_access').select('path').eq('user_id', user)
          .eq('bucket', object.bucket).eq('path', object.path).maybeSingle();
        if (legacy.error || !legacy.data) return reply({ error: '只能共享自己拥有的素材对象' }, 403);
      }
      const saved = await db.from('team_asset_shares').upsert({ material_id: body.material_id, team_id: body.team_id, owner_id: user, ...object });
      if (saved.error) throw new Error('共享设置保存失败');
      return reply({ ok: true });
    }
    return reply({ error: '素材操作不支持' }, 400);
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '素材服务不可用' }, 503); }
}
Deno.serve(handleMaterialAssets);
