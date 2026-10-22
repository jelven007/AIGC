import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LegalConsent, legalDocumentsReady } from '@/components/auth/LegalConsent';
import PhoneSmsPanel from '@/components/auth/PhoneSmsPanel';
import {
  Eye, EyeOff, Video, Sparkles, TrendingUp, Zap,
  Mail, Lock, ArrowLeft, CheckCircle2, KeyRound, Phone,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// 三种模式：login / register / forgot / phone
type Mode = 'login' | 'register' | 'forgot' | 'phone';

const BRAND_FEATURES = [
  { icon: Zap, title: 'AI脚本生成', desc: '确认商品信息与分镜台词后创作' },
  { icon: Video, title: '可视化编辑', desc: '分镜时间轴，拖拽式流畅操作' },
  { icon: TrendingUp, title: '效果分析', desc: '查看已采集指标与实验结果' },
  { icon: Sparkles, title: '竞品情报', desc: '按已配置来源采集和分析' },
];

// 浮动粒子组件
function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 24 }).map((_, i) => {
        const size = 2 + (i % 4);
        const left = (i * 37 + 11) % 95;
        const top = (i * 53 + 7) % 90;
        const dur = 4 + (i % 5) * 1.4;
        const delay = (i * 0.3) % 3;
        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: size, height: size,
              left: `${left}%`, top: `${top}%`,
              background: i % 3 === 0 ? 'rgba(255,107,0,0.6)' : i % 3 === 1 ? 'rgba(0,229,153,0.5)' : 'rgba(255,255,255,0.35)',
              animation: `particle-float ${dur}s ease-in-out ${delay}s infinite alternate`,
            }}
          />
        );
      })}
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden flex-col justify-between items-center py-16 px-16"
      style={{ background: 'linear-gradient(135deg, #0d0c14 0%, #1a1028 40%, #0f1a24 100%)' }}>

      {/* 深色网格底纹 */}
      <div className="absolute inset-0 opacity-15"
        style={{ backgroundImage: 'linear-gradient(rgba(255,107,0,.15) 1px,transparent 1px),linear-gradient(90deg,rgba(255,107,0,.15) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />

      {/* 大光晕 1 — 橙色 */}
      <div className="absolute -top-24 -left-24 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(255,107,0,0.18) 0%, transparent 70%)', animation: 'glow-pulse 6s ease-in-out infinite' }} />
      {/* 大光晕 2 — 绿色 */}
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,229,153,0.14) 0%, transparent 70%)', animation: 'glow-pulse 8s ease-in-out 2s infinite' }} />
      {/* 光晕 3 — 紫色中心 */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)' }} />

      {/* 浮动粒子 */}
      <FloatingParticles />

      {/* 居中内容容器 */}
      <div className="max-w-xl w-full flex flex-col justify-between h-full relative z-10">
        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <img src="/shopro.png" className="w-12 h-12 object-contain shrink-0" alt="Shopro Logo" />
          <div>
            <p className="font-bold text-white text-xl leading-none tracking-wide">Shopro AIGC 带货</p>
            <p className="text-white/50 text-sm mt-1">电商视频生成平台</p>
          </div>
        </div>

        {/* 核心标语 */}
        <div className="relative space-y-7 my-auto py-12">
          {/* 小角标 */}
          <div className="flex gap-2">
            <span className="text-[13px] font-semibold px-3.5 py-1.5 rounded-full border"
              style={{ borderColor: 'rgba(255,107,0,0.5)', color: '#FF6B00', background: 'rgba(255,107,0,0.1)' }}>
              AI 驱动
            </span>
            <span className="text-[13px] font-semibold px-3.5 py-1.5 rounded-full border"
              style={{ borderColor: 'rgba(0,229,153,0.5)', color: '#00E599', background: 'rgba(0,229,153,0.1)' }}>
              实时生成
            </span>
          </div>

          <h1 className="text-6xl md:text-7xl font-black text-white leading-[1.1] text-balance" style={{ letterSpacing: '-0.02em' }}>
            带货视频<br />
            <span style={{
              background: 'linear-gradient(90deg, #FF6B00 0%, #ff9f45 40%, #00E599 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              智能生成
            </span>
          </h1>
          <p className="text-white/70 text-lg leading-relaxed max-w-sm text-pretty">
            低成本批量生产高转化潜力的抖音/TikTok带货视频<br />
            让 AI 替你完成从脚本到成片的全部创作
          </p>

          {/* 实际创作流程 */}
          <div className="flex gap-8 pt-2">
            {[
              { num: '01', label: '确认脚本' },
              { num: '02', label: '后台生成' },
              { num: '03', label: '预览发布' },
            ].map(({ num, label }) => (
              <div key={label}>
                <p className="text-3xl font-black text-white leading-none">{num}</p>
                <p className="text-sm text-white/50 mt-1">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 功能特性卡片 */}
        <div className="relative grid grid-cols-2 gap-3">
          {BRAND_FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title}
              className="rounded-xl p-4 space-y-1.5 transition-all duration-300 hover:scale-[1.02]"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(8px)' }}>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ background: 'rgba(255,107,0,0.2)' }}>
                  <Icon className="w-3.5 h-3.5" style={{ color: '#FF6B00' }} />
                </div>
                <span className="text-white text-sm font-semibold">{title}</span>
              </div>
              <p className="text-white/50 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const inviteCodeParam = searchParams.get('invite');
  const destination = searchParams.get('redirect') === '/credits?tab=plans' ? '/credits?tab=plans' : '/';

  // F-04: 默认直接进入“立即注册”界面
  const requestedMode = searchParams.get('mode');
  const initialMode: Mode = requestedMode && ['login', 'register', 'forgot', 'phone'].includes(requestedMode)
    ? requestedMode as Mode : 'register';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phoneRegister, setPhoneRegister] = useState(initialMode === 'register' || !!inviteCodeParam);

  useEffect(() => {
    if (initialMode) setMode(initialMode);
  }, [initialMode]);
  useEffect(() => {
    if (requestedMode === 'reset') navigate('/auth/reset', { replace: true });
  }, [requestedMode, navigate]);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mounted = useRef(false), requestVersion = useRef(0), busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current++; }; }, []);
  useEffect(() => { requestVersion.current++; busy.current = false; setLoading(false); }, [mode]);

  // 已登录用户直接跳转工作台
  useEffect(() => {
    if (!authLoading && user) navigate(destination, { replace: true });
  }, [user, authLoading, navigate, destination]);

  const set = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: '' }));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (mode === 'forgot') {
      if (!form.email.trim()) errs.email = '请输入邮箱地址';
      else if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = '邮箱格式不正确';
    } else {
      if (!form.username.trim()) errs.username = '请输入邮箱账号';
      else if (!/\S+@\S+\.\S+/.test(form.username.trim())) errs.username = '请输入完整邮箱地址';
      if (!form.password) errs.password = '请输入密码';
      else if (form.password.length < 6) errs.password = '密码至少 6 位';
      if (mode === 'register') {
        if (!form.confirmPassword) errs.confirmPassword = '请再次输入密码';
        else if (form.password !== form.confirmPassword) errs.confirmPassword = '两次密码不一致';
        if (!legalDocumentsReady || !agreed) errs.agreed = '请阅读并同意已发布的用户协议和隐私政策';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    if (!validate()) return;
    busy.current = true;
    const request = requestVersion.current;
    const current = () => mounted.current && request === requestVersion.current;
    setLoading(true);

    try {
      if (mode === 'forgot') {
        const resetEmail = form.email.trim();
        const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
          redirectTo: `${window.location.origin}/auth/reset`,
        });
        if (!current()) return;
        if (error) throw error;
        setForgotSent(true);
        toast.success('重置链接已发送，请检查您的邮箱');
      } else {
        const email = form.username.trim();
        if (mode === 'login') {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password: form.password });
          if (!current()) return;
          if (error) throw error;
          if (!data.session || !data.user) throw new Error('登录会话未建立，请重试');
          toast.success('登录成功，欢迎回来！');
          navigate(destination);
        } else {
          const { data, error } = await supabase.auth.signUp({
            email,
            password: form.password,
            options: {
              emailRedirectTo: `${window.location.origin}/login?mode=login`,
              data: {
                invited_by_code: inviteCodeParam?.trim().toUpperCase() || null
              }
            }
          });
          if (!current()) return;
          if (error) throw error;

          if (data.session) {
            toast.success('注册成功，欢迎加入！');
            navigate(destination);
          } else {
            toast.info('请查收验证邮件后登录；若邮箱已注册，请直接登录');
            setMode('login');
          }
        }
      }
    } catch (err: unknown) {
      if (!current()) return;
      const msg = err instanceof Error ? err.message : '操作失败';
      if (msg.includes('Invalid login credentials')) {
        setErrors({ password: '用户名或密码错误' });
      } else if (msg.includes('User already registered')) {
        setErrors({ username: '该邮箱账号已注册，请直接登录' });
      } else if (msg.includes('Email not confirmed')) {
        setErrors({ password: '账号未验证，请检查邮箱' });
      } else if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        toast.error('请求过于频繁，为保障账号安全，请稍候 1~2 分钟后再试');
      } else {
        toast.error(msg);
      }
    } finally {
      if (current()) { busy.current = false; setLoading(false); }
    }
  };

  const titleMap: Record<Mode, string> = {
    login: '欢迎回来',
    register: '创建账号',
    forgot: '找回密码',
    phone: phoneRegister ? '手机号注册' : '手机号登录',
  };
  const subtitleMap: Record<Mode, string> = {
    login: '使用您的账号登录 Shopro-电商AIGC带货视频平台',
    register: '填写信息，开启 AI 视频创作之旅',
    forgot: '输入注册邮箱，我们将发送重置链接',
    phone: phoneRegister ? '验证手机号，创建您的账号' : '使用验证码登录已有账号',
  };

  return (
    <div className="min-h-screen flex bg-background">
      <BrandPanel />
      {/* 右侧表单区 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-4 sm:py-12 bg-background relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-info/5 rounded-full blur-[120px] pointer-events-none" />

        {/* 移动端 Logo */}
        <div className="lg:hidden flex items-center gap-2 mb-4 sm:mb-8">
          <img src="/shopro.png" className="w-9 h-9 object-contain shrink-0" alt="Shopro Logo" />
          <span className="font-bold text-foreground text-lg">Shopro AIGC 带货</span>
        </div>

        {/* 登录主体卡片 */}
        <div className="w-full max-w-md relative bg-background border border-border/60 rounded-2xl sm:rounded-3xl p-5 sm:p-6 md:p-8 shadow-xl">
          {/* 返回按钮（找回密码/手机号模式） */}
          {(mode === 'forgot' || mode === 'phone') && (
            <button
              type="button"
              disabled={loading}
              onClick={() => { setMode('register'); setForgotSent(false); setErrors({}); }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
            >
              <ArrowLeft className="w-4 h-4" />返回注册
            </button>
          )}

          {/* 标题 */}
          <div className="mb-3 text-left">
            <h2 className="text-2xl font-black text-foreground tracking-tight">{titleMap[mode]}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitleMap[mode]}</p>
          </div>
          {mode === 'register' && inviteCodeParam && <p className="mb-4 rounded-md border p-3 text-sm text-muted-foreground">
            已携带邀请码。有效邀请在账号验证后，双方各获 50 积分；注册另赠 20 积分。
          </p>}

          {/* 找回密码成功状态 / 手机号验证面板 / 普通表单 */}
          {mode === 'phone' ? (
            <PhoneSmsPanel key={phoneRegister ? 'register' : 'login'} inviteCode={inviteCodeParam} register={phoneRegister} />
          ) : forgotSent ? (
            <div className="rounded-2xl border border-success/20 bg-success/5 p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-success/15 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6 text-success" />
              </div>
              <p className="font-semibold text-foreground">重置链接已发送</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                请检查您的邮箱，点击链接重置密码。如未收到，请检查垃圾邮件文件夹。
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setMode('login'); setForgotSent(false); }}>
                返回登录
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
              {/* 忘记密码：邮箱输入 */}
              {mode === 'forgot' && (
                <div className="space-y-1 sm:space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-semibold text-foreground">邮箱地址</Label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 pointer-events-none" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={form.email}
                      onChange={e => set('email', e.target.value)}
                      className={cn('pl-10 h-10 sm:h-11 rounded-lg sm:rounded-xl bg-muted/20 border-border/60 focus-visible:ring-primary', errors.email && 'border-destructive focus-visible:ring-destructive')}
                    />
                  </div>
                  {errors.email && <p className="text-xs text-destructive flex items-center gap-1">{errors.email}</p>}
                </div>
              )}

              {/* 登录/注册：邮箱账号 */}
              {mode !== 'forgot' && (
                <div className="space-y-1 sm:space-y-1.5">
                  <Label htmlFor="username" className="text-sm font-semibold text-foreground">邮箱账号</Label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 pointer-events-none" />
                    <Input
                      id="username"
                      placeholder="请输入邮箱账号，如 name@example.com"
                      value={form.username}
                      onChange={e => set('username', e.target.value)}
                      className={cn('pl-10 h-10 sm:h-11 rounded-lg sm:rounded-xl bg-muted/20 border-border/60 focus-visible:ring-primary', errors.username && 'border-destructive focus-visible:ring-destructive')}
                    />
                  </div>
                  {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
                </div>
              )}

              {/* 密码 */}
              {mode !== 'forgot' && (
                <div className="space-y-1 sm:space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-semibold text-foreground">密码</Label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => { setMode('forgot'); setErrors({}); }}
                        className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                      >
                        忘记密码？
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 pointer-events-none" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder={mode === 'register' ? '至少 6 位密码' : '请输入密码'}
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      className={cn('pl-10 pr-10 h-10 sm:h-11 rounded-lg sm:rounded-xl bg-muted/20 border-border/60 focus-visible:ring-primary', errors.password && 'border-destructive focus-visible:ring-destructive')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
                </div>
              )}

              {/* 确认密码（注册） */}
              {mode === 'register' && (
                <div className="space-y-1 sm:space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-sm font-semibold text-foreground">确认密码</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/70 pointer-events-none" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="再次输入密码"
                      value={form.confirmPassword}
                      onChange={e => set('confirmPassword', e.target.value)}
                      className={cn('pl-10 h-10 sm:h-11 rounded-lg sm:rounded-xl bg-muted/20 border-border/60 focus-visible:ring-primary', errors.confirmPassword && 'border-destructive focus-visible:ring-destructive')}
                    />
                  </div>
                  {errors.confirmPassword && <p className="text-xs text-destructive">{errors.confirmPassword}</p>}
                </div>
              )}

              {/* 用户协议（注册） */}
              {mode === 'register' && (
                <div className="space-y-1">
                  <LegalConsent agreed={agreed} disabled={loading} onChange={value => { setAgreed(value); setErrors(e => ({ ...e, agreed: '' })); }} />
                  {errors.agreed && <p className="text-xs text-destructive pl-6">{errors.agreed}</p>}
                </div>
              )}

              {/* 提交按钮 - 橙红色 */}
              <Button type="submit" className="w-full h-10 sm:h-11 font-semibold rounded-lg sm:rounded-xl shadow-md transition-transform hover:-translate-y-0.5 bg-gradient-to-r from-orange-500 via-orange-600 to-red-500 hover:from-orange-600 hover:via-orange-700 hover:to-red-600 text-white shadow-orange-500/20" disabled={loading || (mode === 'register' && !legalDocumentsReady)}>
                {loading
                  ? <span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />处理中...</span>
                  : mode === 'login' ? '登 录' : mode === 'register' ? '立 即 注 册' : '发送重置链接'
                }
              </Button>

              {/* 分隔线 */}
              {mode !== 'forgot' && (
                <div className="relative my-1 sm:my-2">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                  <div className="relative flex justify-center"><span className="bg-background px-3 text-xs text-muted-foreground">或</span></div>
                </div>
              )}

              {/* 手机号验证入口 */}
              {(mode === 'login' || mode === 'register') && (
                <button type="button" disabled={loading} onClick={() => { setPhoneRegister(mode === 'register'); setMode('phone'); setErrors({}); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all">
                  <Phone className="w-4 h-4" />
                  {mode === 'register' ? '手机号验证码注册' : '手机号验证码登录'}
                </button>
              )}

              {/* 切换模式 */}
              {mode === 'login' && (
                <p className="text-sm text-center text-muted-foreground mt-2">
                  还没有账号？
                  <button type="button" disabled={loading} onClick={() => { setMode('register'); setErrors({}); setForm(f => ({ ...f, confirmPassword: '' })); }}
                    className="text-primary font-medium hover:underline ml-1">
                    立即注册
                  </button>
                </p>
              )}
              {mode === 'register' && (
                <p className="text-sm text-center text-muted-foreground mt-2">
                  已有账号？
                  <button type="button" disabled={loading} onClick={() => { setMode('login'); setErrors({}); }}
                    className="text-primary font-medium hover:underline ml-1">
                    直接登录
                  </button>
                </p>
              )}
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
