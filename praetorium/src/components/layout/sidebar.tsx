'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Cpu,
  MessageSquare,
  FileText,
  Network,
  Shield,
  BarChart3,
  Brain,
  AlertTriangle,
  Package,
  Clock,
  Settings,
  ChevronDown,
  ChevronRight,
  Landmark,
  X,
} from 'lucide-react';
import { NAV_ITEMS, PRAETORIUM_NAME } from '@/lib/constants';
import { useState, useEffect, useCallback } from 'react';

const iconMap: Record<string, React.ElementType> = {
  Cpu, MessageSquare, FileText, Network, Shield, BarChart3,
  Brain, AlertTriangle, Package, Clock, Settings,
};

function NavSection({
  title, items, defaultOpen = true, onNavClick,
}: {
  title: string;
  items: readonly { label: string; href: string; icon: string }[];
  defaultOpen?: boolean;
  onNavClick?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors"
        aria-label={title}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <span>{title}</span>
        </span>
      </button>
      {open && (
        <nav className="mt-1 space-y-0.5" aria-label={title}>
          {items.map((item) => {
            const Icon = iconMap[item.icon];
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href} onClick={onNavClick}
                className={`relative flex items-center gap-3 px-3 py-2 text-sm transition-all duration-300 ease-out border-l-2 ${
                  isActive
                    ? 'border-roman-gold bg-roman-gold/10 text-roman-gold font-medium'
                    : 'border-transparent text-text-secondary hover:bg-roman-gold-glow hover:text-text-primary'
                }`}
                title={item.label}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

interface SidebarProps {
  visible: boolean;
  isOpen: boolean;
  onClose: () => void;
  onPeekEnd: () => void;
}

export function Sidebar({ visible, isOpen, onClose, onPeekEnd }: SidebarProps) {
  const pathname = usePathname();

  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleNavClick = useCallback(() => {
    if (window.innerWidth < 768) onClose();
  }, [onClose]);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} aria-hidden="true" />
      )}
      <aside
        onMouseLeave={visible && !isOpen ? onPeekEnd : undefined}
        className={`flex flex-col h-screen bg-surface-base border-r border-border-subtle overflow-hidden
          ${visible ? 'flex' : 'hidden'} md:${visible ? 'flex' : 'hidden'} w-[260px] transition-all duration-300 ease-out
          fixed md:relative z-40 w-[260px]
          ${visible ? 'translate-x-0' : 'translate-x-[-100%]'} md:translate-x-0
          transition-transform duration-300 ease-out`}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="w-[260px] flex flex-col h-full">
          <div className="relative h-14 shrink-0 border-b border-border-subtle flex items-center">
            <div className="absolute top-0 left-[5%] right-[5%] h-px bg-gradient-to-r from-transparent via-roman-gold/40 to-transparent pointer-events-none" aria-hidden="true" />
            <Link href="/" className="flex items-center gap-2 px-4 w-full" aria-label={PRAETORIUM_NAME}>
              <Landmark className="w-6 h-6 text-roman-gold shrink-0" aria-hidden="true" />
              <span className="font-roman text-lg font-bold text-roman-gold tracking-wide">{PRAETORIUM_NAME}</span>
            </Link>
            <button onClick={onClose}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-primary rounded-lg md:hidden focus:outline-none focus:ring-2 focus:ring-roman-gold/50"
              aria-label="Chiudi menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 px-2 py-4 overflow-y-auto">
            <NavSection title="Monitoring" items={NAV_ITEMS.monitoring} onNavClick={handleNavClick} />
            <NavSection title="Configuration" items={NAV_ITEMS.configuration} onNavClick={handleNavClick} />
          </div>
        </div>
      </aside>
    </>
  );
}
