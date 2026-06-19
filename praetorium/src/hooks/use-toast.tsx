'use client';

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useRef,
  useId,
} from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'warning' | 'info';
  duration: number;
  createdAt: number;
}

export interface ToastOptions {
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_VISIBLE_TOASTS = 5;
const DEFAULT_DURATION = 5000;

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const idGen = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const toast = useCallback(
    (opts: ToastOptions): string => {
      const id = `toast-${++idGen.current}-${Date.now()}`;
      const duration = opts.duration ?? DEFAULT_DURATION;

      const entry: Toast = {
        id,
        message: opts.message,
        variant: opts.variant ?? 'info',
        duration,
        createdAt: Date.now(),
      };

      setToasts((prev) => {
        const next = [...prev, entry];
        // Mantieni solo gli ultimi MAX_VISIBLE_TOASTS
        return next.length > MAX_VISIBLE_TOASTS
          ? next.slice(next.length - MAX_VISIBLE_TOASTS)
          : next;
      });

      // Auto-dismiss
      if (duration > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss, dismissAll }}>
      {children}
    </ToastContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
