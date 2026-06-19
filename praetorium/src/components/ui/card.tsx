'use client';

import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

interface CardBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

function CardRoot({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`bg-surface-raised border border-border-subtle rounded-lg ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

function CardHeader({ title, subtitle, action, className = '' }: CardHeaderProps) {
  return (
    <div
      className={`px-6 py-4 border-b border-border-subtle flex items-center justify-between gap-4 ${className}`}
    >
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-text-primary truncate">
          {title}
        </h3>
        {subtitle && (
          <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function CardBody({ children, className = '', ...props }: CardBodyProps) {
  return (
    <div className={`px-6 py-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

function CardFooter({ children, className = '', ...props }: CardFooterProps) {
  return (
    <div className={`px-6 py-4 border-t border-border-subtle ${className}`} {...props}>
      {children}
    </div>
  );
}

CardRoot.displayName = 'Card';

const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});

export { Card, CardHeader, CardBody, CardFooter };
export type { CardProps, CardHeaderProps, CardBodyProps, CardFooterProps };
