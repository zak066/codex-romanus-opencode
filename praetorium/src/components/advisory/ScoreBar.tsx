// ──────────────────────────────────────────────────────────────
// Praetorium — ScoreBar: barra progresso punteggio percentuale
// Componente puro (nessuno stato, nessun evento)
// Usa tema tokens Praetorium: bg-surface-overlay, text-text-primary, etc.
// ──────────────────────────────────────────────────────────────

'use client';

interface ScoreBarProps {
  score: number;
}

export default function ScoreBar({ score }: ScoreBarProps) {
  const percent = Math.round(score * 100);

  // Colore in base al valore
  const barColor =
    score >= 0.8
      ? 'bg-semantic-success'
      : score >= 0.5
        ? 'bg-roman-gold'
        : 'bg-text-muted';

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-surface-overlay rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Punteggio: ${percent}%`}
        />
      </div>
      <span className="text-xs font-mono text-text-primary w-10 text-right tabular-nums">
        {percent}%
      </span>
    </div>
  );
}
