'use client';
import type { AdvisoryMode } from '@/lib/advisory/types';

interface ModeToggleProps {
  mode: AdvisoryMode;
  onChange: (m: AdvisoryMode) => void;
}

export default function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      className="inline-flex rounded-lg bg-surface-overlay p-0.5"
      role="radiogroup"
      aria-label="Modalità di raccomandazione"
    >
      <button
        onClick={() => onChange('high')}
        role="radio"
        aria-checked={mode === 'high'}
        className={`px-4 py-2 text-sm font-medium transition-all duration-200 rounded-md ${
          mode === 'high'
            ? 'bg-roman-gold text-text-inverse font-semibold shadow-sm'
            : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        ⚡ High Performance
      </button>
      <button
        onClick={() => onChange('budget')}
        role="radio"
        aria-checked={mode === 'budget'}
        className={`px-4 py-2 text-sm font-medium transition-all duration-200 rounded-md ${
          mode === 'budget'
            ? 'bg-roman-gold text-text-inverse font-semibold shadow-sm'
            : 'text-text-muted hover:text-text-secondary'
        }`}
      >
        💰 Low Budget
      </button>
    </div>
  );
}
