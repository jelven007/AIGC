import { useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** Navigation state belongs to the account that received it, including after a remount. */
export function useWorkspaceEntry(userId: string | undefined) {
  const location = useLocation();
  const received = useRef({ key: location.key, userId });
  if (received.current.key !== location.key || !received.current.userId) received.current = { key: location.key, userId };
  return received.current.userId === userId ? location.state : null;
}
