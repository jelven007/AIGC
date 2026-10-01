import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Sparkles, CheckCircle2, Gift, Play, Zap, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  title: string;
  description: string;
  type: string;
  reward_credits: number;
  max_times: number;
}

interface UserActivity {
  activity_id: string;
  completed_times: number;
  status: string;
}

export default function ActivitiesPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [userActivities, setUserActivities] = useState<Record<string, UserActivity>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [{ data: actData }, { data: userActData }] = await Promise.all([
        supabase.from('activities').select('*').eq('status', 'active').order('created_at'),
        supabase.from('user_activities').select('*').eq('user_id', user.id)
      ]);
      
      setActivities((actData || []) as Activity[]);
      
      const uaMap: Record<string, UserActivity> = {};
      (userActData || []).forEach((ua: any) => {
        uaMap[ua.activity_id] = ua;
      });
      setUserActivities(uaMap);
    } catch (err: any) {
      toast.error('加载活动数据失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleClaim = async (activity: Activity) => {
    if (!user) {
      toast.error('请先登录');
      return;
    }
    setProcessing(activity.id);
    try {
      const ua = userActivities[activity.id] || { completed_times: 0 };

      // 1) 更新用户活动记录
      const { error: uaError } = await supabase.from('user_activities').upsert({
        user_id: user.id,
        activity_id: activity.id,
        completed_times: ua.completed_times + 1,
        status: 'completed',
      }, { onConflict: 'user_id, activity_id' });

      if (uaError) throw uaError;

      // 2) 查询用户套餐 —— 使用 maybeSingle 避免无记录时报错
      const { data: planData } = await supabase.from('user_plans')
        .select('credits_used, credits_total')
        .eq('user_id', user.id)
        .maybeSingle();

      let creditsAfter = activity.reward_credits;

      if (!planData) {
        // 用户无套餐记录，创建默认免费版并写入奖励积分
        const now = new Date().toISOString();
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const { error: insertErr } = await supabase.from('user_plans').insert({
          user_id: user.id,
          plan_id: '8165825b-21c8-4fce-8764-2764457bcd52',
          credits_total: 50 + activity.reward_credits,
          credits_used: 0,
          cycle_start: now,
          cycle_end: nextMonth.toISOString(),
          status: 'active',
        });

        if (insertErr) throw insertErr;
        creditsAfter = 50 + activity.reward_credits;
      } else {
        // 减少已使用量 = 增加可用积分
        const newUsed = Math.max(0, (planData.credits_used || 0) - activity.reward_credits);
        creditsAfter = (planData.credits_total || 0) - newUsed;

        const { error: updateErr } = await supabase.from('user_plans')
          .update({ credits_used: newUsed })
          .eq('user_id', user.id);

        if (updateErr) throw updateErr;
      }

      // 3) 写入积分流水
      const { error: logErr } = await supabase.from('credit_logs').insert({
        user_id: user.id,
        type: 'bonus',
        amount: activity.reward_credits,
        description: `完成活动：${activity.title}`,
      });

      if (logErr) throw logErr;

      toast.success(`恭喜！获得 ${activity.reward_credits} 积分奖励`);
      await loadData();
    } catch (err: any) {
      toast.error('领取失败：' + (err.message || '请稍后重试'));
      console.error('活动领取错误:', err);
    } finally {
      setProcessing(null);
    }
  };

  const getIcon = (type: string) => {
    switch(type) {
      case 'login_first': return <Sparkles className="w-5 h-5" />;
      case 'video_first': return <Play className="w-5 h-5" />;
      case 'daily_checkin': return <CheckCircle2 className="w-5 h-5" />;
      case 'join_community': return <UserPlus className="w-5 h-5" />;
      default: return <Gift className="w-5 h-5" />;
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
          <Sparkles className="w-5 h-5 text-primary" />活动奖励
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">完成专属任务，免费获取更多视频生成积分</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {activities.map(act => {
          const ua = userActivities[act.id];
          const isCompleted = ua?.status === 'completed' && (act.max_times === 1 || (ua.completed_times >= act.max_times && act.max_times > 0));
          
          return (
            <Card key={act.id} className={cn("overflow-hidden transition-all", isCompleted ? "opacity-70 bg-muted/30" : "hover:shadow-md hover:border-primary/40")}>
              <CardContent className="p-5 flex flex-col h-full">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", 
                      isCompleted ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
                      {getIcon(act.type)}
                    </div>
                    <div>
                      <h3 className="font-bold text-base line-clamp-1">{act.title}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Zap className="w-3.5 h-3.5 text-warning" />
                        <span className="text-sm font-semibold text-warning">+{act.reward_credits} 积分</span>
                      </div>
                    </div>
                  </div>
                  {isCompleted && <Badge variant="secondary">已完成</Badge>}
                </div>
                
                <p className="text-sm text-muted-foreground flex-1 mb-6 text-pretty">{act.description}</p>
                
                <Button 
                  className={cn("w-full h-10", isCompleted ? "" : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border-0")}
                  variant={isCompleted ? "outline" : "outline"}
                  disabled={isCompleted || processing === act.id}
                  onClick={() => handleClaim(act)}
                >
                  {processing === act.id ? "领取中..." : isCompleted ? "已领取" : "去完成并领取"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}