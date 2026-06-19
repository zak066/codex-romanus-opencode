// ──────────────────────────────────────────────────────────────
// Praetorium — AdvisoryCards: griglia card agenti con raccomandazioni
// ──────────────────────────────────────────────────────────────
//
// Adattato da Arae: AGENT_COLORS e AGENT_ICONS importati da @/lib/agent-colors.
// Usa tema tokens Praetorium.
// ──────────────────────────────────────────────────────────────

'use client';

import type { AgentRecommendation, AdvisoryMode, ModelScore } from '@/lib/advisory/types';
import { Trophy, Medal, Brain, Sparkles, Crown } from 'lucide-react';
import { AGENT_COLORS, AGENT_ICONS } from '@/lib/agent-colors';
import ScoreBar from './ScoreBar';
import MetricsBadges from './MetricsBadges';

// ─── Props ────────────────────────────────────────────────────

interface AdvisoryCardsProps {
  recommendations: AgentRecommendation[];
  mode: AdvisoryMode;
}

// ─── Stelle ●○ ────────────────────────────────────────────────

function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="text-xs tracking-wide" aria-label={`${value} su ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={i < value ? 'text-roman-gold' : 'text-text-muted'}
          aria-hidden="true"
        >
          {i < value ? '●' : '○'}
        </span>
      ))}
    </span>
  );
}

// ─── Rank icon config ─────────────────────────────────────────

const RANK_ICONS = [Trophy, Medal, Sparkles];
const RANK_COLORS = ['text-roman-gold', 'text-text-muted', 'text-amber-700'];
const RANK_LABELS = ['Miglior modello', 'Secondo posto', 'Terzo posto'];

// ─── Singola raccomandazione modello ──────────────────────────

function ModelRecommendation({
  modelScore,
  rank,
}: {
  modelScore: ModelScore;
  rank: 1 | 2 | 3;
}) {
  const { model, score } = modelScore;
  const RankIcon = RANK_ICONS[rank - 1];
  const rankColor = RANK_COLORS[rank - 1];
  const isGoProvider = model.provider === 'go';

  return (
    <div className="bg-surface-overlay rounded-lg p-3 border border-border-subtle space-y-2">
      {/* Riga superiore: rank + nome + badge provider */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {/* Rank icon */}
          <RankIcon
            size={18}
            className={`shrink-0 ${rankColor}`}
            aria-label={RANK_LABELS[rank - 1]}
          />

          {/* Nome modello + creator */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-text-primary truncate">
                {model.name}
              </span>
              {/* Badge provider */}
              <span
                className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0
                  ${isGoProvider
                    ? 'bg-blue-900/50 text-blue-300 border-blue-800'
                    : 'bg-purple-900/50 text-purple-300 border-purple-800'
                  }`}
              >
                {isGoProvider ? 'Go' : 'Zen'}
              </span>
              {/* Badge Reasoning */}
              {model.hasReasoning && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded
                             text-[10px] font-medium bg-amber-900/30 text-amber-400
                             border border-amber-800/50 shrink-0"
                >
                  <Brain size={10} aria-hidden="true" />
                  Reasoning
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted truncate mt-0.5">
              {model.creator}
            </p>
          </div>
        </div>
      </div>

      {/* Score bar */}
      <ScoreBar score={score} />

      {/* Metriche */}
      <MetricsBadges
        intelligence={model.intelligence}
        speed={model.speed}
        price={model.price}
      />
    </div>
  );
}

// ─── Card singolo agente ──────────────────────────────────────

function AgentCard({
  recommendation,
  mode,
}: {
  recommendation: AgentRecommendation;
  mode: AdvisoryMode;
}) {
  const { agentId, agentName, recommendations } = recommendation;

  const Icon = AGENT_ICONS[agentId] || Crown;
  const borderColor = AGENT_COLORS[agentId] || '#6b7280';

  // Stelle e reasoning dal primo recommendation (se esiste)
  // Nota: non abbiamo AGENT_PROFILES qui, usiamo segnaposto
  // In una versione futura si potrebbe passare il profilo via props
  const top = recommendations.slice(0, 3);

  return (
    <article
      className="bg-surface-raised rounded-xl border border-border-subtle p-5
                 transition-all duration-200 hover:border-border-default"
      style={{ borderLeft: `4px solid ${borderColor}` }}
      aria-label={`Raccomandazioni per ${agentName}`}
    >
      {/* Intestazione: icona + nome */}
      <div className="flex items-center gap-3 min-w-0 mb-3">
        <span className="shrink-0 w-10 h-10 rounded-lg bg-surface-overlay flex items-center justify-center">
          <Icon size={20} className="text-text-secondary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-primary truncate">
            {agentName}
          </h3>
          <p className="text-sm text-text-muted truncate">{agentId}</p>
        </div>
      </div>

      {/* Separatore */}
      <hr className="border-border-subtle my-3" />

      {/* Lista raccomandazioni (top 3) */}
      {top.length > 0 ? (
        <div className="space-y-2">
          {top.map((rec, i) => (
            <ModelRecommendation
              key={`${agentId}-${rec.model.opencodeId}-${i}`}
              modelScore={rec}
              rank={(i + 1) as 1 | 2 | 3}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted italic">
          Nessuna raccomandazione disponibile
        </p>
      )}
    </article>
  );
}

// ─── Griglia principale ───────────────────────────────────────

export default function AdvisoryCards({
  recommendations,
}: AdvisoryCardsProps) {
  return (
    <section
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      aria-label="Raccomandazioni per agente"
    >
      {recommendations.map((rec) => (
        <AgentCard
          key={rec.agentId}
          recommendation={rec}
          mode={rec.mode}
        />
      ))}
    </section>
  );
}
