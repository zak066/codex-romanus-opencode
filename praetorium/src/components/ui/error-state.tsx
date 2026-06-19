'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Card } from './card';
import { Button } from './button';

interface ErrorStateProps {
  message: string;
  title?: string;
  onRetry?: () => void;
}

function ErrorState({ message, title = 'Errore nel caricamento', onRetry }: ErrorStateProps) {
  return (
    <Card
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center justify-center py-12 px-6 text-center"
    >
      <AlertCircle className="w-12 h-12 mb-4 text-semantic-error" aria-hidden="true" />
      <h3 className="text-base font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-sm text-text-muted mb-6 max-w-md">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Riprova
        </Button>
      )}
    </Card>
  );
}

ErrorState.displayName = 'ErrorState';

export { ErrorState };
export type { ErrorStateProps };
