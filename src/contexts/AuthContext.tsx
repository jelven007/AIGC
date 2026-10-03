import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/db/supabase';
import type { Profile } from '@/types/types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  // 记录已尝试过兜底建档的用户，避免建档失败后随会话轮询反复重试
  const profileAttemptRef = useRef<Set<string>>(new Set());

  // 使用 Web Crypto API 生成密码学安全、无混淆字符的邀请码
  const generateSecureInviteCode = (): string => {
    try {
      const array = new Uint8Array(8);
      window.crypto.getRandomValues(array);
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let code = '';
      for (let i = 0; i < array.length; i++) {
        code += chars[array[i] % chars.length];
      }
      return code;
    } catch {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
    }
  };

  const fetchProfile = async (userId: string) => {
    // 先尝试获取
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (data) {
      profileAttemptRef.current.delete(userId);
      if (!data.invite_code) {
        const code = generateSecureInviteCode();
        const { data: updatedData, error: updateErr } = await supabase
          .from('profiles')
          .update({ invite_code: code })
          .eq('id', userId)
          .select()
          .maybeSingle();
        if (!updateErr && updatedData) {
          setProfile(updatedData as Profile);
          return;
        }
      }
      setProfile(data as Profile);
      return;
    }
    // 如果没有 profile 记录，自动创建一个（兜底逻辑）
    // 同一用户仅尝试一次：兜底 INSERT 线上会被 RLS 拒为 403，
    // 若不加退避，auth 状态变化与会话轮询会反复重建造成重试风暴
    if (profileAttemptRef.current.has(userId)) return;
    profileAttemptRef.current.add(userId);
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return;
    const username = user.email ? user.email.split('@')[0] : 'user';
    const code = generateSecureInviteCode();
    // upsert + ignoreDuplicates（等价 INSERT IGNORE）：命中已有记录时直接跳过，
    // 仅依赖 INSERT 策略，不会触发 UPDATE 分支
    const { error: insertErr } = await supabase.from('profiles').upsert({
      id: userId,
      email: user.email,
      username,
      role: 'user',
      invite_code: code,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (insertErr) {
      console.error('自动创建 profile 失败:', insertErr);
      return;
    }
    // 重新获取
    const { data: newData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (newData) setProfile(newData as Profile);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setProfile(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async (scope: 'local' | 'global' = 'local') => {
    try {
      await supabase.auth.signOut({ scope });
    } catch (e) {
      console.warn('Supabase auth.signOut error, clearing client state anyway:', e);
    } finally {
      setSession(null);
      setUser(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
