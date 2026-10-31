import type { ReactNode } from 'react';
import { useCredits } from '@/hooks/useCredits';
import { ForbiddenPage } from './ForbiddenPage';
import { Button } from './ui/button';

interface PlanGateProps {
  children: ReactNode;
  requiredPlan?: 'pro' | 'enterprise';
  featureName?: string;
  fallback?: ReactNode;
}

export function PlanGate({
  children,
  requiredPlan = 'pro',
  featureName,
  fallback,
}: PlanGateProps) {
  const { planLevel, loading, error, refresh, refreshing } = useCredits();
  if (error) return <div role="alert" className="mx-auto max-w-md space-y-3 py-12 text-center">
    <p className="text-sm text-muted-foreground">套餐权益暂时无法核验，请重试。</p>
    <Button variant="outline" disabled={refreshing} onClick={() => void refresh()}>重试权益核验</Button>
  </div>;
  if (loading) {
    return (
      <div role="status" aria-label="正在核验套餐权益" className="flex min-h-[40vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const hasAccess = planLevel >= (requiredPlan === 'enterprise' ? 3 : 1);
  const requiredLabel = requiredPlan === 'enterprise' ? '企业版' : '专业版';

  if (!hasAccess) {
    return fallback ?? <ForbiddenPage requiredPlan={requiredLabel} featureName={featureName} />;
  }

  return <>{children}</>;
}

export default PlanGate;
