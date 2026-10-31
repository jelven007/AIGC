import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plan, CreditLog } from '@/types/types';
import { useCredits } from '@/hooks/useCredits';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  CreditCard, Zap, CheckCircle2, ArrowUpCircle,
  Loader2, TrendingDown, TrendingUp, AlertCircle,
  Wallet, ClipboardList, Gift
} from 'lucide-react';
import { cn } from '@/lib/utils';
import PaymentDialog from '@/components/common/PaymentDialog';
import { readPendingCheckout } from '@/api/checkout';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import InvitePage from '@/pages/account/InvitePage';

// ── 常量 ──────────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  video_generate:   { label: '视频生成',   cls: 'bg-primary/10 text-primary' },
  template_download:{ label: '模板下载',   cls: 'bg-info/10 text-info' },
  material_upload:  { label: '素材上传',   cls: 'bg-warning/10 text-warning' },
  purchase:         { label: '套餐购买',   cls: 'bg-success/10 text-success' },
  plan_purchase:    { label: '套餐开通',   cls: 'bg-success/10 text-success' },
  booster_purchase: { label: '加油包购买', cls: 'bg-success/10 text-success' },
  refund:           { label: '退款',       cls: 'bg-success/10 text-success' },
  bonus:            { label: '赠送积分',   cls: 'bg-success/10 text-success' },
  deduct:           { label: '扣除',       cls: 'bg-destructive/10 text-destructive' },
};

const PLAN_COLORS = [
  'border-border',
  'border-info/50 bg-info/5',
  'border-primary/60 bg-primary/5',
  'border-warning/50 bg-warning/5',
];

// ── 格式化时间 ────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  try { return format(new Date(d), 'MM-dd HH:mm', { locale: zhCN }); } catch { return d; }
}

// ── 套餐卡片 ─────────────────────────────────────────────────────────────
function PlanCard({ plan, isCurrent, onSelect, idx }: {
  plan: Plan; isCurrent: boolean; onSelect: (p: Plan) => void; idx: number;
}) {
  const colorCls = PLAN_COLORS[idx % 4];
  return (
    <Card className={cn('h-full flex flex-col relative overflow-hidden border-2 transition-all hover:-translate-y-1 hover:shadow-lg',
      isCurrent ? 'border-primary shadow-md' : colorCls,
      plan.is_popular && !isCurrent && 'border-primary/60'
    )}>
      {plan.is_popular && (
        <div className="absolute top-0 left-0 right-0 bg-primary text-primary-foreground text-xs text-center py-1 font-semibold tracking-wider">
          🔥 最受欢迎
        </div>
      )}
      {isCurrent && (
        <div className="absolute top-3 right-3">
          <Badge variant="default" className="text-xs bg-success text-success-foreground hover:bg-success">当前生效</Badge>
        </div>
      )}
      <CardHeader className={cn('pb-4', plan.is_popular && 'pt-8')}>
        <CardTitle className="text-base">{plan.name}</CardTitle>
      </CardHeader>
      
      <CardContent className="flex flex-col flex-1 pb-4">
        <div className="mb-6">
          <div className="flex items-end gap-1">
            {Number(plan.price) === 0
              ? <span className="text-4xl font-extrabold tracking-tight">免费</span>
              : <>
                  <span className="text-2xl font-semibold text-muted-foreground pb-1">¥</span>
                  <span className="text-4xl font-extrabold tracking-tight">{plan.price}</span>
                  <span className="text-base font-normal text-muted-foreground pb-1">/月</span>
                </>
            }
          </div>
          <p className="text-sm font-medium text-primary mt-2 flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />
            {Number(plan.price) === 0 ? '注册赠送' : '套餐包含'} {plan.credits.toLocaleString()} 积分
          </p>
        </div>

        <div className="space-y-3 flex-1 mb-6">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">核心权益</p>
          <ul className="space-y-2.5">
            {(Array.isArray(plan.features) ? plan.features : []).map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span className="text-muted-foreground leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <CardFooter className="pt-0 mt-auto">
        <Button
          className={cn('w-full h-11 font-semibold rounded-lg', isCurrent ? 'opacity-60 cursor-not-allowed' : '')}
          variant={isCurrent ? 'outline' : plan.is_popular ? 'default' : 'secondary'}
          disabled={isCurrent || Number(plan.price) === 0}
          onClick={() => !isCurrent && onSelect(plan)}
        >
          {isCurrent ? '当前使用中' : Number(plan.price) === 0 ? '注册基础权益' : '选择套餐'}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────
export default function CreditsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const activeTab = ['plans', 'overview', 'invite', 'logs', 'orders'].includes(params.get('tab') || '')
    ? params.get('tab')! : 'plans';
  const handleTabChange = (val: string) => setParams({ tab: val }, { replace: true });
  const client = useQueryClient();
  const credits = useCredits();
  const [logType, setLogType] = useState('all');
  const [page, setPage] = useState(0);
  const [orderPage, setOrderPage] = useState(0);
  const PAGE_SIZE = 10;
  const planQuery = useQuery({
    queryKey: ['billing', user?.id, 'plans'], enabled: !!user, retry: 1,
    queryFn: async ({ signal }) => {
      const catalog = await supabase.from('plans').select('*').order('level', { ascending: true })
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15000)]));
      if (catalog.error) throw new Error('套餐目录读取失败，请重试');
      const all = ((catalog.data || []) as Plan[]).map(p => ({ ...p, price: Number(p.price) }));
      return { plans: all.filter(p => p.level >= 0 && (p.level === 0 || p.price > 0)), boosters: all.filter(p => p.level < 0 && p.price > 0) };
    },
  });
  const logsQuery = useQuery({
    queryKey: ['billing', user?.id, 'logs', page, logType], enabled: !!user && activeTab === 'logs', retry: 1,
    queryFn: async ({ signal }) => {
      let q = supabase.from('credit_logs').select('*', { count: 'exact' }).eq('user_id', user!.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15000)]));
      if (['plan_purchase', 'booster_purchase'].includes(logType)) q = q.eq('action', logType);
      else if (logType !== 'all') q = q.eq('type', logType);
      const result = await q;
      if (result.error) throw new Error('积分流水读取失败，请重试');
      return { logs: (result.data || []) as CreditLog[], total: result.count || 0 };
    },
  });
  const ordersQuery = useQuery({
    queryKey: ['billing', user?.id, 'orders', orderPage], enabled: !!user && activeTab === 'orders', retry: 1,
    queryFn: async ({ signal }) => {
      const result = await supabase.from('orders')
        .select('id,order_no,status,total_amount,pay_channel,plan_snapshot,created_at', { count: 'exact' })
        .eq('user_id', user!.id).order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(orderPage * PAGE_SIZE, (orderPage + 1) * PAGE_SIZE - 1)
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(15000)]));
      if (result.error) throw new Error('订单记录读取失败，请重试');
      return { orders: result.data || [], total: result.count || 0 };
    },
  });
  const { plans = [], boosters = [] } = planQuery.data || {};
  const info = credits.data;
  const userPlan = info ? { plan_id: info.planId, credits_total: info.total, credits_used: info.used,
    cycle_start: info.cycleStart, cycle_end: info.cycleEnd, status: info.status, plan: { name: info.planName } } : null;
  const loadingPlan = credits.loading;
  const loadingLogs = logsQuery.isPending;
  const logs = logsQuery.data?.logs || [];
  useEffect(() => {
    if (logsQuery.data) setPage(p => Math.min(p, Math.max(0, Math.ceil(logsQuery.data.total / PAGE_SIZE) - 1)));
  }, [logsQuery.data]);
  useEffect(() => {
    if (ordersQuery.data) setOrderPage(p => Math.min(p, Math.max(0, Math.ceil(ordersQuery.data.total / PAGE_SIZE) - 1)));
  }, [ordersQuery.data]);
  const refreshBilling = useCallback(() => { void client.invalidateQueries({ queryKey: ['billing', user?.id] }); }, [client, user?.id]);
  useEffect(() => {
    window.addEventListener('credits_changed', refreshBilling);
    return () => window.removeEventListener('credits_changed', refreshBilling);
  }, [refreshBilling]);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const handleSelectPlan = (plan: Plan) => {
    if (credits.loading || credits.error) return;
    setSelectedPlan(plan); setPayModalOpen(true);
  };
  const hasPending = user ? !!readPendingCheckout(user.id) : false;
  useEffect(() => { setPage(0); setOrderPage(0); setPayModalOpen(false); setSelectedPlan(null); }, [user?.id]);

  // 积分使用率
  const usagePercent = credits.usagePercent;
  const creditsLeft = credits.creditsLeft;

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* 页头 */}
      <PageHeader title="积分与套餐" description="管理您的套餐订阅和积分使用情况" actions={
        <Button variant="outline" disabled={credits.refreshing}
          onClick={() => { refreshBilling(); void credits.refresh(); }}>刷新余额与权益</Button>
      } />
      {planQuery.error && <div role="alert" className="text-sm text-destructive flex flex-wrap gap-3 items-center">
        {planQuery.error.message}<Button variant="outline" onClick={() => void planQuery.refetch()}>重试套餐读取</Button>
      </div>}
      {credits.error && <div role="alert" className="text-sm text-destructive flex flex-wrap gap-3 items-center">
        {credits.error}<Button variant="outline" disabled={credits.refreshing} onClick={() => void credits.refresh()}>重试余额读取</Button>
      </div>}
      {hasPending && <Button variant="outline" onClick={() => { setSelectedPlan(null); setPayModalOpen(true); }}>恢复原支付请求</Button>}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3 w-full max-w-5xl bg-transparent h-auto p-0 mb-6">
          <TabsTrigger
            value="invite"
            className="h-11 rounded-lg border border-border bg-card text-muted-foreground text-xs sm:text-sm px-3 gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=inactive]:hover:bg-accent"
          >
            <Gift className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">邀请有礼 · 赚取积分</span>
          </TabsTrigger>
          <TabsTrigger
            value="plans"
            id="tab-plans"
            className="h-11 rounded-lg border border-border bg-card text-muted-foreground text-xs sm:text-sm px-3 gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=inactive]:hover:bg-accent"
          >
            <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">套餐对比 · 尊享特权</span>
          </TabsTrigger>
          <TabsTrigger
            value="overview"
            className="h-11 rounded-lg border border-border bg-card text-muted-foreground text-xs sm:text-sm px-3 gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=inactive]:hover:bg-accent"
          >
            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">套餐概览 · 我的资产</span>
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="h-11 rounded-lg border border-border bg-card text-muted-foreground text-xs sm:text-sm px-3 gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=inactive]:hover:bg-accent"
          >
            <ClipboardList className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">积分记录 · 收支明细</span>
          </TabsTrigger>
          <TabsTrigger value="orders" className="h-11 rounded-lg border border-border bg-card text-muted-foreground text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary data-[state=inactive]:hover:bg-accent">订单记录</TabsTrigger>
        </TabsList>

        {/* ── 概览 Tab ── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          {loadingPlan ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : credits.error ? <p className="py-12 text-center text-sm text-muted-foreground">余额和当前权益暂不可用，请重试读取。</p> : !userPlan ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertCircle className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">暂无套餐信息</p>
            </div>
          ) : (
            <>
              {/* 当前套餐卡片 */}
              <Card className="border-primary/30 bg-card overflow-hidden shadow-none">
                <CardContent className="p-4 sm:p-5 space-y-4">
                  {/* 第一行：标题 + 套餐状态 & 升级套餐按钮 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-primary/10 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm sm:text-base">当前套餐：{userPlan.plan?.name ?? '未知套餐'}</span>
                          <Badge className="text-[10px] px-1.5 py-0 border-none shrink-0" variant={credits.entitlementActive ? 'default' : 'secondary'}>
                            {credits.entitlementActive ? '生效中' : userPlan.status === 'cancelled' ? '已取消' : '已过期'}
                          </Badge>
                        </div>
                        {/* 周期信息小字 */}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {info?.configuredPlanLevel === 0 && !info.expiresAt ? '注册基础权益' :
                            `计费周期：${format(new Date(userPlan.cycle_start), 'yyyy/MM/dd')} ~ ${format(new Date(userPlan.cycle_end), 'yyyy/MM/dd')}`}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => document.getElementById('tab-plans')?.click()} className="h-9 text-xs font-medium shrink-0 self-start sm:self-center">
                      <ArrowUpCircle className="w-3.5 h-3.5 mr-1" />升级套餐
                    </Button>
                  </div>

                  {/* 第二行：积分使用情况进度条 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs sm:text-sm">
                      <span className="text-muted-foreground font-medium">积分使用情况</span>
                      <span className="font-semibold text-muted-foreground">
                        <span className="text-foreground text-sm font-bold">{userPlan.credits_used.toLocaleString()}</span> / {userPlan.credits_total.toLocaleString()}
                      </span>
                    </div>
                    <Progress value={usagePercent} className="h-2" />
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">已使用 {usagePercent}%</span>
                      <span className={cn('font-semibold', creditsLeft < 50 ? 'text-destructive' : 'text-success')}>
                        剩余 {creditsLeft.toLocaleString()} 积分
                      </span>
                    </div>
                  </div>

                  {creditsLeft < 100 && (
                    <div className="flex items-center gap-1.5 p-2 bg-warning/10 border border-warning/20 rounded-lg">
                      <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0" />
                      <p className="text-[11px] text-warning-foreground leading-none">积分余量不足，建议升级套餐或购买加油包</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 快速统计 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: '总积分', value: userPlan.credits_total.toLocaleString(), icon: Zap, color: 'text-primary' },
                  { label: '已使用', value: userPlan.credits_used.toLocaleString(), icon: TrendingDown, color: 'text-destructive' },
                  { label: '剩余积分', value: creditsLeft.toLocaleString(), icon: TrendingUp, color: 'text-success' },
                  { label: '使用率', value: `${usagePercent}%`, icon: CreditCard, color: 'text-info' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <Card key={label} className="h-full">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={cn('w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0')}>
                        <Icon className={cn('w-5 h-5', color)} />
                      </div>
                      <div>
                        <p className="text-lg font-bold">{value}</p>
                        <p className="text-xs text-muted-foreground">{label}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* 流量加油包 (交叉销售) */}
              <div className="mt-8">
                <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                  流量加油包
                </h3>
                {planQuery.isPending ? <p role="status" className="text-sm text-muted-foreground">正在读取积分加油包…</p>
                  : planQuery.error ? <p className="text-sm text-muted-foreground">加油包目录暂不可用，请重试套餐读取。</p>
                  : boosters.length === 0 ? <p className="text-sm text-muted-foreground">暂未配置积分加油包</p> : null}
                {!planQuery.error && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {boosters.map(b => (
                    <Card key={b.id} className="border border-border hover:border-primary/50 transition-all hover:-translate-y-1">
                      <CardHeader className="pb-3 text-center">
                        <CardTitle className="text-base">{b.name}</CardTitle>
                        <div className="mt-2 text-3xl font-bold text-primary">
                          <span className="text-lg">¥</span>{b.price}
                        </div>
                        <CardDescription>直接获得 {b.credits} 积分</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2 text-sm text-muted-foreground mb-4">
                          {Array.isArray(b.features) && b.features.map((f: string, i: number) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                      <CardFooter>
                        <Button className="w-full" variant="outline" onClick={() => handleSelectPlan(b)}>购买加油包</Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── 套餐对比 Tab ── */}
        <TabsContent value="plans" className="mt-4">
          {loadingPlan || planQuery.isPending ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : credits.error ? <p className="py-12 text-center text-sm text-muted-foreground">核验当前权益后可选择套餐。</p> :
            planQuery.error ? <p className="py-12 text-center text-sm text-muted-foreground">套餐目录暂不可用，请重试读取后选择套餐。</p> :
            !planQuery.error && plans.length === 0 ? <p className="py-12 text-center text-muted-foreground">暂无可购买套餐</p> : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {plans.map((plan, idx) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  idx={idx}
                  isCurrent={credits.entitlementActive && userPlan?.plan_id === plan.id}
                  onSelect={handleSelectPlan}
                />
              ))}
            </div>
          )}
          {!loadingPlan && !planQuery.isPending && !planQuery.error && plans.length > 0 && !plans.some(plan => plan.price > 0) && (
            <p className="mt-4 text-sm text-muted-foreground">暂未配置付费套餐，请联系管理员配置套餐价格与权益。</p>
          )}
        </TabsContent>

        {/* ── 邀请有礼 Tab ── */}
        <TabsContent value="invite" className="mt-4 animate-in fade-in-50 duration-300">
          <InvitePage embedded />
        </TabsContent>

        {/* ── 积分记录 Tab ── */}
        <TabsContent value="logs" className="space-y-4 mt-4">
          {/* 筛选 */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={logType} onValueChange={v => { setLogType(v); setPage(0); }}>
              <SelectTrigger className="w-40 h-9">
                <SelectValue placeholder="消费类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="video_generate">视频生成</SelectItem>
                <SelectItem value="template_download">模板下载</SelectItem>
                <SelectItem value="material_upload">素材上传</SelectItem>
                <SelectItem value="purchase">购买入账</SelectItem>
                <SelectItem value="plan_purchase">套餐开通</SelectItem>
                <SelectItem value="booster_purchase">加油包购买</SelectItem>
                <SelectItem value="refund">退款</SelectItem>
                <SelectItem value="bonus">赠送积分</SelectItem>
                <SelectItem value="deduct">扣除</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">共 {logsQuery.data?.total ?? 0} 条记录</p>
          </div>

          {/* 表格 */}
          {logsQuery.error ? <div role="alert" className="text-sm text-destructive">
            {logsQuery.error.message}<Button variant="outline" className="ml-3" onClick={() => void logsQuery.refetch()}>重试流水读取</Button>
          </div> : loadingLogs ? (
            <Card>
              <div className="overflow-x-auto w-full max-w-full">
                <Table className="[&>div]:max-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">时间</TableHead>
                      <TableHead className="whitespace-nowrap">事项描述</TableHead>
                      <TableHead className="whitespace-nowrap">类型</TableHead>
                      <TableHead className="whitespace-nowrap text-right">积分变动</TableHead>
                      <TableHead className="whitespace-nowrap text-right">剩余积分</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...Array(5)].map((_, i) => (
                      <TableRow key={i} className="animate-pulse">
                        <TableCell className="whitespace-nowrap"><div className="h-4 bg-muted-foreground/10 rounded w-24"></div></TableCell>
                        <TableCell className="whitespace-nowrap"><div className="h-4 bg-muted-foreground/10 rounded w-40"></div></TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="h-5 bg-muted-foreground/10 rounded-full w-16"></div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <div className="h-4 bg-muted-foreground/10 rounded w-12 ml-auto"></div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <div className="h-4 bg-muted-foreground/10 rounded w-16 ml-auto"></div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <CreditCard className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">暂无积分记录</p>
            </div>
          ) : (
            <>
              <Card className="relative overflow-hidden border border-border/60">
                <div className="overflow-x-auto w-full max-w-full">
                  <Table className="[&>div]:max-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">时间</TableHead>
                        <TableHead className="whitespace-nowrap">事项描述</TableHead>
                        <TableHead className="whitespace-nowrap">类型</TableHead>
                        <TableHead className="whitespace-nowrap text-right">积分变动</TableHead>
                        <TableHead className="whitespace-nowrap text-right">剩余积分</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map(log => {
                        const logKind = log.type === 'purchase' && ['plan_purchase', 'booster_purchase'].includes(log.action || '')
                          ? log.action! : log.type;
                        const typeInfo = TYPE_LABELS[logKind] ?? { label: logKind, cls: 'bg-muted text-muted-foreground' };
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{fmtDate(log.created_at)}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm max-w-[200px]">
                              <span className="truncate block">{log.description}</span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', typeInfo.cls)}>
                                {typeInfo.label}
                              </span>
                            </TableCell>
                            <TableCell className={cn('whitespace-nowrap text-sm font-semibold text-right',
                              log.amount > 0 ? 'text-success' : 'text-destructive')}>
                              {log.amount > 0 ? `+${log.amount}` : log.amount}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-right font-medium">
                              {log.credits_after.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </Card>

              {/* 分页 */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">第 {page + 1} 页</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-8" disabled={page === 0 || logsQuery.isFetching} onClick={() => setPage(p => p - 1)}>
                    上一页
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" disabled={logsQuery.isFetching || (page + 1) * PAGE_SIZE >= (logsQuery.data?.total || 0)} onClick={() => setPage(p => p + 1)}>
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="orders" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">共 {ordersQuery.data?.total || 0} 条订单</p>
            <Button variant="outline" onClick={() => void ordersQuery.refetch()}>刷新订单</Button>
          </div>
          {ordersQuery.error ? <p role="alert" className="text-destructive text-sm">{ordersQuery.error.message}</p>
            : ordersQuery.isPending ? <p className="text-sm">正在读取订单…</p>
            : !ordersQuery.data?.orders.length ? <p className="py-12 text-center text-muted-foreground">暂无订单记录</p>
            : ordersQuery.data.orders.map(order => <Card key={order.id}><CardContent className="p-4 space-y-2">
              <p className="font-medium">{(order.plan_snapshot as { name?: string } | null)?.name || '历史订单'}</p>
              <p className="text-xs break-all font-mono">{order.order_no}</p>
              <p className="text-sm text-muted-foreground">{fmtDate(order.created_at)} · {order.pay_channel === 'alipay' ? '支付宝' : '微信'}
                {' · '}¥{Number(order.total_amount).toFixed(2)} · {({ pending: '待支付', paid: '已支付', cancelled: '已取消',
                  partial_refunded: '部分退款', refunded: '已退款' } as Record<string, string>)[order.status] || '状态待核对'}</p>
              <Button variant="outline" size="sm" onClick={() => navigate(`/order/${order.id}`)}>查看订单</Button>
            </CardContent></Card>)}
          <div className="flex justify-between gap-3 items-center">
            <span className="text-xs text-muted-foreground">第 {orderPage + 1} 页</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={orderPage === 0 || ordersQuery.isFetching} onClick={() => setOrderPage(p => p - 1)}>上一页</Button>
              <Button variant="outline" disabled={ordersQuery.isFetching || (orderPage + 1) * PAGE_SIZE >= (ordersQuery.data?.total || 0)} onClick={() => setOrderPage(p => p + 1)}>下一页</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
      {payModalOpen && <PaymentDialog
        open={payModalOpen}
        onOpenChange={setPayModalOpen}
        plan={selectedPlan}
        onCreated={refreshBilling}
      />}
    </div>
  );
}
