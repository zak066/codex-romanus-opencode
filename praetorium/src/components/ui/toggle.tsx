'use client';

import React, { useId } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  className = '',
}: ToggleProps) {
  const id = useId();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!disabled) {
        onChange(!checked);
      }
    }
  };

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label || 'Toggle'}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-roman-gold/50 focus:ring-offset-2 focus:ring-offset-surface-base ${
          checked
            ? 'bg-roman-gold'
            : 'bg-surface-floating'
        } ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-[1.375rem]' : 'translate-x-[0.25rem]'
          }`}
        />
      </button>
      {label && (
        <label
          htmlFor={id}
          className={`text-sm font-medium cursor-pointer select-none ${
            disabled ? 'text-text-disabled' : 'text-text-primary'
          }`}
        >
          {label}
        </label>
      )}
    </div>
  );
}

export { Toggle };
export type { ToggleProps };
