'use client';

import React from 'react';
import { FileText, FileJson, Terminal, Archive, Package, Lock } from 'lucide-react';
import type { PackageOptions } from '@/lib/package/types';

interface PackageExtraSectionProps {
  includeDocs: boolean;
  includeTemplates: boolean;
  includeSetup: boolean;
  includeFsBackup: boolean;
  includeDist: boolean;
  /** Se Ianus è selezionato, fs-backup diventa obbligatorio */
  ianusSelected: boolean;
  onChange: <K extends ExtraKey>(key: K, value: PackageOptions[K]) => void;
}

type ExtraKey = keyof Pick<
  PackageOptions,
  'includeDocs' | 'includeTemplates' | 'includeSetup' | 'includeFsBackup' | 'includeDist'
>;

interface ExtraEntry {
  key: ExtraKey;
  label: string;
  icon: React.ElementType;
  description: string;
}

const EXTRA_ENTRIES: ExtraEntry[] = [
  { key: 'includeDocs', label: 'Documentazione', icon: FileText, description: 'Guide installazione e ADR' },
  { key: 'includeTemplates', label: 'Template integrazione', icon: FileJson, description: 'Template per progetto ospitante' },
  { key: 'includeSetup', label: 'Script setup', icon: Terminal, description: 'Script di configurazione automatica' },
  { key: 'includeFsBackup', label: 'fs-backup', icon: Archive, description: 'Backup atomico filesystem' },
];

export default function PackageExtraSection({
  includeDocs, includeTemplates, includeSetup, includeFsBackup, includeDist, ianusSelected, onChange,
}: PackageExtraSectionProps) {
  // Se Ianus è selezionato, fs-backup è forzato a true
  const fsBackupChecked = ianusSelected ? true : includeFsBackup;
  const fsBackupDisabled = ianusSelected;

  const extraValues: Record<ExtraKey, boolean> = {
    includeDocs, includeTemplates, includeSetup,
    includeFsBackup: fsBackupChecked, includeDist,
  };

  const handleToggle = (key: ExtraKey) => {
    if (key === 'includeFsBackup' && ianusSelected) return; // bloccato
    onChange(key, !extraValues[key]);
  };

  return (
    <section className="bg-surface-raised border border-border-subtle rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">Extra</h2>
      <p className="text-xs text-text-muted -mt-2">Opzioni aggiuntive per il pacchetto</p>

      <div className="space-y-1" role="group" aria-label="Opzioni extra">
        {EXTRA_ENTRIES.map((entry) => {
          const checked = extraValues[entry.key];
          const isLocked = entry.key === 'includeFsBackup' && ianusSelected;
          const IconComponent = entry.icon;

          return (
            <label
              key={entry.key}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors duration-150 group
                ${isLocked ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}
                ${checked ? 'bg-roman-gold/5 border border-roman-gold/20' : 'bg-surface-overlay/30 border border-transparent hover:bg-surface-overlay/60'}
              `}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={isLocked}
                onChange={() => handleToggle(entry.key)}
                className="sr-only"
                aria-label={`${checked ? 'Rimuovi' : 'Aggiungi'} ${entry.label}`}
              />
              <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150 ${
                checked ? 'bg-roman-gold border-roman-gold' : 'bg-transparent border-border-default group-hover:border-roman-gold/50'
              } ${isLocked ? 'opacity-60' : ''}`} aria-hidden="true">
                {checked && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                    <path d="M2 5L4 7L8 3" stroke="#030712" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors duration-150 ${
                checked ? 'text-roman-gold bg-roman-gold/10' : 'text-text-muted bg-surface-overlay'
              }`} aria-hidden="true">
                {isLocked ? <Lock size={14} /> : <IconComponent size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <span className={`block text-sm font-medium leading-tight ${checked ? 'text-text-primary' : 'text-text-muted'}`}>
                  {entry.label}
                  {isLocked && <span className="ml-1.5 text-[10px] text-roman-gold/70 font-normal">(richiesto da Ianus)</span>}
                </span>
                <span className="block text-[11px] text-text-disabled leading-tight mt-0.5">{entry.description}</span>
              </div>
            </label>
          );
        })}
      </div>

      {/* dist/ pre-buildati */}
      <div className="pt-2 border-t border-border-subtle">
        <label className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-150 group ${
          includeDist ? 'bg-roman-gold/5 border border-roman-gold/20' : 'bg-surface-overlay/30 border border-transparent hover:bg-surface-overlay/60'
        }`}>
          <input type="checkbox" checked={includeDist} onChange={() => handleToggle('includeDist')} className="sr-only"
            aria-label={`${includeDist ? 'Rimuovi' : 'Aggiungi'} dist/ pre-buildati`} />
          <span className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-all duration-150 ${
            includeDist ? 'bg-roman-gold border-roman-gold' : 'bg-transparent border-border-default group-hover:border-roman-gold/50'
          }`} aria-hidden="true">
            {includeDist && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M2 5L4 7L8 3" stroke="#030712" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors duration-150 ${
            includeDist ? 'text-roman-gold bg-roman-gold/10' : 'text-text-muted bg-surface-overlay'
          }`} aria-hidden="true"><Package size={16} /></span>
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className={`block text-sm font-medium leading-tight ${includeDist ? 'text-text-primary' : 'text-text-muted'}`}>
              Includi dist/ pre-buildati
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-roman-gold/15 text-roman-gold border border-roman-gold/20">+19 MB</span>
          </div>
          <span className="text-[11px] text-text-disabled">~19 MB extra</span>
        </label>
      </div>
    </section>
  );
}
