import { useAuth } from '@/contexts/AuthContext';
import ServiceConfigEditor from '@/components/ServiceConfigEditor';
import PlatformAppSettings from '@/components/PlatformAppSettings';
import PageHeader from '@/components/common/PageHeader';

export default function IntegrationSettingsPage() {
  const { user } = useAuth();
  if (user?.app_metadata?.role !== 'admin') return <div className="p-4 md:p-6">
    <PageHeader title="第三方集成" description="第三方数据服务和发布应用由平台管理员配置。发布账号授权请前往发布页。" />
  </div>;
  return <><ServiceConfigEditor key={user.id} scope="integrations" /><PlatformAppSettings /></>;
}
