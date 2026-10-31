/**
 * P2-N04: 多语言视频脚本页
 * 文本翻译 + 多语言脚本管理
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Languages, Loader2, Sparkles, Copy, CheckCircle2, Globe, Trash2,
  ChevronRight, Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  { code: 'en', name: '英语', flag: '🇺🇸' },
  { code: 'ja', name: '日语', flag: '🇯🇵' },
  { code: 'ko', name: '韩语', flag: '🇰🇷' },
  { code: 'th', name: '泰语', flag: '🇹🇭' },
  { code: 'ar', name: '阿拉伯语', flag: '🇸🇦' },
  { code: 'fr', name: '法语', flag: '🇫🇷' },
  { code: 'de', name: '德语', flag: '🇩🇪' },
];

interface MultiLangScript {
  id: string;
  target_language: string;
  original_text: string;
  translated_text: string | null;
  status: string;
  created_at: string;
}

function LangBadge({ code }: { code: string }) {
  const lang = LANGUAGES.find(l => l.code === code);
  return <span className="text-base">{lang?.flag ?? '🌐'}</span>;
}

export default function MultiLangPage() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState('');
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<MultiLangScript[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [activeTab, setActiveTab] = useState<'translate' | 'history'>('translate');
  const [multiTargets, setMultiTargets] = useState<string[]>(['en', 'ja']);
  const [batchResults, setBatchResults] = useState<Record<string, string>>({});
  const [batchTranslating, setBatchTranslating] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from('multilang_scripts')
      .select('id, target_language, original_text, translated_text, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setHistory(Array.isArray(data) ? (data as MultiLangScript[]) : []);
    setLoadingHistory(false);
  }, [user]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleTranslate = async () => {
    if (!text.trim()) { toast.error('请输入要翻译的脚本'); return; }
    setTranslating(true);
    setTranslated('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'translate_script', text, target_language: targetLang, source_language: 'zh', user_id: user?.id ?? '' },
      });
      if (error) throw error;
      const result = data?.data ?? data;
      setTranslated(result?.translated ?? '');
      toast.success('翻译完成');
      loadHistory();
    } catch (e) {
      toast.error('翻译失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setTranslating(false);
    }
  };

  const handleBatchTranslate = async () => {
    if (!text.trim()) { toast.error('请输入要翻译的脚本'); return; }
    if (multiTargets.length === 0) { toast.error('请至少选择一个目标语言'); return; }
    setBatchTranslating(true);
    setBatchResults({});
    try {
      const results: Record<string, string> = {};
      for (const lang of multiTargets) {
        const { data } = await supabase.functions.invoke('ai-assistant', {
          body: { action: 'translate_script', text, target_language: lang, source_language: 'zh', user_id: user?.id ?? '' },
        });
        const result = data?.data ?? data;
        results[lang] = result?.translated ?? '';
      }
      setBatchResults(results);
      toast.success(`已翻译为 ${multiTargets.length} 种语言`);
      loadHistory();
    } catch (e) {
      toast.error('批量翻译失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setBatchTranslating(false);
    }
  };

  const copyText = async (t: string) => {
    await navigator.clipboard.writeText(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success('已复制到剪贴板');
  };

  const deleteHistory = async (id: string) => {
    await supabase.from('multilang_scripts').delete().eq('id', id);
    setHistory(h => h.filter(s => s.id !== id));
    toast.success('已删除');
  };

  const toggleMultiTarget = (code: string) => {
    setMultiTargets(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页头 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
            <Languages className="w-5 h-5 text-primary shrink-0" />多语言视频脚本
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            一键将中文脚本翻译为多语言版本，出海无障碍
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs gap-1 border-primary/40 text-primary">
          <Globe className="w-3 h-3" />P2-N04
        </Badge>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 border-b">
        {(['translate', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t === 'translate' ? '翻译工作台' : '历史记录'}
          </button>
        ))}
      </div>

      {activeTab === 'translate' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左：输入 */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-balance">原文（中文）</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  placeholder="粘贴中文脚本或口播台词…"
                  className="min-h-[200px] resize-none text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1.5">{text.length} 字符</p>
              </CardContent>
            </Card>

            {/* 单语言翻译 */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div>
                  <Label className="text-sm font-normal mb-1.5 block">目标语言</Label>
                  <Select value={targetLang} onValueChange={setTargetLang}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.flag} {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleTranslate} disabled={translating || !text.trim()} className="w-full">
                  {translating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  {translating ? '翻译中…' : '翻译'}
                </Button>
              </CardContent>
            </Card>

            {/* 批量翻译 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-balance">批量翻译</CardTitle>
                <CardDescription className="text-xs">同时翻译为多种语言</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {LANGUAGES.map(l => (
                    <button
                      key={l.code}
                      onClick={() => toggleMultiTarget(l.code)}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all',
                        multiTargets.includes(l.code)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border hover:bg-muted'
                      )}
                    >
                      {l.flag} {l.name}
                    </button>
                  ))}
                </div>
                <Button variant="outline" onClick={handleBatchTranslate} disabled={batchTranslating || !text.trim() || multiTargets.length === 0} className="w-full">
                  {batchTranslating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />}
                  批量翻译 {multiTargets.length > 0 ? `(${multiTargets.length}种)` : ''}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* 右：结果 */}
          <div className="space-y-4">
            {/* 单语言结果 */}
            {translated && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2 text-balance">
                      <LangBadge code={targetLang} />
                      翻译结果（{LANGUAGES.find(l => l.code === targetLang)?.name}）
                    </CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyText(translated)}>
                      {copied ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Textarea value={translated} readOnly className="min-h-[200px] resize-none text-sm bg-muted/30" />
                </CardContent>
              </Card>
            )}

            {/* 批量结果 */}
            {Object.entries(batchResults).map(([lang, result]) => {
              const langInfo = LANGUAGES.find(l => l.code === lang);
              return (
                <Card key={lang}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-balance">
                        <span>{langInfo?.flag}</span>{langInfo?.name}
                      </CardTitle>
                      <Button size="sm" variant="ghost" onClick={() => copyText(result)}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-pretty leading-relaxed whitespace-pre-wrap">{result}</p>
                  </CardContent>
                </Card>
              );
            })}

            {!translated && Object.keys(batchResults).length === 0 && !translating && !batchTranslating && (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-3 border rounded-lg border-dashed">
                <Languages className="w-10 h-10 opacity-30" />
                <p>翻译结果将在这里显示</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <Card>
          <CardContent className="pt-4">
            {loadingHistory ? (
              <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 bg-muted" />)}</div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                暂无翻译历史
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(item => {
                  const langInfo = LANGUAGES.find(l => l.code === item.target_language);
                  return (
                    <div key={item.id} className="p-3 border rounded-lg flex items-start gap-3 hover:bg-muted/30 transition-colors">
                      <span className="text-2xl shrink-0">{langInfo?.flag ?? '🌐'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">{langInfo?.name ?? item.target_language}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{item.original_text.slice(0, 60)}…</p>
                        {item.translated_text && (
                          <p className="text-sm truncate mt-0.5">{item.translated_text.slice(0, 60)}…</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyText(item.translated_text ?? '')}>
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteHistory(item.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
