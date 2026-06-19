// ──────────────────────────────────────────────────────────────
// Praetorium — MetricsBadges: badge per intelligenza, velocità, prezzo
// Usa Praetorium's Badge component da @/components/ui/badge
// ──────────────────────────────────────────────────────────────

'use client';

import { Brain, Zap, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface MetricsBadgesProps {
  intelligence: number;
  speed: number;
  price: number;
}

/**
 * Determina il colore del badge prezzo in base al costo:
 *  - < $1  → success (economico)
 *  - < $3  → warning (medio)
 *  - ≥ $3  → error (costoso)
 */
function priceVariant(price: number): 'success' | 'warning' | 'error' {
  if (price < 1) return 'success';
  if (price < 3) return 'warning';
  return 'error';
}

export default function MetricsBadges({
  intelligence,
  speed,
  price,
}: MetricsBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Metriche del modello">
      {/* Intelligenza */}
      <Badge variant="info" size="sm" icon={<Brain size={12} />}>
        {intelligence}
      </Badge>

      {/* Velocità */}
      <Badge variant="success" size="sm" icon={<Zap size={12} />}>
        {speed} t/s
      </Badge>

      {/* Prezzo */}
      <Badge variant={priceVariant(price)} size="sm" icon={<DollarSign size={12} />}>
        ${price.toFixed(2)}
      </Badge>
    </div>
  );
}
