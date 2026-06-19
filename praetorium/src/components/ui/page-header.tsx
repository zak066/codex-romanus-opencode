'use client';

import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

function PageHeaderRoot({ title, description, icon, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
          {description && (
            <p className="text-text-muted mt-1">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

PageHeaderRoot.displayName = 'PageHeader';

export { PageHeaderRoot as PageHeader };
export type { PageHeaderProps };
