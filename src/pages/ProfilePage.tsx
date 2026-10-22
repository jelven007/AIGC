import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useCredits } from '@/hooks/useCredits';
import { uploadMaterialAsset } from '@/api/materialAssets';
import { accountRequest } from '@/api/accountSession';
import { canonicalMedia } from '@/lib/privateMedia';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  User, Bell, Shield, Video, ImageIcon, LogOut,
  Camera, Key, Sparkles, Zap, FolderOpen, TrendingUp,
  ChevronRight, Edit3, Check, X, Star, Award,
  Clock, BarChart2, Film, Package, Globe,
  Loader2, Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

// ─── 头像颜色方案 ─────────────────────────────────────────────────────────────
const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-orange-500 to-amber-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-blue-600',
];

function getGradient(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xfffffff;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

function getInitials(name: string | null | undefined, email: string | null | undefined) {
  if (name?.trim()) return name.trim().slice(0, 2).toUpperCase();
  if (email) return email.slice(0, 2).toUpperCase();
  return 'U';
}

interface Overview {
  videos: number; completed: number; materials: number; products: number; published: number;
  timezone: string; activity: { date: string; count: number }[];
}

// ─── 统计卡片 ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, color, bg, onClick }: {
  icon: React.ElementType; label: string; value: number | string;
  color: string; bg: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex flex-col gap-2 p-4 rounded-2xl border border-border/60 bg-card',
        'hover:shadow-md hover:-translate-y-0.5 transition-all duration-200',
        onClick && 'cursor-pointer',
      )}
    >
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', bg)}>
        <Icon className={cn('w-4.5 h-4.5', color)} />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── 菜单行 ──────────────────────────────────────────────────────────────────
function MenuRow({ icon: Icon, label, desc, onClick, danger = false, badge }: {
  icon: React.ElementType; label: string; desc?: string;
  onClick: () => void; danger?: boolean; badge?: string;
}) {
  return (
    <button onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors text-left',
        danger
          ? 'hover:bg-destructive/10 text-destructive'
          : 'hover:bg-muted/50 text-foreground',
      )}>
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
        danger ? 'bg-destructive/10' : 'bg-muted')}>
        <Icon className={cn('w-4 h-4', danger ? 'text-destructive' : 'text-muted-foreground')} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', danger ? 'text-destructive' : '')}>{label}</p>
        {desc && <p className="text-xs text-muted-foreground mt-0.5 text-pretty">{desc}</p>}
      </div>
      {badge && (
        <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20 border shrink-0">{badge}</Badge>
      )}
      {!danger && <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />}
    </button>
  );
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { user, profile, profileError, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const credits = useCredits();
  const alive = useRef(true);
  const request = useRef(0);
  const avatarPreview = useRef('');
  const registeredAvatar = useRef<{ file: File; url: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current++; URL.revokeObjectURL(avatarPreview.current); };
  }, []);

  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [username, setUsername] = useState(profile?.username ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarRights, setAvatarRights] = useState(false);
  const [notification, setNotification] = useState(profile?.notification_enabled ?? true);
  const [stats, setStats] = useState<Overview | null>(null);
  const [statsError, setStatsError] = useState('');
  const [statsLoading, setStatsLoading] = useState(true);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const activity = stats?.activity ?? [];

  useEffect(() => {
    if (profile && !isEditing) {
      setUsername(profile.username ?? '');
      setAvatarUrl(profile.avatar_url ?? '');
      setNotification(profile.notification_enabled ?? true);
    }
  }, [profile, isEditing]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    const sequence = ++request.current;
    setStatsLoading(true); setStatsError('');
    try {
      const { data, error } = await supabase.rpc('get_my_profile_overview', {
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      }).abortSignal(AbortSignal.timeout(15000));
      if (!alive.current || sequence !== request.current) return;
      if (error) throw new Error('创作概览读取失败，请重试');
      if (!data || ['videos', 'completed', 'materials', 'products', 'published'].some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)
        || !Array.isArray(data.activity) || data.activity.length !== 30
        || data.activity.some((day: { date: string; count: number }) => !/^\d{4}-\d{2}-\d{2}$/.test(day.date)
          || !Number.isSafeInteger(day.count) || day.count < 0)) throw new Error('创作概览格式无效，请检查服务版本');
      setStats(data as Overview);
    } catch (cause) {
      if (alive.current && sequence === request.current) setStatsError(cause instanceof Error ? cause.message : '读取失败');
    } finally {
      if (alive.current && sequence === request.current) setStatsLoading(false);
    }
  }, [user]);
  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) {
      toast.error('请选择2MB以内的JPG、PNG或WebP头像'); return;
    }
    try {
      const decoded = await createImageBitmap(file);
      const valid = decoded.width > 0 && decoded.height > 0 && decoded.width <= 8192 && decoded.height <= 8192;
      decoded.close();
      if (!valid) throw new Error('头像尺寸须在1至8192像素之间');
      if (!alive.current) return;
      URL.revokeObjectURL(avatarPreview.current);
      avatarPreview.current = URL.createObjectURL(file);
      registeredAvatar.current = null;
      setAvatarUrl(avatarPreview.current); setAvatarFile(file); setAvatarRights(false);
    } catch (cause) { if (alive.current) toast.error(cause instanceof Error ? cause.message : '无法读取头像'); }
  };

  const handleSave = async () => {
    if (!user || !profile || saving) return;
    if (!username.trim()) { toast.error('用户名不能为空'); return; }
    if (username.trim().length > 20 || !/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username.trim())) {
      toast.error('用户名只能包含字母、数字、下划线或中文'); return;
    }
    if (avatarFile && !avatarRights) { toast.error('请确认头像使用权'); return; }
    setSaving(true);
    try {
      let reference = avatarUrl;
      if (avatarFile) {
        reference = registeredAvatar.current?.file === avatarFile ? registeredAvatar.current.url
          : (await uploadMaterialAsset(avatarFile, user.id, avatarRights)).url;
        registeredAvatar.current = { file: avatarFile, url: reference };
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive.current || session?.user.id !== user.id) return;
      const { data, error } = await supabase.from('profiles').update({
        username: username.trim(), avatar_url: reference ? canonicalMedia(reference) : null,
      }).eq('id', user.id).select('id').maybeSingle();
      if (!alive.current) return;
      if (error || data?.id !== user.id) throw new Error(error?.message || '资料保存结果未确认，请刷新核对');
      await refreshProfile();
      if (!alive.current) return;
      setAvatarFile(null); setIsEditing(false);
      toast.success('个人资料已保存');
    } catch (cause) { if (alive.current) toast.error(cause instanceof Error ? cause.message : '保存失败'); }
    finally { if (alive.current) setSaving(false); }
  };

  const handleChangePw = async () => {
    if (!user || pwSaving) return;
    if (pwForm.next !== pwForm.confirm) { toast.error('两次密码不一致'); return; }
    if (pwForm.next.length < 8) { toast.error('密码至少8位'); return; }
    setPwSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive.current || session?.user.id !== user.id) return;
      const updated = await accountRequest(user.id, '/auth/v1/user', 'PUT', { password: pwForm.next });
      if (!alive.current) return;
      if (updated?.id !== user.id) throw new Error('密码修改结果未确认');
      toast.success('密码已修改');
      setPwForm({ next: '', confirm: '' }); setPwOpen(false);
    } catch (cause) { if (alive.current) toast.error(cause instanceof Error ? cause.message : '密码修改失败'); }
    finally { if (alive.current) setPwSaving(false); }
  };

  const handleNotificationToggle = async (val: boolean) => {
    if (!user || !profile || notificationSaving) return;
    setNotificationSaving(true);
    try {
      const { data, error } = await supabase.from('profiles').update({ notification_enabled: val })
        .eq('id', user.id).select('id,notification_enabled').maybeSingle();
      if (!alive.current) return;
      if (error || data?.notification_enabled !== val || data.id !== user.id) throw new Error('通知偏好保存失败，请重试');
      setNotification(val);
      await refreshProfile();
      if (alive.current) toast.success(val ? '通知已开启' : '通知已关闭');
    } catch (cause) { if (alive.current) toast.error(cause instanceof Error ? cause.message : '通知偏好保存失败'); }
    finally { if (alive.current) setNotificationSaving(false); }
  };

  const copyUserId = async () => {
    if (!user) return;
    try { await navigator.clipboard.writeText(user.id); if (alive.current) toast.success('已复制 User ID'); }
    catch { if (alive.current) toast.error('复制失败，请手动复制账号ID'); }
  };

  const gradient = getGradient(user?.id ?? 'default');
  const initials = getInitials(profile?.username, user?.email);
  const creditsLeft = credits.creditsLeft;
  const creditsUsedPct = credits.usagePercent;
  const createdAt = profile?.created_at || user?.created_at;
  const memberDays = createdAt && Number.isFinite(Date.parse(createdAt))
    ? Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 86400000)) : null;

  const heatColor = (count: number) => {
    if (count === 0) return 'bg-muted/50';
    if (count === 1) return 'bg-primary/20';
    if (count === 2) return 'bg-primary/40';
    if (count === 3) return 'bg-primary/60';
    return 'bg-primary';
  };

  return (
    <div className="min-h-screen bg-muted/20">
      {/* ── Hero 横幅 ── */}
      <div className={cn('relative h-36 md:h-44 bg-gradient-to-br', gradient)} />

      <div className="relative px-4 md:px-6 pb-10 -mt-16 max-w-3xl mx-auto space-y-5">
        {profileError && <div role="alert" className="rounded-xl border bg-card p-4 text-sm">
          <p>{profileError}</p><Button variant="outline" size="sm" onClick={() => void refreshProfile()}>重试个人资料</Button>
          <Button variant="link" size="sm" onClick={() => navigate('/support')}>联系支持</Button>
        </div>}

        {isEditing ? (
          /* ── 编辑资料页面 ── */
          <div className="rounded-3xl bg-card border border-border/60 shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="p-5 md:p-6 border-b border-border/60 flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-primary" /> 编辑个人资料
              </h2>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setIsEditing(false)}>
                <X className="w-4 h-4 mr-1" /> 返回
              </Button>
            </div>

            <div className="p-5 md:p-6 space-y-6">
              {/* 第一部分：头像与基本信息 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* 头像预览 & 动作 */}
                <div className="flex flex-col items-center justify-center gap-3 p-4 border border-border/60 rounded-2xl bg-muted/10">
                  <div className="relative group">
                    <Avatar className="w-24 h-24 rounded-3xl border-2 border-primary shadow-md">
                      <AvatarImage src={avatarUrl || undefined} alt="头像预览" className="object-cover" />
                      <AvatarFallback className={cn('bg-gradient-to-br text-white text-xl', gradient)}>{initials}</AvatarFallback>
                    </Avatar>
                    <label
                      htmlFor="avatar-upload-main"
                      className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                    </label>
                    <input
                      type="file"
                      id="avatar-upload-main"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={saving}
                      aria-label="选择个人头像"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-semibold text-foreground">用户头像</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">JPG、PNG、WebP，最大2MB</p>
                  </div>
                </div>

                {/* 表单输入 */}
                <div className="md:col-span-2 space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="profile-username" className="text-sm font-semibold text-foreground">用户名</label>
                    <Input
                      id="profile-username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="输入用户名"
                      maxLength={20}
                    />
                    <p className="text-xs text-muted-foreground">支持中文、字母、数字、下划线，最多20个字符</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-foreground">邮箱账户</label>
                    <Input value={user?.email ?? ''} disabled className="opacity-60 bg-muted/40" />
                    <p className="text-xs text-muted-foreground">邮箱是您的唯一登录标识，不支持更改</p>
                  </div>
                </div>
              </div>

              {avatarFile && <label className="flex items-start gap-2 text-sm rounded-xl border p-4">
                <input type="checkbox" checked={avatarRights} disabled={saving} onChange={e => setAvatarRights(e.target.checked)} />
                <span>我拥有头像图片的使用权。保存时上传并登记，可在素材库恢复未确认的上传。</span>
              </label>}
              <Button variant="outline" size="sm" disabled={saving} onClick={() => {
                URL.revokeObjectURL(avatarPreview.current); avatarPreview.current = '';
                registeredAvatar.current = null;
                setAvatarUrl(''); setAvatarFile(null); setAvatarRights(false);
              }}>使用姓名头像</Button>

              {/* 提交控制 */}
              <div className="flex gap-3 pt-4 border-t border-border/40">
                <Button variant="outline" className="flex-1" disabled={saving} onClick={() => { setAvatarFile(null); setIsEditing(false); }}>
                  取消返回
                </Button>
                <Button className="flex-1 gap-1.5" onClick={handleSave} disabled={saving || !profile || (!!avatarFile && !avatarRights)}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {saving ? '保存中…' : '保存修改'}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* ── 正常展示个人中心界面 ── */
          <>
            <div className="rounded-3xl bg-card border border-border/60 shadow-lg overflow-hidden">
              <div className="p-5 md:p-6">
                <div className="flex items-end gap-4">
                  {/* 头像 */}
                  <div className="relative shrink-0">
                    <Avatar className="w-20 h-20 md:w-24 md:h-24 rounded-3xl ring-4 ring-card shadow-xl">
                      <AvatarImage src={profile?.avatar_url || undefined} alt="头像" className="object-cover" />
                      <AvatarFallback className={cn('bg-gradient-to-br text-white text-xl', gradient)}>{initials}</AvatarFallback>
                    </Avatar>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="absolute -bottom-1 -right-1 w-7 h-7 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors">
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* 名称 & 邮箱 */}
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg md:text-xl font-bold truncate text-balance">
                        {profile?.username || user?.email?.split('@')[0] || '创作者'}
                      </h2>
                      {profile?.role === 'admin' && (
                        <Badge className="text-[10px] bg-warning/15 text-warning border-warning/30 border shrink-0">管理员</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">{user?.email}</p>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />{memberDays == null ? '注册时间未记录' : `注册 ${memberDays} 天`}
                      </span>
                      {!credits.loading && !credits.error && credits.planName && (
                        <Badge variant="outline" className="text-xs border-primary/30 text-primary gap-1">
                          <Star className="w-2.5 h-2.5 fill-primary" />{credits.planName}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Button size="sm" variant="outline" className="shrink-0 gap-1.5 h-9 hidden sm:flex"
                    onClick={() => setIsEditing(true)}>
                    <Edit3 className="w-3.5 h-3.5" />编辑资料
                  </Button>
                </div>

                <Button size="sm" variant="outline" className="w-full gap-1.5 h-9 mt-4 sm:hidden"
                  onClick={() => setIsEditing(true)}>
                  <Edit3 className="w-3.5 h-3.5" />编辑资料
                </Button>
              </div>

              {/* 积分进度条 */}
              {!credits.loading && !credits.error && (
                <div className="px-5 md:px-6 pb-5 pt-1">
                  <Separator className="mb-4" />
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-warning" />AI 积分
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        <span className={creditsLeft < 50 ? 'text-destructive' : 'text-success'}>{creditsLeft.toLocaleString()}</span>
                        <span className="text-muted-foreground font-normal"> / {credits.creditsTotal.toLocaleString()}</span>
                      </span>
                      <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-primary" onClick={() => navigate('/credits')}>
                        充值 <ChevronRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <Progress value={creditsUsedPct} className="h-2.5 rounded-full" />
                  <p className="text-xs text-muted-foreground mt-1.5">已使用 {creditsUsedPct}%</p>
                </div>
              )}
              {credits.loading && <p role="status" className="px-5 pb-5 text-sm">读取积分…</p>}
              {credits.error && <p role="alert" className="px-5 pb-5 text-sm">{credits.error}
                <Button variant="link" onClick={() => void credits.refresh()}>重试积分</Button></p>}
            </div>

            {/* ── 数据统计 ── */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm font-semibold text-muted-foreground">创作概览</p>
                <Button size="sm" variant="outline" disabled={statsLoading} onClick={() => void loadAll()}>刷新概览</Button>
              </div>
              {statsError && <p role="alert" className="text-sm mb-3">{statsError}{stats && '；显示上次成功读取的数据。'}</p>}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard icon={Video} label="视频项目" value={stats?.videos ?? '—'} color="text-primary" bg="bg-primary/10" onClick={() => navigate('/works')} />
                <StatCard icon={Film} label="完成作品" value={stats?.completed ?? '—'} color="text-success" bg="bg-success/10" onClick={() => navigate('/works')} />
                <StatCard icon={Globe} label="已发布记录" value={stats?.published ?? '—'} color="text-success" bg="bg-success/10" onClick={() => navigate('/publish')} />
                <StatCard icon={ImageIcon} label="素材文件" value={stats?.materials ?? '—'} color="text-info" bg="bg-info/10" onClick={() => navigate('/works')} />
                <StatCard icon={Package} label="商品管理" value={stats?.products ?? '—'} color="text-warning" bg="bg-warning/10" onClick={() => navigate('/products')} />
              </div>
            </div>

            {/* ── 活跃热力图 ── */}
            <Card className="rounded-3xl border-border/60">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-primary" />近 30 天创作活跃
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {stats ? `共 ${activity.filter(d => d.count > 0).length} 天创建视频项目` : statsLoading ? '读取中…' : '数据未读取'}
                  </span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {activity.map(d => (
                    <div key={d.date}
                      aria-label={`${d.date}：${d.count} 个视频项目`}
                      title={`${d.date}：${d.count} 个视频项目`}
                      className={cn('w-6 h-6 rounded-md transition-colors', heatColor(d.count))} />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                  <span>{stats?.timezone}</span>
                  <span>少</span>
                  {[0, 1, 2, 3, 4].map(c => (
                    <div key={c} className={cn('w-3.5 h-3.5 rounded-sm', heatColor(c))} />
                  ))}
                  <span>多</span>
                </div>
              </CardContent>
            </Card>

            {/* ── 快捷导航 ── */}
            <Card className="rounded-3xl border-border/60">
              <CardContent className="p-2">
                <p className="text-xs font-semibold text-muted-foreground px-4 pt-3 pb-1">快速入口</p>
                <MenuRow icon={FolderOpen} label="作品素材" desc="查看我的视频作品和素材" onClick={() => navigate('/works')} />
                <MenuRow icon={Zap} label="积分与套餐" desc={!credits.loading && !credits.error ? `剩余 ${creditsLeft} 积分` : '查看用量和充值'} onClick={() => navigate('/credits')} />
                <MenuRow icon={Globe} label="跨平台导出" desc="多格式导出和一键分发" onClick={() => navigate('/export-formats')} />
                <MenuRow icon={TrendingUp} label="投放数据回流" desc="查看广告投放效果" onClick={() => navigate('/data-feedback')} />
                <MenuRow icon={Sparkles} label="AI工具箱" desc="风格复刻、知识库等高级工具" onClick={() => navigate('/ai-toolbox')} />
              </CardContent>
            </Card>

            {/* ── 账号设置 ── */}
            <Card className="rounded-3xl border-border/60">
              <CardContent className="p-2">
                <p className="text-xs font-semibold text-muted-foreground px-4 pt-3 pb-1">账号设置</p>

                {/* 通知开关 */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <Bell className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">消息通知</p>
                    <p className="text-xs text-muted-foreground mt-0.5">视频生成完成时接收通知</p>
                  </div>
                  <Switch aria-label="消息通知" checked={notification} onCheckedChange={handleNotificationToggle} disabled={!profile || notificationSaving} />
                </div>

                <MenuRow icon={Key} label="修改密码" desc="定期更换密码保护账号安全" onClick={() => setPwOpen(true)} />
                <MenuRow icon={Shield} label="账号安全" desc="查看当前会话和退出选项" onClick={() => setSecurityOpen(true)} />

                {/* User ID */}
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">User ID</p>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">{user?.id?.slice(0, 20)}…</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground" onClick={copyUserId}>
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* ── 危险区 ── */}
            <Card className="rounded-3xl border-destructive/20">
              <CardContent className="p-2">
                <MenuRow icon={LogOut} label="退出登录" desc="退出当前账号" danger onClick={async () => {
                  try { await signOut(); navigate('/login'); } catch (cause) { toast.error(cause instanceof Error ? cause.message : '退出失败'); }
                }} />
              </CardContent>
            </Card>

            {/* ── 版本信息 ── */}
            <div className="text-center pb-2">
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground/60">
                <Award className="w-3.5 h-3.5" />
                <span>Shopro-电商AIGC带货视频 v1.0</span>
                <span>·</span>
                <span>© {new Date().getFullYear()}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 修改密码弹窗 ── */}
      <Dialog open={securityOpen} onOpenChange={setSecurityOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader><DialogTitle>当前账号与会话</DialogTitle></DialogHeader>
          <div className="text-sm space-y-3 break-words">
            <p>登录邮箱：{user?.email || '未记录'}</p>
            <p>最近登录：{user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : '未记录'}</p>
            <p>邮箱确认：{user?.email_confirmed_at ? '已确认' : '未确认'}</p>
            <p className="text-muted-foreground">当前信息来自登录会话。历史设备和登录记录需要身份服务提供完整审计。</p>
            <Button variant="outline" onClick={async () => {
              try { await signOut('global'); }
              catch { if (alive.current) toast.error('退出所有会话失败，请重试'); }
            }}>退出所有会话</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={pwOpen} onOpenChange={v => { setPwOpen(v); if (!v) setPwForm({ next: '', confirm: '' }); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-balance">
              <Key className="w-4 h-4 text-primary" />修改密码
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-normal">新密码</label>
              <Input type="password" placeholder="至少 8 位" value={pwForm.next}
                onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-normal">确认新密码</label>
              <Input type="password" placeholder="再次输入新密码" value={pwForm.confirm}
                onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} />
              {pwForm.confirm && pwForm.next !== pwForm.confirm && (
                <p className="text-xs text-destructive flex items-center gap-1"><X className="w-3 h-3" />两次密码不一致</p>
              )}
              {pwForm.confirm && pwForm.next === pwForm.confirm && pwForm.next.length >= 8 && (
                <p className="text-xs text-success flex items-center gap-1"><Check className="w-3 h-3" />密码匹配</p>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPwOpen(false)}>取消</Button>
              <Button className="flex-1 gap-1.5" onClick={handleChangePw} disabled={pwSaving}>
                {pwSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                {pwSaving ? '修改中…' : '确认修改'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
