'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  MessageSquare, Hash, AlertCircle, MessageCircle, Search,
  Menu, X, ArrowLeft, User, Folder, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { ErrorState, EmptyState, PageHeader } from '@/components/ui';
import type { ChannelDTO, ChannelMessageDTO, ChannelsResponse, ChannelDetailResponse } from '@/lib/types';

function getChannelColor(name: string): string {
  switch (name) {
    case '#general': return 'text-semantic-info';
    case '#design': return 'text-roman-gold';
    case '#alerts': return 'text-semantic-error';
    case '#bugs': return 'text-semantic-warning';
    case '#quality': return 'text-semantic-success';
    case '#architecture': return 'text-pompeii-blue';
    default: return 'text-text-muted';
  }
}

function getChannelIcon(name: string, className = 'w-4 h-4') {
  if (name.startsWith('dm-')) return <User className={className} />;
  if (name.startsWith('#')) return <Hash className={className} />;
  return <Folder className={className} />;
}

type ChannelCategory = 'canali' | 'dirette' | 'altri';

function categorizeChannel(name: string): ChannelCategory {
  if (name.startsWith('dm-')) return 'dirette';
  if (name.startsWith('#')) return 'canali';
  return 'altri';
}

const categoryLabels: Record<ChannelCategory, string> = {
  canali: 'Canali', dirette: 'Dirette', altri: 'Altri',
};

const categoryIcons: Record<ChannelCategory, React.ReactNode> = {
  canali: <Hash className="w-3.5 h-3.5" />,
  dirette: <User className="w-3.5 h-3.5" />,
  altri: <Folder className="w-3.5 h-3.5" />,
};

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function getDisplayName(name: string): string {
  if (name.startsWith('dm-')) return name.slice(3);
  return name;
}

function ChannelSidebar({ channels, selectedChannel, onSelectChannel, onClose, isMobile }: {
  channels: ChannelDTO[]; selectedChannel: ChannelDTO | null;
  onSelectChannel: (channel: ChannelDTO) => void; onClose?: () => void; isMobile?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<ChannelCategory, boolean>>({
    canali: false, dirette: false, altri: false,
  });
  const filtered = useMemo(() => channels.filter((c) => getDisplayName(c.name).toLowerCase().includes(search.toLowerCase())), [channels, search]);
  const grouped = useMemo(() => {
    const map: Record<ChannelCategory, ChannelDTO[]> = { canali: [], dirette: [], altri: [] };
    for (const ch of filtered) map[categorizeChannel(ch.name)].push(ch);
    return map;
  }, [filtered]);
  const toggleSection = (cat: ChannelCategory) => setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  return (
    <aside className="flex flex-col h-full bg-surface-base border-r border-border-subtle" role="navigation" aria-label="Channel list">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <h2 className="text-sm font-semibold text-text-primary tracking-wide uppercase">Channels <span className="ml-1.5 text-text-muted font-normal normal-case">({channels.length})</span></h2>
        {isMobile && onClose && (
          <button onClick={onClose} className="p-1 rounded-md hover:bg-surface-overlay text-text-muted hover:text-text-primary transition-colors" aria-label="Close channel list"><X className="w-5 h-5" /></button>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" aria-hidden="true" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtra..." aria-label="Search channels"
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md bg-surface-overlay border border-border-default text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-border-focus/50 focus:border-border-focus transition-colors" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {(Object.keys(grouped) as ChannelCategory[]).map((cat) => {
          const items = grouped[cat];
          if (items.length === 0) return null;
          const isCollapsed = collapsed[cat];
          return (
            <div key={cat} className="pt-2">
              <button onClick={() => toggleSection(cat)}
                className="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors rounded-md"
                aria-expanded={!isCollapsed} aria-label={`${categoryLabels[cat]} section`}>
                <span className="shrink-0" aria-hidden="true">{isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
                <span className="shrink-0" aria-hidden="true">{categoryIcons[cat]}</span>
                <span>{categoryLabels[cat]}</span>
                <span className="ml-auto text-text-disabled font-normal normal-case">{items.length}</span>
              </button>
              {!isCollapsed && (
                <div className="mt-0.5 space-y-0.5" role="list">
                  {items.map((ch) => {
                    const isSelected = selectedChannel?.id === ch.id;
                    const hasUnread = (ch.message_count ?? 0) > 0;
                    return (
                      <button key={ch.id} onClick={() => onSelectChannel(ch)} role="listitem"
                        aria-current={isSelected ? 'true' : undefined}
                        className={`flex items-center gap-2.5 w-full px-2.5 py-2 text-sm rounded-md transition-colors text-left ${isSelected ? 'bg-surface-overlay text-text-primary border-l-2 border-roman-gold' : 'text-text-secondary hover:bg-surface-overlay/60 hover:text-text-primary border-l-2 border-transparent'}`}>
                        <span className={`shrink-0 ${getChannelColor(ch.name)}`} aria-hidden="true">{getChannelIcon(ch.name)}</span>
                        <span className="flex-1 truncate">{getDisplayName(ch.name)}</span>
                        {hasUnread && <Badge variant="default" size="sm">{ch.message_count}</Badge>}
                        {ch.last_message && <span className="text-xs text-text-disabled hidden lg:inline shrink-0">{formatTimestamp(ch.last_message.created_at)}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-text-muted">
            <Search className="w-8 h-8 mb-2 opacity-40" aria-hidden="true" />
            <p className="text-xs">Nessun canale trovato</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function MessageBubble({ message }: { message: ChannelMessageDTO }) {
  return (
    <div className="group px-4 py-2.5 hover:bg-surface-overlay/40 transition-colors rounded-lg">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-8 h-8 rounded-full bg-surface-overlay flex items-center justify-center text-xs font-bold text-roman-gold border border-border-subtle" aria-hidden="true">
          {message.sender.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-roman-gold">@{message.sender}</span>
            <span className="text-xs text-text-disabled">{formatTimestamp(message.created_at)}</span>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    </div>
  );
}

function MessagePane({ channel, messages, loading }: {
  channel: ChannelDTO | null; messages: ChannelMessageDTO[]; loading: boolean;
}) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Hooks BEFORE early return (Rules of Hooks)
  const sortedMessages = useMemo(() => [...messages].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [messages]);

  if (!channel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-surface-base min-h-[60vh]">
        <div className="flex flex-col items-center gap-3 text-text-muted px-6 py-12">
          <MessageCircle className="w-16 h-16 opacity-20" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-text-primary">Seleziona un canale</h3>
          <p className="text-sm text-text-muted text-center max-w-xs">Scegli un canale dalla sidebar per vedere i messaggi della conversazione.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-surface-base min-h-[60vh]">
      <div className="shrink-0 px-4 py-3 border-b border-border-subtle bg-surface-raised/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button onClick={() => window.history.back()} className="p-1 rounded-md hover:bg-surface-overlay text-text-muted transition-colors" aria-label="Back to channel list"><ArrowLeft className="w-5 h-5" /></button>
          )}
          <span className={`shrink-0 ${getChannelColor(channel.name)}`} aria-hidden="true">{getChannelIcon(channel.name, 'w-5 h-5')}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text-primary truncate">{getDisplayName(channel.name)}</h3>
            <p className="text-xs text-text-muted truncate">{channel.description}{channel.message_count !== undefined && <span className="ml-1.5 text-text-disabled">&middot; {channel.message_count} messaggi</span>}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {loading ? <div className="flex justify-center items-center py-16"><LoadingSpinner size="md" className="text-roman-gold" /></div>
          : sortedMessages.length === 0 ? <EmptyState message="Nessun messaggio" description="Questo canale non ha ancora messaggi. Inizia tu la conversazione!" />
          : sortedMessages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
      </div>
      <div className="shrink-0 px-4 py-3 border-t border-border-subtle bg-surface-raised/50">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-overlay border border-border-default text-text-muted opacity-50">
          <MessageCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="text-sm italic">Invio messaggi in arrivo...</span>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-text-muted">
      <LoadingSpinner size="lg" className="mb-4 text-roman-gold" />
      <p className="text-sm">Loading channels&hellip;</p>
    </div>
  );
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<ChannelDTO | null>(null);
  const [messages, setMessages] = useState<ChannelMessageDTO[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileView, setMobileView] = useState<'list' | 'messages'>('list');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    fetch('/api/channels')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() as Promise<ChannelsResponse>; })
      .then((data) => { if (!cancelled) setChannels(data.channels ?? []); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load channels'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSelectChannel = useCallback((channel: ChannelDTO) => {
    setSelectedChannel(channel); setMessagesLoading(true); setMessages([]); setMobileView('messages');
    fetch('/api/channels?name=' + encodeURIComponent(channel.name))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() as Promise<ChannelDetailResponse>; })
      .then((data) => { setMessages(data.messages ?? []); })
      .catch(() => { setMessages([]); })
      .finally(() => { setMessagesLoading(false); });
  }, []);

  const handleBackToList = useCallback(() => { setMobileView('list'); }, []);

  if (error) return <ErrorState message={error} />;
  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <PageHeader title="Channels" description="Canali di comunicazione tra agenti Codex Romanus."
        icon={<MessageSquare className="w-6 h-6 text-roman-gold" aria-hidden="true" />} />

      <div className="relative flex h-[calc(100vh-14rem)] min-h-[480px] rounded-lg border border-border-subtle overflow-hidden bg-surface-raised">
        <button onClick={() => setSidebarOpen((prev) => !prev)}
          className="absolute top-2 left-2 z-20 p-1.5 rounded-md bg-surface-floating border border-border-default text-text-muted hover:text-text-primary transition-colors"
          aria-label={sidebarOpen ? 'Nascondi sidebar' : 'Mostra sidebar'}>
          {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>

        <div className={'w-72 shrink-0 border-r border-border-subtle bg-surface-base transition-all duration-200 ' + (sidebarOpen ? 'block' : 'hidden') + ' max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-full max-md:' + (mobileView === 'messages' ? 'hidden' : 'block')}>
          <ChannelSidebar channels={channels} selectedChannel={selectedChannel} onSelectChannel={handleSelectChannel} isMobile={false} onClose={() => setSidebarOpen(false)} />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {mobileView === 'messages' && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle bg-surface-raised md:hidden">
              <button onClick={handleBackToList} className="flex items-center gap-1 text-sm text-text-muted hover:text-text-primary transition-colors" aria-label="Back to channel list">
                <ArrowLeft className="w-4 h-4" /><span>Canali</span>
              </button>
              {selectedChannel && <span className="text-sm font-medium text-text-primary truncate">{getDisplayName(selectedChannel.name)}</span>}
            </div>
          )}
          <MessagePane channel={selectedChannel} messages={messages} loading={messagesLoading} />
        </div>
      </div>
    </div>
  );
}