import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { mediaObject, ownsMedia, signMediaTree } from '../_shared/private-media.ts';

const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function handleMaterialAssets(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (data: unknown, status = 200) => Response.json(data, { headers, status });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const db = createServiceClient(), body = await req.json(), user = auth.user.id;
    if (body.action === 'register') {
      const input = body.input, root = Deno.env.get('SUPABASE_URL')!;
      if (!uuid(body.request_key) || !input || typeof input !== 'object' || Array.isArray(input)
        || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200
        || !['image', 'video', 'audio'].includes(input.type) || input.rights_confirmed !== true
        || !Number.isInteger(input.size) || input.size < 1 || input.size > 50 * 1024 * 1024
        || !/^[a-f0-9]{64}$/.test(input.content_hash || '')
        || !['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'ogg', 'm4a', 'opus'].includes(input.extension)
        || typeof input.mime !== 'string' || !input.mime.startsWith(`${input.type}/`)
        || !['upload', 'recording'].includes(input.source)
        || input.source === 'recording' && input.type !== 'audio'
        || input.type !== 'image' && (typeof input.duration_sec !== 'number' || !Number.isFinite(input.duration_sec)
          || input.duration_sec < .1 || input.duration_sec > 36000)) return reply({ error: '素材参数或使用权确认无效' }, 400);
      const path = `${user}/uploads/${body.request_key.toLowerCase()}.${input.extension}`;
      const normalized = { name: input.name.trim(), type: input.type, size: input.size, mime: input.mime,
        content_hash: input.content_hash, extension: input.extension, source: input.source,
        rights_confirmed: true, duration_sec: input.type === 'image' ? null : input.duration_sec,
        path, url: `${root}/storage/v1/object/authenticated/materials/${path}` };
      const saved = await db.rpc('register_material_upload', { p_user: user, p_key: body.request_key, p_request: normalized });
      if (saved.error) {
        const message = saved.error.message;
        if (/尚未上传/.test(message)) return reply({ error: '原素材尚未上传，请重新选择原文件' }, 404);
        if (/同一请求标识|清理|不一致/.test(message)) return reply({ error: message }, 409);
        if (/参数|使用权/.test(message)) return reply({ error: '素材登记参数无效' }, 400);
        throw new Error('素材登记结果待确认，请恢复原请求');
      }
      return reply(await signMediaTree(db, saved.data, user));
    }
    if (body.action === 'list') {
      const offset = body.offset ?? 0, limit = body.limit ?? 30, search = body.search ?? '';
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit)
        || limit < 1 || limit > 100 || body.type && !['image', 'video', 'audio'].includes(body.type)
        || typeof search !== 'string' || search.length > 200) {
        return reply({ error: '素材分页或类型无效' }, 400);
      }
      let query = db.from('materials').select('*', { count: 'exact' }).eq('user_id', user);
      if (body.type) query = query.eq('type', body.type);
      if (search.trim()) query = query.ilike('name', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
      const items = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
      if (items.error) throw new Error('素材列表读取失败');
      return reply({ materials: await signMediaTree(db, items.data || [], user), total: items.count || 0 });
    }
    if (body.action === 'shared') {
      const member = await db.from('team_members').select('team_id').eq('user_id', user).eq('status', 'active').maybeSingle();
      if (member.error) throw new Error('团队读取失败');
      if (!member.data) return reply({ materials: [] });
      const shares = await db.from('team_asset_shares').select('material_id').eq('team_id', member.data.team_id).limit(100);
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
