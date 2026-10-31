import { useCallback, useEffect, useRef, useState } from 'react';
import { readTaskReceipt, writeTaskReceipt } from '@/lib/taskReceipt';
import { toast } from 'sonner';

export function useTaskReceipt<T>(key: string, valid: (value: any) => boolean) {
  const [value, setValue] = useState<T | null>(null), [error, setError] = useState('');
  const receipt = useRef<T | null>(null);
  const validator = useRef(valid); validator.current = valid;
  useEffect(() => {
    const saved = readTaskReceipt<T>(key, validator.current);
    receipt.current = saved.value; setValue(saved.value); setError(saved.error);
  }, [key]);
  const write = useCallback((next: T | null) => {
    try {
      writeTaskReceipt(key, next);
      receipt.current = next; setValue(next); setError('');
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '任务回执无法保存';
      setError(message); toast.error(message);
      return false;
    }
  }, [key]);
  return { value, receipt, write, error };
}
