import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { accountRequest } from '@/api/accountSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function ResetPasswordPage() {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || busy.current) return;
    if (password.length < 8) { setError('新密码至少需要 8 位'); return; }
    if (password !== confirm) { setError('两次密码不一致'); return; }
    const ownerId = user.id;
    busy.current = true; setSaving(true); setError('');
    try {
      const updatedUser = await accountRequest(ownerId, '/auth/v1/user', 'PUT', { password });
      const { data: after, error: afterError } = await supabase.auth.getSession();
      if (afterError || after.session?.user.id !== ownerId || updatedUser?.id !== ownerId) {
        throw new Error('会话已变更，请确认当前账号后重试');
      }
      setPassword(''); setConfirm(''); setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '密码重置失败，请重试');
    } finally { busy.current = false; setSaving(false); }
  };
  return <div className="min-h-screen flex items-center justify-center bg-background p-4">
    <Card className="w-full max-w-md">
      <CardHeader><CardTitle>重置密码</CardTitle><CardDescription>
        {user ? `当前账号：${user.email || user.phone || '已验证账号'}` : '请通过邮箱中的重置链接建立验证会话'}
      </CardDescription></CardHeader>
      <CardContent>
        {!user ? <div className="space-y-4">
          <p role="alert" className="text-sm text-muted-foreground">重置链接已失效或尚未完成验证，请重新申请。</p>
          <Button asChild className="w-full"><Link to="/login?mode=forgot">重新申请重置链接</Link></Button>
        </div> : saved ? <div className="space-y-4">
          <p role="status">密码已更新。</p>
          <Button asChild className="w-full"><Link to="/">进入工作台</Link></Button>
        </div> : <form onSubmit={save} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="reset-password">新密码</Label>
            <Input id="reset-password" type="password" autoComplete="new-password" minLength={8} required
              disabled={saving} value={password} onChange={event => setPassword(event.target.value)} />
          </div>
          <div className="space-y-2"><Label htmlFor="reset-confirm">再次输入新密码</Label>
            <Input id="reset-confirm" type="password" autoComplete="new-password" required
              disabled={saving} value={confirm} onChange={event => setConfirm(event.target.value)} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>{saving ? '正在更新…' : '更新密码'}</Button>
        </form>}
        <Link className="block text-sm text-primary underline text-center mt-4" to="/login?mode=login">返回登录</Link>
      </CardContent>
    </Card>
  </div>;
}
