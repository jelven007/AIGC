import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 临时状态提醒统一放在全局浮层，关闭只隐藏提醒，原草稿与回执仍保留。 */
export default function FloatingNotice({ id, title, children, tone = 'info', duration = 6000 }: {
  id: string; title: string; children?: ReactNode; tone?: 'info' | 'warning'; duration?: number;
}) {
  const dismissed = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    dismissed.current = false;
    setCollapsed(false);
    return () => { toast.dismiss(id); };
  }, [id]);
  useEffect(() => {
    if (dismissed.current) return;
    const Icon = tone === 'warning' ? AlertTriangle : Info;
    toast.custom(() => collapsed ? <button type="button" data-floating-reminder={id}
      aria-label={`查看待处理提醒：${title}`} onClick={() => setCollapsed(false)}
      className={cn('w-full flex items-center gap-2 rounded-xl border bg-popover text-popover-foreground px-4 py-3 text-sm shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tone === 'warning' ? 'border-warning/40' : 'border-info/40')}>
      <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', tone === 'warning' ? 'text-warning' : 'text-info')} />
      <span className="min-w-0 break-words">查看待处理提醒</span>
    </button> : <div data-floating-notice={id} role="status"
      className={cn('w-full rounded-xl border bg-popover text-popover-foreground p-4 shadow-xl',
        tone === 'warning' ? 'border-warning/40' : 'border-info/40')}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0 mt-0.5', tone === 'warning' ? 'text-warning' : 'text-info')} />
        <p className="min-w-0 flex-1 text-sm font-medium break-words">{title}</p>
        <button type="button" aria-label="关闭提醒"
          className="h-7 w-7 -mt-1 -mr-1 rounded-md shrink-0 flex items-center justify-center text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            if (duration === Infinity) setCollapsed(true);
            else { dismissed.current = true; toast.dismiss(id); }
          }}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {children && <div className="mt-3 space-y-2 text-sm break-words [&_button]:whitespace-normal">{children}</div>}
    </div>, { id, duration, dismissible: duration !== Infinity,
      style: { padding: 0, background: 'transparent', border: 'none', boxShadow: 'none', minHeight: 0, display: 'block' },
      onDismiss: () => { dismissed.current = true; },
      onAutoClose: () => { dismissed.current = true; } });
  }, [id, title, children, tone, duration, collapsed]);
  return null;
}
