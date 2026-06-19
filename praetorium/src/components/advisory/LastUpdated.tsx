'use client';

import { RefreshCw } from 'lucide-react';

interface LastUpdatedProps {
  generatedAt?: string;
  onRefresh: () => void;
  loading: boolean;
}

export default function LastUpdated({ generatedAt, onRefresh, loading }: LastUpdatedProps) {
  if (!generatedAt) return null;

  const formatted = new Date(generatedAt).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3">
      <p className="text-xs text-text-muted">
        Ultimo aggiornamento: {formatted}
      </p>
      <button
        onClick={onRefresh}
        disabled={loading}
        className={`transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-roman-gold/50 rounded ${
          loading
            ? 'text-roman-gold cursor-not-allowed'
            : 'text-text-muted hover:text-roman-gold'
        }`}
        aria-label="Aggiorna consulenza"
        aria-live="polite"
      >
        <RefreshCw
          size={14}
          className={loading ? 'animate-spin' : ''}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
