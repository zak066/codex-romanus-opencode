'use client';

import { usePathname } from 'next/navigation';
import { usePraetorium } from '@/lib/praetorium-context';
import { NAV_ITEMS } from '@/lib/constants';
import { Circle, Menu } from 'lucide-react';

function getPageTitle(pathname: string): string {
  for (const item of NAV_ITEMS.monitoring) {
    if (pathname === item.href || pathname.startsWith(item.href + '/')) return item.label;
  }
  for (const item of NAV_ITEMS.configuration) {
    if (pathname === item.href || pathname.startsWith(item.href + '/')) return item.label;
  }
  if (pathname === '/') return 'Dashboard';
  const segment = pathname.split('/').filter(Boolean).pop() || '';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function getRomanDate(): string {
  const now = new Date();
  const months = ['IAN','FEB','MAR','APR','MAI','IVN','IVL','AVG','SEP','OCT','NOV','DEC'];
  const roman = ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV',
    'XVI','XVII','XVIII','XIX','XX','XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII','XXVIII','XXIX','XXX','XXXI'];
  return `${roman[now.getDate()]} ${months[now.getMonth()]}`;
}

function AgentStatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    idle: 'text-semantic-success', busy: 'text-roman-gold',
    error: 'text-semantic-error', offline: 'text-text-dim',
  };
  return <Circle className={`w-2.5 h-2.5 fill-current ${colorMap[status] ?? 'text-text-dim'}`} aria-hidden="true" />;
}

export function Header({
  onToggleSidebar, onPeekStart, onPeekEnd,
}: {
  onToggleSidebar: () => void;
  onPeekStart?: () => void;
  onPeekEnd?: () => void;
}) {
  const pathname = usePathname();
  const { agents, agentsLoading } = usePraetorium();
  const title = getPageTitle(pathname);
  const visibleAgents = agents.slice(0, 5);
  const remaining = agents.length - visibleAgents.length;

  return (
    <header className="relative h-14 shrink-0 flex items-center justify-between px-4 sm:px-6 z-10 bg-transparent backdrop-blur-sm border-b border-border-subtle">
      <button
        onClick={onToggleSidebar}
        onMouseEnter={onPeekStart}
        className="p-1.5 mr-2 text-text-muted hover:text-text-primary rounded-lg focus:outline-none focus:ring-2 focus:ring-roman-gold/50"
        aria-label="Toggle navigation menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-text-muted hidden sm:inline">Praetorium</span>
        <span className="text-sm text-text-dim hidden sm:inline" aria-hidden="true">›</span>
        <h1 className="text-lg font-semibold text-text-primary truncate">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {agentsLoading ? (
          <span className="text-xs text-text-muted">Loading&hellip;</span>
        ) : agents.length === 0 ? (
          <span className="text-xs text-text-muted">No agents</span>
        ) : (
          <div className="flex items-center gap-2" role="list" aria-label="Agent statuses">
            {visibleAgents.map((agent) => (
              <div key={agent.agent_name}
                className="flex items-center gap-1.5 bg-surface-panel border border-border-default rounded-full px-3 py-1 text-xs text-text-secondary"
                title={`${agent.agent_name}: ${agent.status}`} role="listitem">
                <AgentStatusDot status={agent.status} />
                <span className="hidden sm:inline">{agent.agent_name}</span>
              </div>
            ))}
            {remaining > 0 && <span className="text-xs text-text-muted">+{remaining}</span>}
          </div>
        )}
        <div className="hidden sm:flex items-center gap-1.5 bg-surface-panel border border-border-default rounded-full px-3 py-1 text-xs text-roman-gold font-medium tracking-wider" aria-label="Data romana">
          {getRomanDate()}
        </div>
      </div>
      <div className="absolute bottom-0 left-[5%] right-[5%] h-px bg-gradient-to-r from-transparent via-roman-gold-dark to-transparent opacity-40 pointer-events-none" aria-hidden="true" />
    </header>
  );
}
