'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, type = 'text', placeholder, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const errorId = error && inputId ? `${inputId}-error` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-text-secondary mb-1.5"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`w-full px-3 py-2 rounded-lg bg-surface-overlay border text-text-primary placeholder-text-muted transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus ${
            error
              ? 'border-semantic-error focus:ring-semantic-error/50 focus:border-semantic-error'
              : 'border-border-default hover:border-border-focus/50'
          } ${className}`}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1.5 text-sm text-semantic-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

export { Input };
export type { InputProps };
