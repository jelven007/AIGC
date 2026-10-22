/**
 * useDraft - localStorage 草稿自动保存 Hook（P1-N05）
 * 防抖 500ms，页面加载时提示恢复
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export function useDraft<T>(key: string, initialValue: T, debounceMs = 500) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const [hasDraft, setHasDraft] = useState<boolean>(() => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  });

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ key: string; value: T } | null>(null);
  const flush = useCallback((updateState = false) => {
    clearTimeout(timer.current);
    const saved = pending.current;
    pending.current = null;
    if (!saved) return;
    try {
      localStorage.setItem(saved.key, JSON.stringify(saved.value));
      if (updateState) setHasDraft(true);
    } catch { /* storage full */ }
  }, []);

  const save = useCallback((newValue: T) => {
    setValue(newValue);
    clearTimeout(timer.current);
    pending.current = { key, value: newValue };
    timer.current = setTimeout(() => flush(true), debounceMs);
  }, [key, debounceMs, flush]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    try { localStorage.removeItem(key); } catch { /* noop */ }
    setHasDraft(false);
    setValue(initialValue);
  }, [key, initialValue]);

  const restore = useCallback((): T | null => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : null;
    } catch {
      return null;
    }
  }, [key]);

  // 离页/换键时按保存时的原键写最后一次内容，避免防抖队列丢失或串入新账号。
  useEffect(() => {
    const persist = () => flush();
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', persist);
    return () => {
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('beforeunload', persist);
      flush();
    };
  }, [key, flush]);

  return { value, save, clear, restore, hasDraft };
}
