'use client';

import React from 'react';
import { Users, BookOpen } from 'lucide-react';

interface PackageTeamSectionProps {
  includeAgents: boolean;
  includeSkills: boolean;
  onChange: (key: 'includeAgents' | 'includeSkills', value: boolean) => void;
}

export default function PackageTeamSection({ includeAgents, includeSkills, onChange }: PackageTeamSectionProps) {
  const items = [
    { key: 'includeAgents' as const, label: 'Agenti (.opencode/agents/)', icon: Users, description: 'Definizioni dei 12 agenti AI' },
    { key: 'includeSkills' as const, label: 'Skill (.opencode/skills/)', icon: BookOpen, description: 'Skill specializzate per ogni agente' },
  ];

  return (
    <section className="bg-surface-raised border border-border-subtle rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Team</h2>
      <p className="text-xs text-text-muted -mt-2">Definizioni agenti e skill da includere</p>

      <div className="space-y-1" role="group" aria-label="Opzioni team">
        {items.map(({ key, label, icon: Icon, description }) => {
          const checked = key === 'includeAgents' ? includeAgents : includeSkills;
          return (
            <label
              key={key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150 group ${
                checked ? 'bg-roman-gold/5 border border-roman-gold/20' : 'bg-surface-overlay/30 border border-transparent hover:bg-surface-overlay/60'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(key, !checked)}
                className="sr-only"
                aria-label={`${checked ? 'Rimuovi' : 'Aggiungi'} ${label}`}
              />
              <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150 ${
                checked ? 'bg-roman-gold border-roman-gold' : 'bg-transparent border-border-default group-hover:border-roman-gold/50'
              }`} aria-hidden="true">
                {checked && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 5L4 7L8 3" stroke="#030712" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors duration-150 ${
                checked ? 'text-roman-gold bg-roman-gold/10' : 'text-text-muted bg-surface-overlay'
              }`} aria-hidden="true">
                <Icon size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <span className={`block text-sm font-medium leading-tight ${checked ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
                <span className="block text-[11px] text-text-disabled leading-tight mt-0.5">{description}</span>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}
