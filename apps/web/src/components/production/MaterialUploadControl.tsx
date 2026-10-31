import { useRef, useState } from 'react';

export function MaterialUploadControl({ onUpload }: { onUpload: (file: File, rightsConfirmed: boolean) => Promise<void> }) {
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false);
  return <div className="space-y-3 text-sm">
    <p>上传图片、视频或音频（最大50MB）</p>
    <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy}
      onChange={event => setConsent(event.target.checked)} className="mt-1" />我已获得这些素材的使用权</label>
    <input aria-label="上传授权素材" type="file" accept="image/*,video/*,audio/*" disabled={!consent || busy}
      className="w-full min-w-0 text-sm"
      onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file || locked.current || !consent) return;
        locked.current = true; setBusy(true); setError('');
        try { await onUpload(file, consent); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '素材上传未确认，请恢复原上传'); }
        finally { locked.current = false; setBusy(false); }
      }} />
    {busy && <p role="status">正在上传并登记素材…</p>}
    {error && <p role="alert" className="break-words text-amber-400">{error}</p>}
  </div>;
}
