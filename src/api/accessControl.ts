import { authenticatedEdgeRequest } from '@/lib/edgeRequest';

export async function accessRequest(name: 'api-keys' | 'team-space' | 'material-assets', body: Record<string, unknown>) {
  const response = await authenticatedEdgeRequest(name, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
export async function deleteMaterial(id: string) {
  return accessRequest('material-assets', { action: 'delete', material_id: id });
}
