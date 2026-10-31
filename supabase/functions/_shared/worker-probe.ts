import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function workerProbe(db: SupabaseClient, action: string): Promise<Response> {
  const capability = action === 'probe' || action === 'capabilities';
  const response = await db.rpc(capability ? 'worker_capabilities' : 'worker_runtime_ready');
  if (response.error && Deno.env.get('SELF_HOSTED_BACKEND_ORIGIN')) {
    console.error('Worker probe failed', response.error.message);
  }
  const data = capability ? response.data : { ready: response.data === true };
  const ready = !response.error && data?.ready === true;
  const source = Deno.env.get('RELEASE_SOURCE_SHA256');
  if (capability && data && source && /^[0-9a-f]{64}$/.test(source)) data.source_sha256 = source;
  return Response.json(response.error ? { ready: false, missing: ['database_or_schema'] } : data,
    { status: ready ? 200 : 503 });
}
