import React, { ReactNode, useRef } from 'react';
import { useCredits } from '@/hooks/useCredits';
import { useAuth } from '@/contexts/AuthContext';
import { ForbiddenPage } from './ForbiddenPage';

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
  const { planName, loading } = useCredits();
  const { user } = useAuth();
  const resolved = useRef<{ userId: string; planName: string } | null>(null);
  if (resolved.current?.userId !== user?.id) resolved.current = null;
  if (!loading && user) resolved.current = { userId: user.id, planName };
  const currentPlan = loading ? resolved.current?.planName || '' : planName;

  if (loading && !resolved.current) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const isProOrAbove =
    currentPlan.includes('专业') ||
    currentPlan.includes('企业') ||
    currentPlan.includes('旗舰') ||
    currentPlan.toLowerCase().includes('pro');

  const isEnterprise =
    currentPlan.includes('企业') ||
    currentPlan.includes('旗舰') ||
    currentPlan.toLowerCase().includes('enterprise');

  let hasAccess = true;
  let requiredLabel = '专业版';

  if (requiredPlan === 'pro') {
    hasAccess = isProOrAbove;
    requiredLabel = '专业版';
  } else if (requiredPlan === 'enterprise') {
    hasAccess = isEnterprise;
    requiredLabel = '企业版';
  }

  if (!hasAccess) {
    return fallback ?? <ForbiddenPage requiredPlan={requiredLabel} featureName={featureName} />;
  }

  return <>{children}</>;
}

export default PlanGate;
