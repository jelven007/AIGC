import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { useAuth } from '@/contexts/AuthContext';
import { assertRewardSession, fetchInvitations, type InvitationOverview } from '@/api/rewards';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Copy, Gift, Users, Loader2, Calendar, Download, Image as ImageIcon, RefreshCw } from 'lucide-react';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { cn } from '@/lib/utils';

export default function InvitePage({ embedded = false, dialogMode = false }: { embedded?: boolean; dialogMode?: boolean }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InvitationOverview | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterGenerating, setPosterGenerating] = useState(false);
  const [poster, setPoster] = useState<{ key: string; url: string } | null>(null);
  const mounted = useRef(false);
  const generating = useRef(false);
  const request = useRef<AbortController | null>(null);
  const inviteCode = data?.invite_code || '';
  const inviteUrl = inviteCode ? `${window.location.origin}/login?${new URLSearchParams({ mode: 'register', invite: inviteCode })}` : '';
  const currentUrl = useRef(inviteUrl);
  currentUrl.current = inviteUrl;
  const loadData = useCallback(async () => {
    if (!user) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller; setLoading(true);
    try {
      await assertRewardSession(user.id);
      const result = await fetchInvitations(page * 20, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (!mounted.current || controller.signal.aborted) return;
      if (!result.items.length && result.total > 0 && page * 20 >= result.total) {
        setPage(Math.floor((result.total - 1) / 20)); return;
      }
      setData(result); setError('');
    } catch (cause) {
      if (!mounted.current || controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '邀请记录读取失败，请重试');
    } finally {
      if (mounted.current && !controller.signal.aborted) setLoading(false);
    }
  }, [user, page]);
  useEffect(() => {
    mounted.current = true; void loadData();
    return () => { mounted.current = false; request.current?.abort(); };
  }, [loadData]);
  const copy = async (text: string, message: string) => {
    if (!text || !user) return;
    try {
      await assertRewardSession(user.id);
      if (!mounted.current) return;
      await navigator.clipboard.writeText(text);
      if (mounted.current) toast.success(message);
    } catch {
      if (mounted.current) toast.error('复制失败，请手动选择并复制');
    }
  };
  const generatePoster = async () => {
    if (!inviteUrl || !user || generating.current) return;
    const source = inviteUrl;
    if (poster?.key === source) { setPosterOpen(true); return; }
    generating.current = true; setPosterGenerating(true); setPosterOpen(true);
    try {
      await assertRewardSession(user.id);
      if (!mounted.current || source !== currentUrl.current) return;
      const qr = await QRCode.toDataURL(source, { width: 400, margin: 2, errorCorrectionLevel: 'M' });
      const image = new Image(); image.src = qr;
      await image.decode();
      if (!mounted.current || source !== currentUrl.current) return;
      const canvas = document.createElement('canvas'); canvas.width = 750; canvas.height = 1100;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持分享海报');
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 750, 1100);
      ctx.textAlign = 'center'; ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 42px sans-serif';
      ctx.fillText('视频生成平台', 375, 140);
      ctx.font = '28px sans-serif'; ctx.fillStyle = '#cbd5e1'; ctx.fillText('邀请好友，一起创作', 375, 205);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(125, 270, 500, 520);
      ctx.drawImage(image, 175, 320, 400, 400);
      ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 32px monospace'; ctx.fillText(inviteCode, 375, 850, 660);
      ctx.fillStyle = '#f8fafc'; ctx.font = '26px sans-serif'; ctx.fillText('有效邀请验证完成后，双方各得 50 积分', 375, 920);
      ctx.fillStyle = '#94a3b8'; ctx.font = '23px sans-serif';
      ctx.fillText('注册赠送 20 积分，邀请奖励另外入账', 375, 975);
      ctx.fillText('长按保存或扫描二维码注册', 375, 1025);
      setPoster({ key: source, url: canvas.toDataURL('image/png') });
    } catch (cause) {
      if (mounted.current) {
        toast.error(cause instanceof Error ? cause.message : '海报生成失败，请重试');
        setPosterOpen(false);
      }
    } finally {
      generating.current = false;
      if (mounted.current) setPosterGenerating(false);
    }
  };
  const visiblePoster = poster?.key === inviteUrl ? poster.url : '';
  return (
    <div className={cn('space-y-5 max-w-5xl mx-auto', !embedded && !dialogMode && 'p-4 md:p-6')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className={cn('font-bold flex items-center gap-2', dialogMode ? 'text-base' : 'text-xl')}>
            <Gift className="w-5 h-5 text-primary" />邀请有礼
          </h1>
          <p className="text-sm text-muted-foreground mt-1">有效邀请验证完成后，双方各获 50 积分。</p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadData()}>
          <RefreshCw className="w-4 h-4 mr-1" />刷新邀请
        </Button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
        {error} {data && '当前显示上次成功读取的数据。'}
      </div>}
      <div className={cn('grid gap-5', !dialogMode && 'lg:grid-cols-3')}>
        <div className="space-y-5 min-w-0">
          <Card>
            <CardHeader><CardTitle className="text-base">我的邀请码</CardTitle><CardDescription>分享链接后，好友无需手动填写</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <p className="font-mono font-bold text-xl tracking-wide text-primary break-all text-center">
                {inviteCode || (loading ? '读取中…' : '暂无邀请码')}
              </p>
              {!loading && !error && !inviteCode && <p className="text-sm text-muted-foreground">邀请码尚未初始化，请联系支持。</p>}
              <Button variant="secondary" className="w-full" disabled={!inviteCode} onClick={() => void copy(inviteCode, '邀请码已复制')}>
                <Copy className="w-4 h-4 mr-2" />复制邀请码
              </Button>
              <label className="block text-sm font-medium" htmlFor={`invite-url-${dialogMode ? 'dialog' : 'page'}`}>专属邀请链接</label>
              <input id={`invite-url-${dialogMode ? 'dialog' : 'page'}`} readOnly value={inviteUrl}
                placeholder="读取邀请码后生成链接" className="w-full min-w-0 rounded-md border bg-muted/30 p-2 text-xs" />
              <Button variant="outline" className="w-full" disabled={!inviteUrl} onClick={() => void copy(inviteUrl, '邀请链接已复制')}>
                <Copy className="w-4 h-4 mr-2" />复制邀请链接
              </Button>
              <Button className="w-full" disabled={!inviteUrl || posterGenerating} onClick={() => void generatePoster()}>
                {posterGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ImageIcon className="w-4 h-4 mr-2" />}生成分享海报
              </Button>
              {inviteUrl && !dialogMode && <div className="flex flex-col items-center gap-2 pt-2">
                <QRCodeDataUrl value={inviteUrl} size={160} /><span className="text-xs text-muted-foreground">面对面扫码注册</span>
              </div>}
            </CardContent>
          </Card>
          <Card><CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
            <p>注册赠送 20 积分。邀请奖励另外入账，不抵扣已用积分。</p>
            <p>使用有效链接注册，并完成邮箱或手机验证后发奖；每个新账号仅对应一次邀请。</p>
            <Link className="text-primary underline" to="/support">联系支持核对邀请</Link>
          </CardContent></Card>
        </div>
        <div className={cn('space-y-5 min-w-0', !dialogMode && 'lg:col-span-2')}>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '累计邀请', value: data?.total },
              { label: '已入账邀请', value: data?.completed },
              { label: '已确认奖励', value: data?.credits },
            ].map(item => <Card key={item.label}><CardContent className="p-3 text-center">
              <p className="text-xl font-bold break-all">{item.value?.toLocaleString() ?? '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
            </CardContent></Card>)}
          </div>
          {!!data?.legacy && <p role="status" className="text-sm text-muted-foreground rounded-lg border p-3">
            保留 {data.legacy} 条历史邀请；旧奖励没有新协议入账凭证，需要核对原流水。系统不会自动补发。
          </p>}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" />邀请记录</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p role="status" className="py-8 text-center text-muted-foreground">正在读取邀请记录…</p>
                : !data?.items.length ? <div className="py-8 text-center text-muted-foreground">
                  <Users className="w-8 h-8 mx-auto mb-3" />{error ? '记录暂时无法读取' : '暂无邀请记录，分享链接邀请好友吧。'}
                </div> : <>
                  <ul className="divide-y md:hidden">
                    {data.items.map(item => <li key={item.id} className="py-3 space-y-2">
                      <p className="text-sm break-words">{item.invitee_label || '受邀用户'}</p>
                      <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('zh-CN')}</p>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <Badge variant="secondary">{item.legacy ? '历史待核对' : item.granted_at ? '已入账' : '等待账号验证'}</Badge>
                        <span>{item.credited == null ? '奖励待核对' : `已入账 +${item.credited}`}</span>
                      </div>
                    </li>)}
                  </ul>
                  <div className="hidden md:block max-w-full overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>邀请时间</TableHead><TableHead>受邀用户</TableHead><TableHead>状态</TableHead><TableHead className="text-right">已入账</TableHead></TableRow></TableHeader>
                    <TableBody>{data.items.map(item => <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-xs">{new Date(item.created_at).toLocaleString()}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{item.invitee_label || '受邀用户'}</TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant="secondary">
                        {item.legacy ? '历史待核对' : item.granted_at ? '已入账' : '等待账号验证'}
                      </Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">{item.credited == null ? '—' : `+${item.credited}`}</TableCell>
                    </TableRow>)}</TableBody>
                  </Table>
                  </div>
                </>}
              {data && data.total > 20 && <div className="flex items-center justify-between gap-2 mt-4 text-xs">
                <Button size="sm" variant="outline" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
                <span>第 {page + 1} / {Math.max(1, Math.ceil(data.total / 20))} 页</span>
                <Button size="sm" variant="outline" disabled={loading || (page + 1) * 20 >= data.total} onClick={() => setPage(value => value + 1)}>下一页</Button>
              </div>}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>专属分享海报</DialogTitle><DialogDescription>扫描二维码注册；可保存图片后自行分享。</DialogDescription></DialogHeader>
          {posterGenerating ? <p role="status" className="py-12 text-center">正在生成海报…</p>
            : visiblePoster && <img src={visiblePoster} alt="包含专属邀请二维码和奖励规则的分享海报" className="w-full max-w-[280px] mx-auto rounded-lg" />}
          <Button asChild disabled={!visiblePoster}><a href={visiblePoster || undefined} download={`invite_${inviteCode}.png`}>
            <Download className="w-4 h-4 mr-2" />保存海报
          </a></Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
