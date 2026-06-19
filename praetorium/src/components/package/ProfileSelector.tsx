'use client';

import { Bookmark, Star, Award, Plus } from 'lucide-react';

const PROFILES = [
  { id: 'minimal', label: 'Minimal', icon: Bookmark, desc: 'Solo Tabularium + Ianus' },
  { id: 'standard', label: 'Standard', icon: Star, desc: 'T+I+S+A + dist + docs' },
  { id: 'full', label: 'Full', icon: Award, desc: 'Tutti i server + extra' },
];

interface ProfileSelectorProps {
  activeProfile: string;
  onSelect: (profileId: string) => void;
  onSave: () => void;
}

export default function ProfileSelector({ activeProfile, onSelect, onSave }: ProfileSelectorProps) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
      <h3 className="text-sm font-semibold text-text-secondary mb-3">Profili rapidi</h3>
      <div className="grid grid-cols-4 gap-2">
        {PROFILES.map(({ id, label, icon: Icon, desc }) => (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg text-xs font-medium transition-all duration-200
              ${activeProfile === id
                ? 'bg-roman-gold/10 text-roman-gold border border-roman-gold/20'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-overlay border border-transparent'
              }`}
            title={desc}
            aria-label={`${label}: ${desc}`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
        <button
          onClick={onSave}
          className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg text-xs font-medium
                     text-text-muted hover:text-roman-gold hover:border-roman-gold/20
                     border border-dashed border-border-default transition-all duration-200"
          aria-label="Salva profilo corrente"
        >
          <Plus size={16} />
          <span>Salva</span>
        </button>
      </div>
    </div>
  );
}
