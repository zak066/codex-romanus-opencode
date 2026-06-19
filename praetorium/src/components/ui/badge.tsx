'use client';

import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-surface-overlay text-text-secondary border-border-default',
  success: 'bg-semantic-success-bg text-semantic-success border-semantic-success/30',
  error: 'bg-semantic-error-bg text-semantic-error border-semantic-error/30',
  warning: 'bg-semantic-warning-bg text-semantic-warning border-semantic-warning/30',
  info: 'bg-semantic-info-bg text-semantic-info border-semantic-info/30',
};

const sizeStyles: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
};

function Badge({
  variant = 'default',
  size = 'md',
  icon,
  children,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-full border ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
    >
      {icon && (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeProps };
