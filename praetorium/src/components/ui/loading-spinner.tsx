'use client';

import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  className?: string;
}

const sizeStyles: Record<NonNullable<LoadingSpinnerProps['size']>, string> = {
  sm: 'h-5 w-5 border-2',
  md: 'h-8 w-8 border-[3px]',
  lg: 'h-12 w-12 border-4',
};

function LoadingSpinner({
  size = 'md',
  color,
  className = '',
}: LoadingSpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full border-current border-t-transparent ${sizeStyles[size]} ${className}`}
      style={
        color ? { borderColor: color, borderTopColor: 'transparent' } : undefined
      }
      role="status"
      aria-label="Caricamento in corso"
    >
      <span className="sr-only">Caricamento in corso</span>
    </div>
  );
}

export { LoadingSpinner };
export type { LoadingSpinnerProps };
