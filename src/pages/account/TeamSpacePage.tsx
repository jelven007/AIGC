import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { accessRequest } from '@/api/accessControl';
import { supabase } from '@/db/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, Plus, RefreshCw, Share2, Trash2, Users2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Material } from '@/types/types';

type Role = 'owner' | 'admin' | 'editor' | 'viewer';
interface Team { id: string; name: string; owner_id: string; max_members: number }
interface Member { id: string; user_id: string; role: Role; joined_at: string }
const roleNames: Record<Role, string> = { owner: '所有者', admin: '管理员', editor: '编辑者', viewer: '观察者' };
export default function TeamSpacePage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const token = params.get('token');
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [shared, setShared] = useState<Material[]>([]);
  const [owned, setOwned] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [link, setLink] = useState('');
  const [materialId, setMaterialId] = useState('');
  const owner = team?.owner_id === user?.id;
  const currentRole = members.find(member => member.user_id === user?.id)?.role;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const state = await accessRequest('team-space', { action: 'get' });
      setTeam(state.team); setMembers(state.members);
      const shares = await accessRequest('material-assets', { action: 'shared' });
      setShared(shares.materials);
      if (user) {
        const items = await supabase.from('materials').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
        if (items.error) throw new Error('个人素材读取失败');
        setOwned(items.data as Material[]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '团队读取失败'); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);
  async function perform(body: Record<string, unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await accessRequest('team-space', body);
      if (body.action === 'invite') {
        setLink(`${window.location.origin}/team?token=${result.result.token}`);
      } else {
        if (body.action === 'accept') setParams({});
        setCreateOpen(false); await load();
      }
      toast.success(message);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  }
  async function share(id: string, action: 'share' | 'unshare') {
    if (!team || busy) return;
    setBusy(true);
    try {
      await accessRequest('material-assets', { action, team_id: team.id, material_id: id });
      await load(); toast.success(action === 'share' ? '素材已共享' : '共享已撤销');
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : '共享设置失败'); }
    finally { setBusy(false); }
  }
  return <div className="p-4 md:p-6 space-y-6">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div><h1 className="text-xl font-bold flex items-center gap-2"><Users2 className="w-5 h-5" />团队协作</h1>
        <p className="text-sm text-muted-foreground mt-1">邀请同事访问明确共享的素材，成员离开后停止新签名授权。</p></div>
      <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" />刷新</Button>
    </div>
    {token && <div className="border rounded-xl p-4 space-y-3"><p className="text-sm">使用已验证的邀请邮箱登录后，可接受团队邀请。</p>
      <Button disabled={busy || !!team} onClick={() => perform({ action: 'accept', token }, '已加入团队')}>接受邀请</Button></div>}
    {error && <div role="alert" className="border border-destructive/40 rounded-xl p-4 text-sm">{error}</div>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取团队…</p> : !team && !error
      ? <div className="border rounded-xl p-10 text-center space-y-3"><p>还没有团队</p>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" />创建团队</Button></div> : team && <>
        <div className="border rounded-xl p-4"><h2 className="font-semibold break-words">{team.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{members.length}/{team.max_members} 位成员 · 当前角色：{currentRole ? roleNames[currentRole] : '未加入'}</p></div>
        <div className="border rounded-xl p-4 space-y-3"><h2 className="font-semibold">团队成员</h2>
          {members.map(member => <div key={member.id} className="flex gap-3 items-center">
            <p className="text-sm flex-1 min-w-0 truncate">{member.user_id === user?.id ? '我' : `用户 ${member.user_id.slice(0, 8)}`}</p>
            {owner && member.role !== 'owner' ? <>
              <Select value={member.role} disabled={busy} onValueChange={value => perform({ action: 'role', team_id: team.id, member_id: member.id, role: value }, '角色已更新')}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{(['admin', 'editor', 'viewer'] as Role[]).map(value => <SelectItem key={value} value={value}>{roleNames[value]}</SelectItem>)}</SelectContent></Select>
              <Button variant="outline" size="sm" disabled={busy} aria-label="移除成员" onClick={() => perform({ action: 'remove', team_id: team.id, member_id: member.id }, '成员已移除')}><Trash2 className="w-4 h-4" /></Button>
            </> : <span className="text-sm text-muted-foreground">{roleNames[member.role]}</span>}
          </div>)}</div>
        {owner && <div className="border rounded-xl p-4 space-y-3"><h2 className="font-semibold">邀请成员</h2>
          <label className="block text-sm">邮箱<Input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="colleague@example.com" /></label>
          <Select value={role} onValueChange={value => setRole(value as Role)}><SelectTrigger aria-label="邀请角色"><SelectValue /></SelectTrigger>
            <SelectContent>{(['admin', 'editor', 'viewer'] as Role[]).map(value => <SelectItem key={value} value={value}>{roleNames[value]}</SelectItem>)}</SelectContent></Select>
          <Button disabled={busy || !email.trim()} onClick={() => perform({ action: 'invite', team_id: team.id, email, role }, '邀请链接已创建，等待对方接受')}>生成邀请链接</Button>
          {link && <div className="flex items-center gap-2"><Input readOnly value={link} aria-label="邀请链接" className="min-w-0 text-xs" />
            <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(link); toast.success('已复制'); } catch { toast.error('复制失败，请手动保存'); } }} aria-label="复制邀请链接"><Copy className="w-4 h-4" /></Button></div>}
        </div>}
        <div className="border rounded-xl p-4 space-y-3"><h2 className="font-semibold flex items-center gap-2"><Share2 className="w-4 h-4" />共享素材</h2>
          <p className="text-sm text-muted-foreground">成员可在自己的创作任务中引用素材，费用由提交者账号承担。所有者管理成员；管理员和编辑者可共享自己的素材；观察者可读取。</p>
          {currentRole && currentRole !== 'viewer' && <div className="flex gap-2">
            <Select value={materialId} onValueChange={setMaterialId}><SelectTrigger className="min-w-0 flex-1" aria-label="选择个人素材"><SelectValue placeholder="选择个人素材" /></SelectTrigger>
              <SelectContent>{owned.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
            <Button disabled={busy || !materialId} onClick={() => share(materialId, 'share')}>共享</Button></div>}
          {!shared.length && <p className="text-sm text-muted-foreground">尚无共享素材</p>}
          {shared.map(item => <div key={item.id} className="flex items-center gap-3">
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm flex-1 min-w-0 truncate underline">{item.name}</a>
            {item.user_id === user?.id && <Button variant="outline" size="sm" disabled={busy} onClick={() => share(item.id, 'unshare')}>撤销共享</Button>}</div>)}
        </div>
      </>}
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>创建团队</DialogTitle></DialogHeader>
      <label className="text-sm">团队名称<Input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <Button disabled={busy || !name.trim()} onClick={() => perform({ action: 'create', name }, '团队已创建')}>{busy ? '创建中…' : '创建'}</Button>
    </DialogContent></Dialog>
  </div>;
}
