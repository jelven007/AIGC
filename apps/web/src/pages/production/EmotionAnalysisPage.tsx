import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/db/supabase';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Loader2 } from 'lucide-react';
export interface EmotionSegment {
  index: number; text: string; emotion: string; intensity: number; color: string; suggestion: string;
}
const labels: Record<string, string> = { hook: '开场钩子', pain_point: '痛点共鸣', product_intro: '产品介绍',
  social_proof: '社会证明', promotion: '促销', cta: '行动号召', neutral: '中性叙述' };
export default function EmotionAnalysisPage({ initialText = '' }: { initialText?: string }) {
  const { user } = useAuth(), navigate = useNavigate();
  const [text, setText] = useState(initialText), [segments, setSegments] = useState<EmotionSegment[]>([]);
  const [analyzing, setAnalyzing] = useState(false), [error, setError] = useState(''), [analyzedText, setAnalyzedText] = useState('');
  const analyze = async () => {
    if (!user || analyzing || !text.trim()) return;
    setAnalyzing(true); setError(''); setSegments([]);
    try {
      const { data, error: failure } = await supabase.functions.invoke('ai-assistant', { body: { action: 'emotion_analysis', text } });
      if (failure) {
        const details = failure.context instanceof Response ? await failure.context.json().catch(() => null) : null;
        throw new Error(details?.message || failure.message);
      }
      if (data?.code !== 0 || !Array.isArray(data.data?.segments) || !data.data.segments.length) throw new Error(data?.message || '没有返回句子分析结果');
      setSegments(data.data.segments); setAnalyzedText(text);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分析失败，请重试'); }
    finally { setAnalyzing(false); }
  };
  const apply = (path: string, field: string) => navigate(path, { state: { [field]: analyzedText } });
  return <div className="p-4 md:p-6 space-y-6">
    <PageHeader title="口播台词优化" description="模型依据每句原文给出情绪类型、表达强度与口播建议。" />
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    <div className="grid lg:grid-cols-2 gap-6">
      <form className="rounded-xl border p-4 space-y-4" onSubmit={event => { event.preventDefault(); void analyze(); }}>
        <label className="block text-sm space-y-2">口播脚本<Textarea aria-label="口播脚本" rows={10} maxLength={12000} value={text}
          onChange={event => { setText(event.target.value); setSegments([]); }} placeholder="粘贴需要分析的脚本正文" disabled={analyzing} /></label>
        <Button type="submit" disabled={analyzing || !user || !text.trim()}>{analyzing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}开始情绪分析</Button>
      </form>
      <section aria-label="口播分析结果" aria-live="polite" className="rounded-xl border p-4 space-y-3">
        <h2 className="font-semibold">逐句口播建议</h2>
        {!segments.length && <p className="text-sm text-muted-foreground">{analyzing ? '正在分析原文…' : '提交脚本后查看分析。'}</p>}
        {segments.map(segment => <article key={segment.index} className="rounded-lg bg-muted/40 p-3 space-y-2">
          <div className="flex justify-between gap-2 text-xs"><span>{segment.index + 1} · {labels[segment.emotion]}</span>
            <span>表达强度 {segment.intensity}/100</span></div>
          <Progress value={segment.intensity} /><p className="text-sm break-words">{segment.text}</p>
          <p className="text-xs text-muted-foreground break-words">{segment.suggestion}</p>
        </article>)}
      </section>
    </div>
    {!!segments.length && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">表达强度为模型编辑建议。可将原文带入创作，再按上述建议调整口播。</p>
      <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => apply('/avatars', 'text')}>带入语音与数字人</Button>
        <Button variant="outline" onClick={() => apply('/script', 'prompt')}>带入脚本</Button>
        <Button onClick={() => apply('/video/create', 'prompt')}>带入视频创作</Button></div>
    </div>}
  </div>;
}
