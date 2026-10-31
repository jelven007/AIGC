import { useAuth } from '@/contexts/AuthContext';
import ServiceConfigEditor from '@/components/ServiceConfigEditor';
import PlatformAppSettings from '@/components/PlatformAppSettings';

export default function IntegrationSettingsPage() {
  const { user } = useAuth();
  if (user?.app_metadata?.role !== 'admin') return <div className="mx-auto max-w-4xl p-6 md:p-10">
    <h1 className="text-2xl font-semibold">第三方集成</h1>
    <p className="text-muted-foreground mt-2">第三方数据服务和发布应用由平台管理员配置。发布账号授权请前往发布页。</p>
  </div>;
  return <><ServiceConfigEditor key={user.id} scope="integrations" /><PlatformAppSettings /></>;
}
