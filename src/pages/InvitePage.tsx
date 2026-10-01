import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Share2, Copy, Gift, Users, Link as LinkIcon, Loader2, Calendar, CheckCircle2, Download, Image as ImageIcon } from 'lucide-react';
import QRCodeDataUrl from '@/components/ui/qrcodedataurl';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Invitation {
  id: string;
  invitee_id: string | null;
  status: string;
  reward_credits: number;
  created_at: string;
  invitee?: {
    username: string;
  };
}

export default function InvitePage({ embedded = false, dialogMode = false }: { embedded?: boolean; dialogMode?: boolean }) {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [stats, setStats] = useState({ total: 0, completed: 0, credits: 0 });

  // 海报相关状态
  const [posterOpen, setPosterOpen] = useState(false);
  const [posterGenerating, setPosterGenerating] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const qrCodeRef = useRef<HTMLDivElement>(null);

  const inviteCode = (profile as any)?.invite_code || '';
  const inviteUrl = `${window.location.origin}/login?mode=register&invite=${inviteCode}`;

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          id, invitee_id, status, reward_credits, created_at,
          invitee:profiles!invitee_id(username)
        `)
        .eq('inviter_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const list = (data || []) as any[];
      setInvitations(list);

      setStats({
        total: list.length,
        completed: list.filter(i => i.status === 'completed').length,
        credits: list.filter(i => i.status === 'completed').reduce((sum, i) => sum + (i.reward_credits || 0), 0)
      });
    } catch (err: any) {
      toast.error('加载邀请记录失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const copyToClipboard = (text: string, msg: string) => {
    navigator.clipboard.writeText(text);
    toast.success(msg);
  };

  const generatePoster = async () => {
    if (posterUrl) { setPosterOpen(true); return; }
    setPosterGenerating(true);
    setPosterOpen(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 750;
      canvas.height = 1100;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器不支持Canvas');

      // ── 绘制背景 ──
      const grd = ctx.createLinearGradient(0, 0, 0, 1100);
      grd.addColorStop(0, '#020817');
      grd.addColorStop(1, '#0f172a');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 750, 1100);

      // ── 装饰元素 ──
      ctx.beginPath();
      ctx.arc(0, 0, 300, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(750, 1100, 400, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.1)';
      ctx.fill();

      // ── 标题 ──
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 56px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Shopro-电商AIGC带货视频', 375, 200);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '36px sans-serif';
      ctx.fillText('邀请您体验革命性的视频创作', 375, 280);

      // ── QR卡片区域 ──
      ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 20;
      if (ctx.roundRect) {
        ctx.roundRect(175, 360, 400, 480, 24);
        ctx.fill();
      } else {
        ctx.fillRect(175, 360, 400, 480);
      }
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillText('您的专属邀请码', 375, 430);
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(inviteCode || 'INVITE', 375, 490);

      // ── 加载并绘制QR码（带5秒超时保护） ──
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('QR码加载超时，请刷新页面重试'));
        }, 5000);

        const qrContainer = document.getElementById('invite-qrcode');
        const img = qrContainer?.querySelector('img') as HTMLImageElement | null;
        if (!img || !img.src || img.src === window.location.href) {
          clearTimeout(timeout);
          reject(new Error('QR码尚未生成，请稍后重试'));
          return;
        }

        const qrc = new Image();
        qrc.crossOrigin = 'anonymous';
        qrc.onload = () => {
          clearTimeout(timeout);
          ctx.drawImage(qrc, 245, 520, 260, 260);
          resolve();
        };
        qrc.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('QR图片加载失败'));
        };
        qrc.src = img.src;
      });

      // ── 底部文案 ──
      ctx.fillStyle = '#94a3b8';
      ctx.font = '24px sans-serif';
      ctx.fillText('长按保存或扫描二维码注册', 375, 960);
      ctx.fillStyle = '#64748b';
      ctx.font = '20px sans-serif';
      ctx.fillText('首次注册即领 50积分 奖励', 375, 1010);

      const url = canvas.toDataURL('image/png', 0.9);
      setPosterUrl(url);
    } catch (e: any) {
      console.error('海报生成错误:', e);
      toast.error('海报生成失败：' + (e.message || '请刷新页面重试'));
      setPosterOpen(false);
    } finally {
      setPosterGenerating(false);
    }
  };

  if (dialogMode) {
    return (
      <div className="space-y-5 py-2">
        {/* 顶部标题与说明 */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 mb-1">
            <Gift className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-zinc-100">邀请好友 · 共享好礼</h2>
          <p className="text-[11px] text-zinc-400">好友注册即得 50 积分，您也得 50 积分</p>
        </div>

        {/* 邀请码和链接卡片 */}
        <div className="bg-zinc-850/60 rounded-xl border border-zinc-800/80 p-4 space-y-4">
          <div className="space-y-1 text-center">
            <span className="text-[11px] text-zinc-400 font-medium">我的专属邀请码</span>
            <div className="flex items-center justify-center gap-3">
              <span className="text-2xl font-mono font-extrabold tracking-wider text-amber-500">
                {inviteCode || '暂无'}
              </span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                onClick={() => copyToClipboard(inviteCode, '邀请码已复制')}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="border-t border-zinc-800/80 my-2" />

          <div className="space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium block">专属邀请链接</span>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-zinc-950/40 border border-zinc-800/80 rounded-lg px-3 py-1.5 text-xs truncate text-zinc-400 select-all font-mono">
                {inviteUrl}
              </div>
              <Button 
                size="icon" 
                variant="outline" 
                className="shrink-0 h-8 w-8 border-zinc-800/80 hover:bg-zinc-800 text-zinc-300" 
                onClick={() => copyToClipboard(inviteUrl, '邀请链接已复制')}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* 快速数据统计 */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-800/60 p-2">
            <p className="text-base font-bold text-zinc-200">{stats.total}</p>
            <p className="text-[9px] text-zinc-500 mt-0.5">累计邀请</p>
          </div>
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-800/60 p-2">
            <p className="text-base font-bold text-emerald-500">{stats.completed}</p>
            <p className="text-[9px] text-zinc-500 mt-0.5">成功注册</p>
          </div>
          <div className="bg-zinc-800/30 rounded-lg border border-zinc-800/60 p-2">
            <p className="text-base font-bold text-amber-500">{stats.credits}</p>
            <p className="text-[9px] text-zinc-500 mt-0.5">累计奖励</p>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <Button 
            className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-none text-xs font-semibold h-9 shadow-sm" 
            onClick={generatePoster} 
            disabled={posterGenerating}
          >
            {posterGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <ImageIcon className="w-3.5 h-3.5 mr-1.5" />}
            生成专属分享海报
          </Button>
        </div>

        {/* 隐藏的 QR Code */}
        <div className="hidden" id="invite-qrcode">
          {inviteUrl && <QRCodeDataUrl value={inviteUrl} size={400} />}
        </div>

        {/* 海报预览弹窗 */}
        <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md p-6 bg-zinc-900 border-zinc-800 text-zinc-200">
            <DialogHeader>
              <DialogTitle className="text-zinc-100">您的专属分享海报</DialogTitle>
              <DialogDescription className="text-zinc-400">长按图片保存或直接转发给微信好友</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-6 pt-4">
              <div className="relative w-full max-w-[300px] aspect-[750/1100] rounded-xl overflow-hidden shadow-2xl border border-zinc-800">
                {posterGenerating ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/40">
                    <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                    <span className="text-sm text-zinc-400">正在生成海报...</span>
                  </div>
                ) : posterUrl ? (
                  <img src={posterUrl} alt="分享海报" className="w-full h-full object-cover" />
                ) : null}
              </div>

              <div className="flex w-full gap-3">
                <Button className="flex-1 border-zinc-700 hover:bg-zinc-850 text-zinc-300" variant="outline" onClick={() => setPosterOpen(false)}>关闭</Button>
                {posterUrl && (
                  <Button className="flex-1 bg-primary hover:bg-primary/95 text-white" onClick={() => {
                    const link = document.createElement('a');
                    link.href = posterUrl;
                    link.download = `invite_poster_${inviteCode}.png`;
                    link.click();
                    toast.success('海报已开始下载');
                  }}>
                    <Download className="w-4 h-4 mr-2" /> 保存图片
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6 max-w-5xl mx-auto", !embedded && "p-4 md:p-6")}>
      {!embedded && (
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-balance">
            <Gift className="w-5 h-5 text-primary" />邀请有礼
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">邀请好友注册，双方均可获得丰厚积分奖励</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：邀请方式 */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-background shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">我的邀请码</CardTitle>
              <CardDescription>分享给好友，注册时填写即可</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center gap-4 bg-background p-4 rounded-xl border border-border/50">
                <div className="text-3xl font-mono font-bold tracking-widest text-primary">
                  {inviteCode || '暂无'}
                </div>
                <Button variant="secondary" size="sm" className="w-full" onClick={() => copyToClipboard(inviteCode, '邀请码已复制')}>
                  <Copy className="w-4 h-4 mr-2" />复制邀请码
                </Button>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <LinkIcon className="w-4 h-4" /> 专属邀请链接
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-xs truncate text-muted-foreground select-all">
                    {inviteUrl}
                  </div>
                  <Button size="icon" variant="outline" className="shrink-0" onClick={() => copyToClipboard(inviteUrl, '邀请链接已复制')}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* 隐藏的 QR Code 元素，用于截图 */}
              <div className="hidden" id="invite-qrcode">
                {inviteUrl && <QRCodeDataUrl value={inviteUrl} size={400} />}
              </div>

              <Button className="w-full h-11" variant="default" onClick={generatePoster} disabled={posterGenerating}>
                {posterGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ImageIcon className="w-4 h-4 mr-2" />}
                生成专属微信分享海报
              </Button>

              <div className="space-y-3 flex flex-col items-center border-t border-border pt-6">
                <p className="text-sm font-medium text-muted-foreground mb-1">面对面扫码邀请</p>
                <div className="bg-white p-3 rounded-xl border border-border shadow-sm">
                  {inviteCode && <QRCodeDataUrl value={inviteUrl} className="w-32 h-32" />}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Share2 className="w-4 h-4" />邀请规则</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-medium mt-0.5">1</span>
                  <span>好友通过您的专属链接或邀请码成功注册账号。</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-medium mt-0.5">2</span>
                  <span>被邀请人注册成功后，即可获得 <span className="font-semibold text-foreground">50积分</span> 新人奖励。</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-medium mt-0.5">3</span>
                  <span>您作为邀请人，将同时获得 <span className="font-semibold text-foreground">50积分</span> 奖励，上不封顶。</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：统计与记录 */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center h-full">
                <Users className="w-6 h-6 text-muted-foreground mb-2" />
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground mt-1">累计邀请(人)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center h-full">
                <CheckCircle2 className="w-6 h-6 text-success mb-2" />
                <p className="text-2xl font-bold text-success">{stats.completed}</p>
                <p className="text-xs text-muted-foreground mt-1">成功注册(人)</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 flex flex-col items-center justify-center text-center h-full">
                <Gift className="w-6 h-6 text-primary mb-2" />
                <p className="text-2xl font-bold text-primary">{stats.credits}</p>
                <p className="text-xs text-muted-foreground mt-1">累计获得积分</p>
              </CardContent>
            </Card>
          </div>

          <Card className="flex-1 min-h-[400px]">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" />邀请记录</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : invitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Users className="w-12 h-12 mb-4 opacity-20" />
                  <p>暂无邀请记录，快去邀请好友吧！</p>
                </div>
              ) : (
                <div className="overflow-x-auto w-full max-w-full">
                  <Table className="[&>div]:max-w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">邀请时间</TableHead>
                        <TableHead className="whitespace-nowrap">受邀用户</TableHead>
                        <TableHead className="whitespace-nowrap">状态</TableHead>
                        <TableHead className="whitespace-nowrap text-right">获得奖励</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitations.map(inv => (
                        <TableRow key={inv.id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {format(new Date(inv.created_at), 'yyyy-MM-dd HH:mm', { locale: zhCN })}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm font-medium">
                            {inv.invitee?.username || '-'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {inv.status === 'completed'
                              ? <Badge className="bg-success/10 text-success hover:bg-success/20 font-normal">已完成</Badge>
                              : <Badge variant="secondary" className="font-normal text-muted-foreground">处理中</Badge>
                            }
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-right font-semibold text-primary">
                            {inv.status === 'completed' ? `+${inv.reward_credits}` : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 海报预览弹窗 */}
      <Dialog open={posterOpen} onOpenChange={setPosterOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md p-6">
          <DialogHeader>
            <DialogTitle>您的专属分享海报</DialogTitle>
            <DialogDescription>长按图片保存或直接转发给微信好友</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-6 pt-4">
            <div className="relative w-full max-w-[300px] aspect-[750/1100] rounded-xl overflow-hidden shadow-2xl border border-border">
              {posterGenerating ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/30">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                  <span className="text-sm text-muted-foreground">正在生成海报...</span>
                </div>
              ) : posterUrl ? (
                <img src={posterUrl} alt="分享海报" className="w-full h-full object-cover" />
              ) : null}
            </div>

            <div className="flex w-full gap-3">
              <Button className="flex-1" variant="outline" onClick={() => setPosterOpen(false)}>关闭</Button>
              {posterUrl && (
                <Button className="flex-1" onClick={() => {
                  const link = document.createElement('a');
                  link.href = posterUrl;
                  link.download = `invite_poster_${inviteCode}.png`;
                  link.click();
                  toast.success('海报已开始下载');
                }}>
                  <Download className="w-4 h-4 mr-2" /> 保存图片
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}