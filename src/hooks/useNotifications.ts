import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { mutateNotifications, readNotifications, type NotificationCategory } from '@/api/notifications';

export function useNotifications(category: NotificationCategory = 'all', offset = 0) {
  const { user } = useAuth();
  const uid = user?.id;
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications', uid, category, offset],
    queryFn: () => readNotifications(category, offset),
    enabled: !!uid, staleTime: 15000, refetchInterval: 20000, retry: 1,
  });
  const mutation = useMutation({
    mutationKey: ['notifications', uid],
    mutationFn: mutateNotifications,
    onSettled: () => client.invalidateQueries({ queryKey: ['notifications', uid] }),
  });
  const mutating = useIsMutating({ mutationKey: ['notifications', uid] }) > 0;
  return { ...query, feed: uid ? query.data : undefined, mutate: mutation.mutateAsync, mutating,
    mutationError: mutation.error };
}
