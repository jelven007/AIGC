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

  const save = useCallback((newValue: T) => {
    setValue(newValue);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(newValue));
        setHasDraft(true);
      } catch { /* storage full */ }
    }, debounceMs);
  }, [key, debounceMs]);

  const clear = useCallback(() => {
    clearTimeout(timer.current);
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

  // 组件卸载时清理 timer
  useEffect(() => () => clearTimeout(timer.current), []);

  return { value, save, clear, restore, hasDraft };
}
