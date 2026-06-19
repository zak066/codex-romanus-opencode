'use client';

import React, { useEffect, useRef, useCallback, useId } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

function Modal({ isOpen, onClose, title, children, className = '' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Salva l'elemento focalizzato prima dell'apertura
  useEffect(() => {
    if (!isOpen) return;
    previousActiveElement.current = document.activeElement as HTMLElement;
  }, [isOpen]);

  // Trappola focus semplice: focus sul panel all'apertura
  useEffect(() => {
    if (!isOpen) return;

    const timer = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(timer);
    };
  }, [isOpen]);

  // Ripristina focus alla chiusura
  useEffect(() => {
    if (isOpen) return;

    const timer = requestAnimationFrame(() => {
      previousActiveElement.current?.focus();
    });

    return () => {
      cancelAnimationFrame(timer);
    };
  }, [isOpen]);

  // Keyboard: Escape per chiudere
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }

      // Trappola focus: Tab e Shift+Tab ciclano tra elementi focusabili
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const currentIndex = Array.from(focusable).indexOf(document.activeElement as HTMLElement);

        if (e.shiftKey) {
          // Previous element with wrap
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusable.length - 1;
          e.preventDefault();
          focusable[prevIndex].focus();
        } else {
          // Next element with wrap
          const nextIndex = currentIndex < focusable.length - 1 ? currentIndex + 1 : 0;
          e.preventDefault();
          focusable[nextIndex].focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Blocca scroll del body
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`w-full max-w-lg bg-surface-raised border border-border-subtle rounded-lg shadow-2xl focus:outline-none ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
            <h2 id={titleId} className="text-lg font-semibold text-text-primary">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-roman-gold rounded p-1"
              aria-label="Chiudi"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

export { Modal };
export type { ModalProps };
