import { authenticatedEdgeRequest } from '@/lib/edgeRequest';
import { requireAccountSession } from './accountSession';

export async function accessRequest(name: 'api-keys' | 'team-space' | 'material-assets', body: Record<string, unknown>, expectedUserId?: string) {
  const session = await requireAccountSession(expectedUserId);
  const response = await authenticatedEdgeRequest(name, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, '', session.user.id);
  const result = await response.json();
  await requireAccountSession(session.user.id);
  return result;
}
export async function deleteMaterial(id: string) {
  return accessRequest('material-assets', { action: 'delete', material_id: id });
}
