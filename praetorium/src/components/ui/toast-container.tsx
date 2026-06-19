'use client';

import React from 'react';
import { Toast } from './toast';
import { useToast } from '@/hooks/use-toast';

// ─── Component ───────────────────────────────────────────────────────────────

interface ToastContainerProps {
  className?: string;
}

function ToastContainer({ className = '' }: ToastContainerProps) {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-[100]
        flex flex-col-reverse gap-2
        pointer-events-none
        ${className}
      `}
      aria-label="Notifiche"
      role="region"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}

ToastContainer.displayName = 'ToastContainer';

export { ToastContainer };
export type { ToastContainerProps };
