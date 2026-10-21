import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Loader2, RefreshCw, Settings, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useNotifications } from '@/hooks/useNotifications';
import { notificationPath, type NotificationCategory, type NotificationMutation } from '@/api/notifications';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const categories: { id: NotificationCategory; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'jobs', label: '后台任务' },
  { id: 'intelligence', label: '情报采集' }, { id: 'publish', label: '平台发布' },
];
export default function NotificationsPage() {
  const [category, setCategory] = useState<NotificationCategory>('all'), [page, setPage] = useState(0);
  const { feed, isLoading, error, refetch, mutate, mutating } = useNotifications(category, page * 25);
  const [operationError, setOperationError] = useState('');
  useEffect(() => { setPage(0); setOperationError(''); }, [category]);
  useEffect(() => {
    if (feed && page > 0 && page * 25 >= feed.total) setPage(Math.max(0, Math.ceil(feed.total / 25) - 1));
  }, [feed, page]);
  const act = async (input: NotificationMutation) => {
    setOperationError('');
    try { await mutate(input); }
    catch (cause) { setOperationError(cause instanceof Error ? cause.message : '通知操作失败'); }
  };
  return <div className="mx-auto max-w-4xl p-4 md:p-8 space-y-6">
    <div className="flex flex-wrap justify-between items-start gap-3">
      <div><h1 className="text-2xl font-semibold flex gap-2 items-center"><Bell className="w-5 h-5 text-primary" />消息通知</h1>
        <p className="text-sm text-muted-foreground mt-2">后台处理结果与发布状态 · {feed ? `${feed.unread_all}条未读` : '正在读取'} · 保留180天</p></div>
      <Button variant="outline" onClick={() => { void refetch(); }}><RefreshCw className="w-4 h-4 mr-2" />刷新通知</Button>
    </div>
    {(error || operationError) && <p role="alert" className="text-sm text-destructive break-words">{operationError || error?.message}</p>}
    <div className="flex flex-wrap items-center gap-2">
      {categories.map(item => <Button key={item.id} variant={category === item.id ? 'default' : 'outline'} aria-pressed={category === item.id}
        onClick={() => setCategory(item.id)}>{item.label}</Button>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted-foreground">当前分类{feed?.total ?? '—'}条 · {feed?.unread ?? '—'}条未读</span>
      <Button variant="outline" size="sm" disabled={mutating || !feed?.unread_all}
        onClick={() => feed && void act({ action: 'read_all', cutoff: feed.cutoff })}><CheckCheck className="w-4 h-4 mr-2" />全部标记已读</Button>
      <Button variant="ghost" size="sm" disabled={mutating || !feed?.total}
        onClick={() => feed && void act({ action: 'clear_read', cutoff: feed.cutoff })}><Trash2 className="w-4 h-4 mr-2" />清除已读</Button>
    </div>
    {isLoading && <p role="status" className="text-sm flex gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />正在读取通知</p>}
    {feed && !feed.items.length && <div className="border border-dashed rounded-xl py-12 text-center text-sm text-muted-foreground">暂无通知</div>}
    <div className="space-y-3">{feed?.items.map(item => {
      const Icon = item.level === 'success' ? CheckCircle2 : AlertCircle;
      return <article key={item.id} className={cn('border rounded-xl p-4 space-y-3', !item.read_at && 'border-primary/40 bg-primary/5')}>
        <div className="flex gap-3 items-start"><Icon className={cn('w-5 h-5 shrink-0 mt-0.5',
          item.level === 'success' ? 'text-success' : item.level === 'error' ? 'text-destructive' : 'text-warning')} />
          <div className="flex-1 min-w-0"><h2 className="text-sm font-semibold break-words">{item.title}{!item.read_at && <span className="text-primary ml-2 text-xs">未读</span>}</h2>
            <p className="text-sm text-muted-foreground mt-1 break-words">{item.body}</p>
            <time className="block text-xs text-muted-foreground mt-2" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('zh-CN')}</time></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm"><Link to={notificationPath(item)} state={{ notification_source_id: item.source_id }}
            onClick={() => { if (!item.read_at) void mutate({ action: 'read', ids: [item.id] }).catch(cause => toast.error(cause.message)); }}>查看详情</Link></Button>
          {!item.read_at && <Button variant="ghost" size="sm" disabled={mutating} onClick={() => void act({ action: 'read', ids: [item.id] })}>标记已读</Button>}
          <Button variant="ghost" size="sm" disabled={mutating} aria-label={`删除通知 ${item.title}`}
            onClick={() => void act({ action: 'delete', ids: [item.id] })}><Trash2 className="w-4 h-4 mr-1" />删除</Button>
        </div>
      </article>;
    })}</div>
    {feed && feed.total > 25 && <div className="flex justify-center items-center gap-3">
      <Button variant="outline" disabled={!page} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <p className="text-sm">第{page + 1}/{Math.ceil(feed.total / 25)}页</p>
      <Button variant="outline" disabled={(page + 1) * 25 >= feed.total} onClick={() => setPage(value => value + 1)}>下一页</Button>
    </div>}
    {feed && <section className="border rounded-xl p-4 space-y-4" aria-label="通知偏好设置">
      <h2 className="font-semibold flex gap-2 items-center"><Settings className="w-4 h-4" />通知偏好设置</h2>
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={feed.preferences.task_success} disabled={mutating}
        onChange={event => void act({ action: 'preferences', preferences: { ...feed.preferences, task_success: event.target.checked } })} />接收后台任务与平台发布成功通知</label>
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={feed.preferences.intelligence_success} disabled={mutating}
        onChange={event => void act({ action: 'preferences', preferences: { ...feed.preferences, intelligence_success: event.target.checked } })} />接收情报采集成功通知</label>
      <p className="text-xs text-muted-foreground">失败和结果待核对通知始终保留。设置只影响今后产生的站内通知。</p>
    </section>}
  </div>;
}
