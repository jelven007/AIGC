import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { pendingMaterialUploads, recoverMaterialUploads, uploadMaterialAsset } from '@/api/materialAssets';

export function useReferenceMaterials(userId: string | undefined) {
  const [rights, setRights] = useState(false), [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(() => userId ? pendingMaterialUploads(userId) : 0);
  const active = useRef(false), locked = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const finish = () => {
    locked.current = false;
    if (active.current) { setBusy(false); setPending(userId ? pendingMaterialUploads(userId) : 0); }
  };
  const recover = async () => {
    if (!userId || locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const result = await recoverMaterialUploads(userId);
      if (!active.current) return;
      if (result.restored) toast.success(`已恢复${result.restored}个原素材登记，请在素材库查看`);
      if (result.pending) toast.error(result.errors[0] || '原素材仍待确认');
    } catch (cause) { if (active.current) toast.error(cause instanceof Error ? cause.message : '恢复失败'); }
    finally { finish(); }
  };
  const upload = async (file: File | undefined, kind: 'image' | 'video', update: (value: string) => void) => {
    if (!file || !userId || locked.current) return;
    if (!rights) { toast.error('请先确认素材使用权'); return; }
    locked.current = true; setBusy(true);
    try {
      if (!file.type.startsWith(kind + '/')) throw new Error('请选择' + (kind === 'image' ? '图片' : '视频') + '素材');
      const material = await uploadMaterialAsset(file, userId, rights);
      if (active.current) { update(material.url); toast.success('参考素材已登记，可在素材库管理'); }
    } catch (cause) { if (active.current) toast.error(cause instanceof Error ? cause.message : '素材登记未确认'); }
    finally { finish(); }
  };
  return { rights, setRights, busy, pending, recover, upload };
}
