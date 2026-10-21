import { authenticateRequest, createServiceClient } from '../_shared/auth.ts';
import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
import { generateText } from '../_shared/text-provider.ts';
import { boundedText } from '../_shared/structured-analysis.ts';
const retired: Record<string, string> = {
  generate_api_key: 'api-keys', revoke_api_key: 'api-keys', create_team: 'team-space', get_team: 'team-space',
  create_invitation: 'team-space', remove_member: 'team-space', change_member_role: 'team-space',
  create_publish_task: 'platform-publish', publish_video: 'platform-publish', analyze_live_highlight: 'production-jobs analysis',
};
export async function handlePhase3(req: Request) {
  const preflight = handleCorsPreflight(req); if (preflight) return preflight;
  const headers = getCorsHeaders(req);
  const reply = (data: unknown, status = 200) => Response.json({ code: 0, data }, { status, headers });
  const reject = (message: string, status = 400) => Response.json({ code: 1, message, data: null }, { status, headers });
  if (req.method !== 'POST') return reject('仅支持POST', 405);
  try {
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user || auth.isServiceRole) return reject(auth.error || '请先登录', auth.status || 401);
    const uid = auth.user.id, db = createServiceClient(), body = await req.json();
    if (retired[body.action]) return reject(`该入口已迁移至 ${retired[body.action]}，请更新客户端`, 410);
    if (body.action === 'add_competitor') {
      if (!['douyin', 'tiktok', 'kuaishou'].includes(body.platform)) return reject('监控平台不支持');
      const account = boundedText(body.account_id, 200), name = boundedText(body.account_name, 200);
      const result = await db.from('competitor_accounts').insert({ user_id: uid, platform: body.platform,
        account_id: account, account_name: name, category: body.category || '', last_crawled_at: null }).select('id').single();
      if (result.error) throw new Error('监控账号保存失败');
      return reply({ id: result.data.id, message: '账号已保存，采集需授权数据供应商' });
    }
    if (body.action === 'crawl_competitor') {
      return reject('尚未配置授权竞品数据供应商，无法采集账号指标', 424);
    }
    if (body.action === 'update_style_preference') {
      const preferences: Record<string, string[]> = {};
      for (const key of ['preferred_styles', 'preferred_tones', 'preferred_hooks', 'cta_patterns']) {
        const values = body[key] || [];
        if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== 'string' || value.length > 200)) return reject('偏好参数不正确');
        preferences[key] = values;
      }
      const result = await db.from('user_style_preferences').upsert({ user_id: uid, ...preferences, last_updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (result.error) throw new Error('偏好保存失败');
      return reply({ message: '个性化偏好已保存' });
    }
    if (body.action === 'generate_personalized_script') {
      const product = boundedText(body.product_name, 200);
      const pref = await db.from('user_style_preferences').select('*').eq('user_id', uid).maybeSingle();
      const history = await db.from('scripts').select('full_content').eq('user_id', uid).order('created_at', { ascending: false }).limit(3);
      const script = await generateText([
        { role: 'system', content: '依据商品事实和用户风格创作口播脚本。历史脚本仅参考文风，不沿用销量、优惠或功效。' },
        { role: 'user', content: JSON.stringify({ product, category: body.product_category, preferences: pref.data,
          history: history.data?.map(item => item.full_content?.slice(0, 1000)) }) },
      ]);
      return reply({ script, style_applied: !!pref.data });
    }
    return reject('未知操作');
  } catch (cause) { return reject(cause instanceof Error ? cause.message : '请求处理失败', 503); }
}
Deno.serve(handlePhase3);
