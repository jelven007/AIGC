import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CUSTOM_MODEL_TYPES, modelSettingsErrorMessage, type CustomModelType, type ModelConfigView, type modelSettingsRequest } from '@/api/modelSettings';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function CreateModelConfigDialog({ request, onClose, onCreated }: {
  request: typeof modelSettingsRequest; onClose: () => void; onCreated: (config: ModelConfigView) => Promise<void>;
}) {
  const [category, setCategory] = useState<CustomModelType>('text');
  const [name, setName] = useState('');
  const [id, setId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ config: ModelConfigView }>({ action: 'create', scope: 'models', category, id, name: name.trim() });
      if (!result.config?.version_id || result.config.slot !== `custom.${category}.${id}`) {
        throw new Error('服务端未返回创建结果，请重试。');
      }
      await onCreated(result.config);
      toast.success('模型配置已创建');
      onClose();
    } catch (cause) { setError(modelSettingsErrorMessage(cause)); }
    finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>新建模型配置</DialogTitle>
        <DialogDescription>选择类型后，配置入口会出现在对应分类下。</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="space-y-5">
        <label className="block space-y-2 text-sm">模型类型
          <select disabled={busy} value={category} onChange={event => {
            setCategory(event.target.value as CustomModelType); setId(crypto.randomUUID()); setError('');
          }} className="w-full h-10 rounded-md border border-input bg-background px-3">
            {CUSTOM_MODEL_TYPES.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
        </label>
        <label className="block space-y-2 text-sm">配置名称
          <Input autoFocus required disabled={busy} maxLength={200} value={name} onChange={event => {
            setName(event.target.value); setId(crypto.randomUUID()); setError('');
          }} placeholder="填写便于识别的模型名称" />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}创建配置</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
