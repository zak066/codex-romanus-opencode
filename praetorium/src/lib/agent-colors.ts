// ============================================================
// Praetorium — Agent Colors, Emojis & Icons (Single Source of Truth)
// ============================================================
// Unifica tutte le definizioni sparse in:
//   - arae/lib/agent-colors.ts
//   - praetorium/src/components/advisory/AdvisoryCards.tsx
//   - praetorium/src/app/(config)/models/page.tsx
// ============================================================

import {
  Crown,
  Brain,
  Hammer,
  Shield,
  Key,
  Server,
  Gauge,
  Palette,
  Search,
  Rocket,
  Target,
  ScrollText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ─── Agenti ──────────────────────────────────────────────────

export const AGENT_IDS = [
  'iuppiter-orchestrator',
  'minerva-architect',
  'vulcanus-senior-dev',
  'catone-quality',
  'janus-security',
  'agrippa-devops',
  'scipione-perf',
  'ovidio-frontend',
  'plinioilvecchio-seo',
  'mercurius-junior-dev',
  'diana-tester',
  'tacito-docs',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

// ─── Short name → Full name mapping ──────────────────────────
// Utile quando il codice usa split('-')[0] per ottenere una chiave corta.

export const SHORT_TO_FULL: Record<string, string> = {
  iuppiter: 'iuppiter-orchestrator',
  minerva: 'minerva-architect',
  vulcanus: 'vulcanus-senior-dev',
  catone: 'catone-quality',
  janus: 'janus-security',
  agrippa: 'agrippa-devops',
  scipione: 'scipione-perf',
  ovidio: 'ovidio-frontend',
  plinioilvecchio: 'plinioilvecchio-seo',
  mercurius: 'mercurius-junior-dev',
  diana: 'diana-tester',
  tacito: 'tacito-docs',
};

// ─── Colori esadecimali (Tailwind-friendly) ──────────────────
// Valori da AdvisoryCards.tsx (più vicini ai colori Tailwind).
// Usati per bordi laterali, badge e indicatori.

export const AGENT_COLORS: Record<string, string> = {
  'iuppiter-orchestrator': '#f59e0b',
  'minerva-architect': '#60a5fa',
  'vulcanus-senior-dev': '#f87171',
  'catone-quality': '#34d399',
  'janus-security': '#a78bfa',
  'agrippa-devops': '#38bdf8',
  'scipione-perf': '#f472b6',
  'ovidio-frontend': '#fb923c',
  'plinioilvecchio-seo': '#fbbf24',
  'mercurius-junior-dev': '#4ade80',
  'diana-tester': '#c084fc',
  'tacito-docs': '#94a3b8',
};

// ─── Classi Tailwind per accent card ─────────────────────────
// Usate da models/page.tsx per le card degli agenti (bg + border).
// Key = short name (split('-')[0] del nome agente).

export const AGENT_COLORS_CLASSES: Record<string, string> = {
  iuppiter: 'bg-amber-500/10 border-amber-500/30',
  minerva: 'bg-blue-500/10 border-blue-500/30',
  vulcanus: 'bg-red-500/10 border-red-500/30',
  catone: 'bg-emerald-500/10 border-emerald-500/30',
  janus: 'bg-purple-500/10 border-purple-500/30',
  agrippa: 'bg-cyan-500/10 border-cyan-500/30',
  scipione: 'bg-orange-500/10 border-orange-500/30',
  ovidio: 'bg-pink-500/10 border-pink-500/30',
  plinioilvecchio: 'bg-teal-500/10 border-teal-500/30',
  mercurius: 'bg-yellow-500/10 border-yellow-500/30',
  diana: 'bg-green-500/10 border-green-500/30',
  tacito: 'bg-indigo-500/10 border-indigo-500/30',
};

// ─── Emoji rappresentative ───────────────────────────────────
// Da arae/lib/agent-colors.ts.

export const AGENT_EMOJIS: Record<string, string> = {
  'iuppiter-orchestrator': '⚡',
  'minerva-architect': '🦉',
  'vulcanus-senior-dev': '🔥',
  'catone-quality': '📜',
  'janus-security': '🚪',
  'agrippa-devops': '🏗️',
  'scipione-perf': '⚔️',
  'ovidio-frontend': '🎨',
  'plinioilvecchio-seo': '📚',
  'mercurius-junior-dev': '⚡',
  'diana-tester': '🏹',
  'tacito-docs': '📖',
};

// ─── Icone Lucide-React ──────────────────────────────────────
// Da AdvisoryCards.tsx.

export const AGENT_ICONS: Record<string, LucideIcon> = {
  'iuppiter-orchestrator': Crown,
  'minerva-architect': Brain,
  'vulcanus-senior-dev': Hammer,
  'catone-quality': Shield,
  'janus-security': Key,
  'agrippa-devops': Server,
  'scipione-perf': Gauge,
  'ovidio-frontend': Palette,
  'plinioilvecchio-seo': Search,
  'mercurius-junior-dev': Rocket,
  'diana-tester': Target,
  'tacito-docs': ScrollText,
};

// ─── Helpers ─────────────────────────────────────────────────

/** Restituisce la classe Tailwind per l'accent della card di un agente.
 *  agentName può essere il nome completo (e.g. "iuppiter-orchestrator")
 *  o il nome breve (e.g. "iuppiter"). */
export function getAgentAccentClass(agentName: string): string {
  const shortKey = agentName.split('-')[0];
  return AGENT_COLORS_CLASSES[shortKey] || 'border-border-default';
}

/** Restituisce il colore esadecimale per un agente.
 *  agentName può essere nome completo o breve. */
export function getAgentColor(agentName: string): string {
  return AGENT_COLORS[agentName] ?? AGENT_COLORS[SHORT_TO_FULL[agentName] ?? ''] ?? '#6b7280';
}

/** Restituisce l'emoji per un agente.
 *  agentName può essere nome completo o breve. */
export function getAgentEmoji(agentName: string): string {
  return AGENT_EMOJIS[agentName] ?? AGENT_EMOJIS[SHORT_TO_FULL[agentName] ?? ''] ?? '❓';
}

/** Restituisce l'icona Lucide per un agente.
 *  agentName può essere nome completo o breve. */
export function getAgentIcon(
  agentName: string,
): LucideIcon {
  return (
    AGENT_ICONS[agentName] ??
    AGENT_ICONS[SHORT_TO_FULL[agentName] ?? ''] ??
    Crown
  );
}
