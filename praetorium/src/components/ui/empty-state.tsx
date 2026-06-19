'use client';

import React from 'react';
import { Inbox } from 'lucide-react';
import { Card } from './card';
import { Button } from './button';

interface EmptyStateProps {
  message?: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: { label: string; onClick: () => void };
}

function EmptyState({
  message = 'Nessun dato disponibile',
  description,
  icon: Icon = Inbox,
  action,
}: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <Icon className="w-12 h-12 mb-4 text-text-disabled/60" aria-hidden="true" />
      <h3 className="text-base font-semibold text-text-primary mb-1">{message}</h3>
      {description && (
        <p className="text-sm text-text-muted mb-6 max-w-md">{description}</p>
      )}
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Card>
  );
}

EmptyState.displayName = 'EmptyState';

export { EmptyState };
export type { EmptyStateProps };
