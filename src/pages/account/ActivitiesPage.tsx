import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { assertRewardSession, fetchActivities, claimReward, clearRewardRequest, readPendingRewards,
  reserveRewardRequest, eligibilityLabels, type RewardActivity } from '@/api/rewards';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Sparkles, CheckCircle2, Gift, Play, Zap, UserPlus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ActivitiesPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<RewardActivity[]>([]);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const [pending, setPending] = useState(() => user ? readPendingRewards(user.id) : []);
  const mounted = useRef(false);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const loadData = useCallback(async () => {
    if (!user) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      await assertRewardSession(user.id);
      const rows = await fetchActivities(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (!mounted.current || controller.signal.aborted) return;
      setActivities(rows); setError('');
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '活动数据读取失败，请重试');
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, [user]);
  useEffect(() => {
    mounted.current = true;
    void loadData();
    return () => { mounted.current = false; request.current?.abort(); };
  }, [loadData]);

  const handleClaim = async (activity: RewardActivity) => {
    if (!user || busy.current) return;
    busy.current = true; setProcessing(activity.id);
    try {
      await assertRewardSession(user.id);
      if (!mounted.current) return;
      const original = reserveRewardRequest(user.id, activity);
      setPending(readPendingRewards(user.id));
      const receipt = await claimReward(user.id, activity.id, original.key);
      if (!mounted.current) return;
      await assertRewardSession(user.id);
      if (!mounted.current) return;
      // 本地存储失败不改变已经确认的数据库结果；留存同一回执仍可安全重试。
      try { clearRewardRequest(user.id, original.key); } catch {}
      setPending(readPendingRewards(user.id));
      setActivities(rows => rows.map(row => row.id === activity.id ? { ...row,
        eligibility: row.type === 'daily_checkin' ? 'claimed_today' : 'completed' } : row));
      window.dispatchEvent(new CustomEvent('credits_changed'));
      toast.success(receipt.already_claimed ? `原领取已确认：${receipt.reward} 积分已入账` : `已获得 ${receipt.reward} 积分奖励`);
      await loadData();
    } catch (cause) {
      if (mounted.current) toast.error(cause instanceof Error ? cause.message : '领取结果尚未确认，请恢复原请求');
    } finally {
      busy.current = false;
      if (mounted.current) setProcessing(null);
    }
  };
  const iconFor = (type: string) => type === 'login_first' ? Sparkles : type === 'video_first' ? Play
    : type === 'daily_checkin' ? CheckCircle2 : type === 'join_community' ? UserPlus : Gift;
  const missing = pending.filter(item => !activities.some(row => row.id === item.activityId));
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />活动奖励</h1>
          <p className="text-sm text-muted-foreground mt-1">完成任务后领取积分。每日签到按 UTC 零点更新。</p>
        </div>
        <Button variant="outline" size="sm" disabled={loading || !!processing} onClick={() => void loadData()}>
          <RefreshCw className="w-4 h-4 mr-1" />刷新活动
        </Button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
        {error} {activities.length > 0 && '当前显示上次成功读取的数据。'}
      </div>}
      {loading && <p role="status" className="text-sm text-muted-foreground">正在读取活动资格…</p>}
      {!loading && !error && !activities.length && <Card><CardContent className="p-8 text-center text-muted-foreground">
        当前没有开放的活动，请稍后再来。
      </CardContent></Card>}
      {missing.map(item => <div key={item.key} className="rounded-lg border p-4 text-sm flex flex-wrap items-center gap-3">
        <span className="break-words">待确认领取：{item.title}</span>
        <Button variant="outline" disabled={!!processing} onClick={() => void handleClaim({
          id: item.activityId, title: item.title, description: null, type: '', reward_credits: 0,
          max_times: 1, completed_times: 0, eligibility: '', next_claim_at: null,
        })}>恢复原领取</Button>
      </div>)}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activities.map(activity => {
          const Icon = iconFor(activity.type);
          const completed = ['completed', 'claimed_today'].includes(activity.eligibility);
          const recovering = pending.some(item => item.activityId === activity.id);
          const eligible = activity.eligibility === 'eligible';
          return <Card key={activity.id} className={cn("min-w-0", completed && "bg-muted/30")}>
            <CardContent className="p-5 flex flex-col h-full">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
                  <div className="min-w-0">
                    <h2 className="font-bold text-base break-words">{activity.title}</h2>
                    <div className="flex items-center gap-1.5 mt-1 text-warning">
                      <Zap className="w-3.5 h-3.5" /><span className="text-sm font-semibold">+{activity.reward_credits} 积分</span>
                    </div>
                  </div>
                </div>
                {completed && <Badge variant="secondary" className="shrink-0">已领取</Badge>}
              </div>
              <p className="text-sm text-muted-foreground flex-1 mb-3 break-words">{activity.description}</p>
              <p className="text-xs text-muted-foreground mb-4">
                已领取 {activity.completed_times} 次{activity.max_times && activity.max_times > 0 ? ` / ${activity.max_times} 次` : ''}
                {activity.type === 'daily_checkin' && activity.eligibility === 'claimed_today' && activity.next_claim_at &&
                  ` · 下次 ${new Date(activity.next_claim_at).toLocaleString()}（本地时间）`}
              </p>
              {activity.eligibility === 'video_required' && <Button asChild variant="outline" className="mb-2"><Link to="/video/create">去生成视频</Link></Button>}
              {['evidence_required', 'legacy_review', 'missing_plan'].includes(activity.eligibility) &&
                <Link to="/support" className="text-sm text-primary underline mb-3">联系支持核对</Link>}
              <Button variant="outline" className="w-full h-auto min-h-10 whitespace-normal"
                disabled={loading || !!error || !!processing || (!recovering && !eligible)}
                onClick={() => void handleClaim(activity)}>
                {processing === activity.id ? '领取中…' : recovering ? '恢复原领取'
                  : eligibilityLabels[activity.eligibility] || '活动暂不可领取'}
              </Button>
            </CardContent>
          </Card>;
        })}
      </div>
    </div>
  );
}
