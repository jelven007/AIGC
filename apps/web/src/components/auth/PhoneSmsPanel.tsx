import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/db/supabase';
import { createClient } from '@supabase/supabase-js';
import { backendAnonKey, backendUrl } from '@/lib/backendConfig';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { LegalConsent, legalDocumentsReady } from './LegalConsent';

/** 中国大陆号码允许空格/+86前缀；其他地区需使用完整E.164号码。 */
function normalizePhone(input: string): string | null {
  const value = input.trim().replace(/[\s()-]/g, '');
  if (/^1[3-9]\d{9}$/.test(value)) return `+86${value}`;
  if (/^\+861[3-9]\d{9}$/.test(value)) return value;
  if (/^\+(?!86)\d{8,15}$/.test(value) && !value.startsWith('+0')) return value;
  return null;
}

function authMessage(cause: unknown, fallback: string): string {
  const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : undefined;
  if (status === 0 || status && status >= 500) return fallback;
  if (status === 429) return '请求过于频繁，请稍后重试';
  return cause instanceof Error ? cause.message : fallback;
}

export default function PhoneSmsPanel({ inviteCode, register }: { inviteCode: string | null; register: boolean }) {
  const [phone, setPhone] = useState(''), [code, setCode] = useState('');
  const [sentPhone, setSentPhone] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0), [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [agreed, setAgreed] = useState(false), [error, setError] = useState('');
  const abort = useRef(new AbortController());
  const [smsAuth] = useState(() => createClient(backendUrl, backendAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `shopro-sms-${crypto.randomUUID()}` },
    global: { fetch: (input, init) => fetch(input, { ...init,
      signal: AbortSignal.any([abort.current.signal, AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) }) },
  }).auth);
  const mounted = useRef(false), locked = useRef(false), generation = useRef(0);
  const resendAt = useRef(0);
  useEffect(() => {
    mounted.current = true;
    if (abort.current.signal.aborted) abort.current = new AbortController();
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((resendAt.current - Date.now()) / 1000))), 1000);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); abort.current.abort(); };
  }, []);
  const send = async () => {
    if (locked.current || Date.now() < resendAt.current) return;
    const originalPhone = sentPhone || normalizePhone(phone);
    if (!originalPhone) { setError('请输入有效手机号；非中国大陆号码请包含国际区号，如 +14155552671'); return; }
    if (register && (!legalDocumentsReady || !agreed)) { setError('请阅读并同意已发布的用户协议和隐私政策'); return; }
    locked.current = true; setBusy('send'); setError('');
    const request = generation.current;
    const current = () => mounted.current && request === generation.current;
    try {
      const { data: before, error: sessionError } = await supabase.auth.getSession();
      if (!current()) return;
      if (sessionError || before.session) throw new Error('当前会话已变更，请返回后重试');
      const { error: cause } = await smsAuth.signInWithOtp({ phone: originalPhone, options: {
        channel: 'sms', shouldCreateUser: register,
        ...(register ? { data: { invited_by_code: inviteCode?.trim().toUpperCase() || null } } : {}),
      } });
      if (!current()) return;
      if (cause) throw cause;
      setSentPhone(originalPhone); setCode('');
      resendAt.current = Date.now() + 60000; setRemaining(60);
      toast.success('验证码已发送，请注意查收');
    } catch (cause) {
      if (current()) {
        const status = cause && typeof cause === 'object' && 'status' in cause ? Number(cause.status) : undefined;
        if (status === 0 || status && status >= 500) {
          setSentPhone(originalPhone);
          resendAt.current = Date.now() + 60000; setRemaining(60);
          setError('验证码发送结果暂未确认；若已收到可继续验证，或等待60秒后重发');
        } else setError(authMessage(cause, '短信服务暂不可用，请稍后重试'));
      }
    } finally { if (current()) { locked.current = false; setBusy(null); } }
  };
  const verify = async () => {
    if (locked.current || !sentPhone) return;
    if (!/^\d{6}$/.test(code.trim())) { setError('请输入6位数字验证码'); return; }
    locked.current = true; setBusy('verify'); setError('');
    const request = generation.current, originalPhone = sentPhone;
    const current = () => mounted.current && request === generation.current;
    try {
      const { data: before, error: sessionError } = await supabase.auth.getSession();
      if (!current()) return;
      if (sessionError || before.session) throw new Error('当前会话已变更，请返回后重试');
      // 隔离客户端验证不会在旧页面请求迟到后改写全局登录身份。
      const { data, error: cause } = await smsAuth.verifyOtp({ phone: originalPhone, token: code.trim(), type: 'sms' });
      if (!current()) return;
      if (cause) throw cause;
      if (!data.session || !data.user || data.session.user.id !== data.user.id || data.user.phone?.replace(/^\+/, '') !== originalPhone.slice(1)) {
        throw new Error('登录会话回执不完整，请重试或联系支持');
      }
      const { data: latest, error: latestError } = await supabase.auth.getSession();
      if (!current()) return;
      if (latestError || latest.session) throw new Error('当前会话已变更，请返回后重试');
      const adopted = await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      if (!current()) return;
      if (adopted.error) throw adopted.error;
      // AuthProvider按真实会话跳转并保留原redirect；迟到组件不再导航。
    } catch (cause) {
      if (current()) setError(authMessage(cause, '验证码验证暂不可用，请稍后重试'));
    } finally { if (current()) { locked.current = false; setBusy(null); } }
  };
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void (sentPhone ? verify() : send()); }}>
    <div className="space-y-1.5">
      <Label htmlFor="sms-phone">手机号</Label>
      <Input id="sms-phone" type="tel" autoComplete="tel" placeholder="13800138000 或 +14155552671"
        value={phone} maxLength={24} onChange={event => { setPhone(event.target.value); setError(''); }} disabled={!!sentPhone || !!busy} />
    </div>
    {register && <LegalConsent agreed={agreed} onChange={setAgreed} disabled={!!busy || !!sentPhone} />}
    {sentPhone && <div className="space-y-1.5">
      <Label htmlFor="sms-code">验证码</Label>
      <p className="text-xs text-muted-foreground">接收验证码的手机号：{sentPhone}</p>
      <div className="flex gap-2">
        <Input id="sms-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={event => { setCode(event.target.value); setError(''); }} disabled={!!busy} />
        <Button type="button" variant="outline" disabled={remaining > 0 || !!busy} onClick={() => void send()}>
          {remaining > 0 ? `${remaining}s 后重发` : '重新发送'}
        </Button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive break-words">{error}</p>}
    <Button type="submit" className="w-full" disabled={!!busy || (!sentPhone && remaining > 0) || (register && (!agreed || !legalDocumentsReady))}>
      {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />{busy === 'send' ? '发送中…' : '验证中…'}</> :
        sentPhone ? '验证并登录' : remaining > 0 ? `${remaining}s 后重发` : '获取验证码'}
    </Button>
    {sentPhone && <Button type="button" variant="ghost" className="w-full" disabled={!!busy} onClick={() => {
      generation.current++; setSentPhone(null); setCode(''); setError('');
      // 换号码不绕过当前页发送冷却。
    }}>修改手机号</Button>}
    <p className="text-xs text-muted-foreground">{register ? '首次验证将创建账号；有效邀请按账号验证结果结算。' : '仅登录已有手机号账号。首次使用请返回注册。'}</p>
  </form>;
}
