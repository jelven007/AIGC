import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** 菜单入口共用标题、说明和操作区；业务事件由页面传入。 */
export default function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header data-page-header className={cn('page-header', className)}>
      <div className="page-header-copy">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div data-page-actions className="page-actions">{actions}</div>}
    </header>
  );
}
