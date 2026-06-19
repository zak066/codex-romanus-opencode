'use client';

import React from 'react';
import { Users } from 'lucide-react';
import type { PackageOptions } from '@/lib/package/types';

// ─── Types ──────────────────────────────────────────────────────
interface PackagePresetSectionProps {
  presets: PackageOptions['presets'];
  onChange: (presets: PackageOptions['presets']) => void;
}

// ─── Preset definitions ─────────────────────────────────────────
interface PresetEntry {
  key: keyof PackageOptions['presets'];
  label: string;
  agentCount: number;
  description: string;
}

const PRESET_ENTRIES: PresetEntry[] = [
  {
    key: 'large',
    label: 'Large',
    agentCount: 12,
    description: 'Tutti gli agenti del Codex Romanus',
  },
  {
    key: 'medium',
    label: 'Medium',
    agentCount: 9,
    description: 'Agenti principali senza ruoli minori',
  },
  {
    key: 'small',
    label: 'Small',
    agentCount: 6,
    description: 'Solo agenti core del team',
  },
];

// ─── Component ──────────────────────────────────────────────────
export default function PackagePresetSection({
  presets,
  onChange,
}: PackagePresetSectionProps) {
  const handleToggle = (key: keyof PackageOptions['presets']) => {
    onChange({ ...presets, [key]: !presets[key] });
  };

  return (
    <section className="bg-surface-raised border border-border-subtle rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
        Preset Agenti
      </h2>
      <p className="text-xs text-text-muted -mt-2">
        Seleziona la configurazione degli agenti inclusi
      </p>

      <div className="space-y-1" role="group" aria-label="Selezione preset agenti">
        {PRESET_ENTRIES.map((entry) => {
          const checked = presets[entry.key];

          return (
            <label
              key={entry.key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer
                transition-colors duration-150 group
                ${
                  checked
                    ? 'bg-roman-gold/5 border border-roman-gold/20'
                    : 'bg-surface-overlay/30 border border-transparent hover:bg-surface-overlay/60'
                }`}
            >
              {/* Checkbox nascosto */}
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggle(entry.key)}
                className="sr-only"
                aria-label={`${checked ? 'Rimuovi' : 'Seleziona'} preset ${entry.label}`}
              />

              {/* Checkbox custom */}
              <span
                className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center
                  transition-all duration-150
                  ${
                    checked
                      ? 'bg-roman-gold border-roman-gold'
                      : 'bg-transparent border-border-default group-hover:border-roman-gold/50'
                  }`}
                aria-hidden="true"
              >
                {checked && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 5L4 7L8 3"
                      stroke="#030712"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              {/* Icona */}
              <span
                className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm
                  transition-colors duration-150
                  ${checked ? 'text-roman-gold bg-roman-gold/10' : 'text-text-muted bg-surface-overlay'}`}
                aria-hidden="true"
              >
                <Users size={16} />
              </span>

              {/* Nome + conteggio */}
              <div className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-medium leading-tight
                    ${checked ? 'text-text-primary' : 'text-text-muted'}`}
                >
                  {entry.label}
                </span>
                <span className="block text-[11px] text-text-disabled leading-tight mt-0.5">
                  {entry.description}
                </span>
              </div>

              {/* Agenti count badge */}
              <span
                className={`flex-shrink-0 text-[11px] font-mono px-2 py-0.5 rounded
                  ${
                    checked
                      ? 'bg-roman-gold/10 text-roman-gold'
                      : 'bg-surface-overlay text-text-disabled'
                  }`}
                aria-label={`${entry.agentCount} agenti`}
              >
                {entry.agentCount} agenti
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
