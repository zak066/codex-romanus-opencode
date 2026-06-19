export const NAV_ITEMS = {
  monitoring: [
    { label: 'Agents', href: '/agents', icon: 'Cpu' },
    { label: 'Channels', href: '/channels', icon: 'MessageSquare' },
    { label: 'Decisions', href: '/decisions', icon: 'FileText' },
    { label: 'Graph', href: '/graph', icon: 'Network' },
    { label: 'Quality', href: '/quality', icon: 'Shield' },
    { label: 'Metrics', href: '/metrics', icon: 'BarChart3' },
  ],
  configuration: [
    { label: 'Models', href: '/models', icon: 'Brain' },
    { label: 'Advisory', href: '/advisory', icon: 'AlertTriangle' },
    { label: 'Package', href: '/package', icon: 'Package' },
    { label: 'History', href: '/history', icon: 'Clock' },
    { label: 'Settings', href: '/settings', icon: 'Settings' },
  ],
} as const;

export const PRAETORIUM_NAME = 'Praetorium';
export const PRAETORIUM_DESCRIPTION = 'Piattaforma di comando unificata per il Codex Romanus';
