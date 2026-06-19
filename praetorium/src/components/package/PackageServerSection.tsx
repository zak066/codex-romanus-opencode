'use client';

import React from 'react';
import {
  Database,
  DoorOpen,
  Search,
  Crown,
  Image,
  Share2,
} from 'lucide-react';
import type { PackageOptions } from '@/lib/package/types';

interface PackageServerSectionProps {
  servers: PackageOptions['servers'];
  onChange: (servers: PackageOptions['servers']) => void;
}

interface ServerEntry {
  key: keyof PackageOptions['servers'];
  label: string;
  icon: React.ElementType;
  description: string;
  defaultOn: boolean;
}

const SERVER_ENTRIES: ServerEntry[] = [
  { key: 'tabularium', label: 'Tabularium', icon: Database, description: 'Governance centralizzata e memoria team', defaultOn: true },
  { key: 'ianus', label: 'Ianus', icon: DoorOpen, description: 'Filesystem con backup atomico', defaultOn: true },
  { key: 'speculum', label: 'Speculum', icon: Search, description: 'Ricerca web integrata', defaultOn: true },
  { key: 'praetorium', label: 'Praetorium', icon: Crown, description: 'Dashboard di comando unificata', defaultOn: true },
  { key: 'imago', label: 'Imago', icon: Image, description: 'Generazione immagini AI', defaultOn: false },
  { key: 'nuntius', label: 'Nuntius', icon: Share2, description: 'Notifiche e comunicazioni', defaultOn: false },
];

export default function PackageServerSection({ servers, onChange }: PackageServerSectionProps) {
  const handleToggle = (key: keyof PackageOptions['servers']) => {
    onChange({ ...servers, [key]: !servers[key] });
  };

  return (
    <section className="bg-surface-raised border border-border-subtle rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Server</h2>
      <p className="text-xs text-text-muted -mt-2">Seleziona i server da includere nel pacchetto</p>

      <div className="space-y-1" role="group" aria-label="Selezione server">
        {SERVER_ENTRIES.map((entry) => {
          const IconComponent = entry.icon;
          const checked = servers[entry.key];

          return (
            <label
              key={entry.key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150 group ${
                checked ? 'bg-roman-gold/5 border border-roman-gold/20' : 'bg-surface-overlay/30 border border-transparent hover:bg-surface-overlay/60'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggle(entry.key)}
                className="sr-only"
                aria-label={`${checked ? 'Rimuovi' : 'Aggiungi'} ${entry.label}`}
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
                <IconComponent size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <span className={`block text-sm font-medium leading-tight ${checked ? 'text-text-primary' : 'text-text-muted'}`}>
                  {entry.label}
                </span>
                <span className="block text-[11px] text-text-disabled leading-tight mt-0.5">{entry.description}</span>
              </div>
              {entry.defaultOn && <span className="text-[10px] text-roman-gold/60 font-mono flex-shrink-0">default</span>}
            </label>
          );
        })}
      </div>
    </section>
  );
}
