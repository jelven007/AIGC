import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/db/supabase';
import type { Profile } from '@/types/types';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  profileError: string | null;
  loading: boolean;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  profileError: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUser = useRef<User | null>(null);
  const mounted = useRef(false);
  const profileRequest = useRef(0);

  const fetchProfile = useCallback(async (userId: string) => {
    const request = ++profileRequest.current;
    const current = () => mounted.current && currentUser.current?.id === userId && request === profileRequest.current;
    try {
      const { data: { session: active }, error: sessionError } = await supabase.auth.getSession();
      if (!current()) return;
      if (sessionError || active?.user.id !== userId) throw new Error('会话已失效，请重新登录');
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId)
        .abortSignal(AbortSignal.timeout(15000)).maybeSingle();
      if (!current()) return;
      if (error) throw new Error('个人资料读取失败，请重试');
      // 注册触发器负责档案、套餐和赠送流水的原子初始化，读取失败不能代替注册事务。
      if (!data || data.id !== userId) throw new Error('账号资料尚未初始化，请重试或联系支持');
      setProfile(data as Profile);
      setProfileError(null);
    } catch (cause) {
      if (!current()) return;
      setProfileError(cause instanceof Error ? cause.message : '个人资料读取失败，请重试');
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (currentUser.current) await fetchProfile(currentUser.current.id);
  }, [fetchProfile]);

  useEffect(() => {
    mounted.current = true;
    let events = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const adopt = (next: Session | null) => {
      if (!mounted.current) return;
      if (currentUser.current?.id !== next?.user.id) {
        profileRequest.current++;
        setProfile(null);
        setProfileError(null);
      }
      currentUser.current = next?.user ?? null;
      setSession(next);
      setUser(next?.user ?? null);
      setLoading(false);
      clearTimeout(timer);
      // 回调内不能等待SDK会话锁；资料读取放到下一轮事件循环。
      if (next?.user) timer = setTimeout(() => void fetchProfile(next.user.id), 0);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      events++;
      adopt(next);
    });
    const initialEvents = events;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (mounted.current && events === initialEvents) adopt(error ? null : data.session);
    }).catch(() => {
      if (mounted.current && events === initialEvents) adopt(null);
    });
    return () => {
      mounted.current = false;
      profileRequest.current++;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = async (scope: 'local' | 'global' = 'local') => {
    const owner = currentUser.current?.id;
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error) throw error;
    } catch (e) {
      console.warn('退出登录未确认:', e);
      throw new Error('退出登录失败，请重试');
    } finally {
      // SIGNED_OUT事件清理状态；迟到的退出结果不能注销随后登录的新账号。
      if (mounted.current && !currentUser.current && owner) {
        profileRequest.current++;
        setSession(null);
        setUser(null);
        setProfile(null);
        setProfileError(null);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, profileError, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
