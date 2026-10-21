import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';

export async function handleTeamSpace(req: Request): Promise<Response> {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };
  const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
  if (req.method !== 'POST') return reply({ error: '仅支持POST' }, 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reply({ error: '请先登录' }, 401);
    const db = createServiceClient(), body = await req.json();
    if (body.action === 'get') {
      const member = await db.from('team_members').select('team_id').eq('user_id', auth.user.id).eq('status', 'active').maybeSingle();
      if (member.error) throw new Error('团队读取失败');
      if (!member.data) return reply({ team: null, members: [] });
      const team = await db.from('teams').select('*').eq('id', member.data.team_id).single();
      const members = await db.from('team_members').select('*').eq('team_id', member.data.team_id).eq('status', 'active').order('joined_at');
      if (team.error || members.error) throw new Error('团队成员读取失败');
      return reply({ team: team.data, members: members.data });
    }
    if (!['create', 'invite', 'accept', 'remove', 'role'].includes(body.action)) return reply({ error: '操作不支持' }, 400);
    if (body.action === 'accept' && (!auth.user.email_confirmed_at || typeof body.token !== 'string'
      || !/^[0-9a-f]{48}$/.test(body.token))) return reply({ error: '请先验证邀请邮箱，并使用完整邀请链接' }, 400);
    const result = await db.rpc('manage_team', { p_user: auth.user.id, p_action: body.action, p_data: body });
    if (result.error) return reply({ error: result.error.code === 'P0001' ? result.error.message : '团队操作失败' }, 409);
    return reply({ result: result.data });
  } catch (cause) { return reply({ error: cause instanceof Error ? cause.message : '团队服务不可用' }, 503); }
}
Deno.serve(handleTeamSpace);
