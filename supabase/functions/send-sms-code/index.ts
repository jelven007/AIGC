import { getCorsHeaders, handleCorsPreflight } from '../_shared/cors.ts';
Deno.serve((req: Request) => handleCorsPreflight(req) || Response.json({
  error: '旧短信网关已停用，请使用 Supabase Auth signInWithOtp',
}, { status: 410, headers: getCorsHeaders(req) }));
