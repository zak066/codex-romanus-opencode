'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
} from 'lucide-react';
import type { Toast as ToastType } from '@/hooks/use-toast';

// ─── Variant styles ──────────────────────────────────────────────────────────

const variantStyles: Record<ToastType['variant'], { container: string; icon: React.ReactNode }> = {
  success: {
    container:
      'bg-semantic-success-bg text-semantic-success border-semantic-success/30',
    icon: <CheckCircle className="h-5 w-5 shrink-0 text-semantic-success" aria-hidden="true" />,
  },
  error: {
    container:
      'bg-semantic-error-bg text-semantic-error border-semantic-error/30',
    icon: <AlertCircle className="h-5 w-5 shrink-0 text-semantic-error" aria-hidden="true" />,
  },
  warning: {
    container:
      'bg-semantic-warning-bg text-semantic-warning border-semantic-warning/30',
    icon: <AlertTriangle className="h-5 w-5 shrink-0 text-semantic-warning" aria-hidden="true" />,
  },
  info: {
    container:
      'bg-semantic-info-bg text-semantic-info border-semantic-info/30',
    icon: <Info className="h-5 w-5 shrink-0 text-semantic-info" aria-hidden="true" />,
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
  className?: string;
}

function Toast({
  toast: { id, message, variant },
  onDismiss,
  className = '',
}: ToastProps) {
  const [exiting, setExiting] = useState(false);
  const variantStyle = variantStyles[variant];

  // Animazione di uscita prima di rimuovere dal DOM
  const handleDismiss = useCallback(() => {
    setExiting(true);
    // Aspetta che l'animazione finisca prima di chiamare onDismiss
    setTimeout(() => {
      onDismiss(id);
    }, 200); // match exit animation duration
  }, [id, onDismiss]);

  // Keyboard: Escape per chiudere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    // Aggiungiamo l'event listener solo su questo elemento via ref
    // Usiamo un approccio globale ma controllato
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-start gap-3 w-full max-w-sm
        px-4 py-3 rounded-lg border shadow-lg
        transition-all duration-200 ease-in-out
        ${variantStyle.container}
        ${
          exiting
            ? 'opacity-0 translate-x-4 scale-95'
            : 'opacity-100 translate-x-0 scale-100'
        }
        ${className}
      `}
    >
      {/* Icon */}
      {variantStyle.icon}

      {/* Message */}
      <p className="flex-1 text-sm font-medium leading-5 pt-0.5">
        {message}
      </p>

      {/* Close button */}
      <button
        onClick={handleDismiss}
        className="shrink-0 p-0.5 rounded
          text-current opacity-60 hover:opacity-100
          focus:outline-none focus:ring-2 focus:ring-roman-gold focus:opacity-100
          transition-opacity"
        aria-label="Chiudi notifica"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

Toast.displayName = 'Toast';

export { Toast };
export type { ToastProps };
export type { ToastType as ToastVariant };
