import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { displayMedia } from '@/lib/mediaDisplay';

export interface RecentWork {
  id: string; name: string; category: string; url: string; cover: string; prompt: string;
  model: string; ratio: string; duration: string; refImage: string; firstLast: string; language: string;
}
export function useRecentWorks(userId?: string) {
  const [items, setItems] = useState<RecentWork[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const active = useRef(true), sequence = useRef(0);
  const reload = useCallback(async () => {
    const run = ++sequence.current;
    if (!userId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await supabase.from('video_projects').select('*,product:products(category)')
        .eq('user_id', userId).eq('status', 'completed').not('video_url', 'is', null)
        .order('created_at', { ascending: false }).order('id').limit(40);
      if (result.error) throw new Error('最近作品读取失败，请重试');
      if (!active.current || run !== sequence.current) return;
      const validUrl = (url: unknown): url is string => typeof url === 'string' && !!displayMedia(url);
      setItems((result.data || []).filter(row => validUrl(row.video_url)).map(row => ({
        id: row.id, name: row.title || '未命名作品', prompt: row.prompt_text || '',
        category: row.product?.category || '未分类', model: row.video_style || '未记录',
        ratio: row.aspect_ratio || '未记录', duration: row.duration ? `${row.duration}s` : '未记录',
        url: row.video_url!, cover: validUrl(row.thumbnail_url) ? row.thumbnail_url : '',
        refImage: '未记录', firstLast: '未记录', language: '未记录',
      })));
      setError('');
    } catch (cause) { if (active.current && run === sequence.current) setError(cause instanceof Error ? cause.message : '作品读取失败'); }
    finally { if (active.current && run === sequence.current) setLoading(false); }
  }, [userId]);
  useEffect(() => {
    active.current = true; setItems([]); void reload();
    window.addEventListener('shopro:works-updated', reload);
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', visible);
    return () => { active.current = false; sequence.current++; window.removeEventListener('shopro:works-updated', reload); window.removeEventListener('focus', visible); };
  }, [reload]);
  return { items, loading, error, reload };
}
