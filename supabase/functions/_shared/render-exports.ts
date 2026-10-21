import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { publicProductionJob, type ProductionJob } from './production-jobs.ts';

export const EXPORT_RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4', '4:5'] as const;
export function exportRequest(raw: Record<string, any>) {
  if (typeof raw.source_project_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.source_project_id)
    || !Array.isArray(raw.formats) || raw.formats.length < 1 || raw.formats.length > 18) {
    throw new Error('请选择作品和1–18种输出规格');
  }
  const seen = new Set<string>();
  const formats = raw.formats.map((format: any) => {
    if (!format || !EXPORT_RATIOS.includes(format.ratio) || ![720, 1080, 2160].includes(format.height)) {
      throw new Error('输出规格不支持');
    }
    const key = `${format.ratio}/${format.height}`;
    if (seen.has(key)) throw new Error('不能重复选择同一规格');
    seen.add(key);
    return { ratio: format.ratio as string, height: format.height as number };
  }).sort((a, b) => a.ratio.localeCompare(b.ratio) || a.height - b.height);
  return { source_project_id: raw.source_project_id.toLowerCase(), formats };
}
export async function publicRenderExport(db: SupabaseClient, group: Record<string, any>) {
  const { data, error } = await db.from('production_jobs').select('*')
    .eq('user_id', group.user_id).eq('export_id', group.id).order('created_at', { ascending: true });
  if (error || !data?.length) throw new Error('导出任务查询失败，请保留原请求标识');
  const jobs = await Promise.all((data as ProductionJob[]).map(async job => ({
    ...await publicProductionJob(db, job), title: job.payload.title,
    output_ratio: job.payload.ratio, output_height: job.payload.height,
  })));
  const finished = jobs.filter(job => ['completed', 'failed', 'cancelled'].includes(job.status));
  const completed = jobs.filter(job => job.status === 'completed').length;
  const status = finished.length === jobs.length ? completed === jobs.length ? 'completed' : completed ? 'partial' : 'failed'
    : jobs.some(job => job.status === 'unknown') ? 'attention' : 'processing';
  return { id: group.id, request_key: group.request_key, source_project_id: group.source_project_id,
    title: group.source_title, created_at: group.created_at, status, completed_count: completed, total_count: jobs.length,
    progress: Math.round(jobs.reduce((total, job) => total + (['failed', 'cancelled'].includes(job.status) ? 100 : job.progress), 0) / jobs.length),
    jobs };
}
