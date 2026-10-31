/**
 * useDraft - localStorage 草稿自动保存 Hook（P1-N05）
 * 防抖 500ms，页面加载时提示恢复
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export function useDraft<T>(key: string, initialValue: T, debounceMs = 500, decode?: (raw: unknown) => T | null) {
  const decoder = useRef(decode);
  decoder.current = decode;
  const read = useCallback((): T | null => {
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return null;
      const raw = JSON.parse(stored);
      return decoder.current ? decoder.current(raw) : raw;
    } catch { return null; }
  }, [key]);
  const [restored] = useState(read);
  const [value, setValue] = useState<T>(restored ?? initialValue);
  const [hasDraft, setHasDraft] = useState(restored !== null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<{ key: string; value: T } | null>(null);
  const flush = useCallback((updateState = false) => {
    clearTimeout(timer.current);
    const saved = pending.current;
    pending.current = null;
    if (!saved) return;
    try {
      const accepted = decoder.current ? decoder.current(saved.value) : saved.value;
      if (accepted === null) localStorage.removeItem(saved.key);
      else localStorage.setItem(saved.key, JSON.stringify(accepted));
      if (updateState) setHasDraft(accepted !== null);
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

  const restore = read;

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
