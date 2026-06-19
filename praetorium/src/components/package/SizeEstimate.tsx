'use client';

import React from 'react';
import {
  Database,
  DoorOpen,
  Search,
  Crown,
  Image,
  Share2,
  FileText,
  FileJson,
  Terminal,
  Archive,
  Package,
} from 'lucide-react';
import type { PackageOptions } from '@/lib/package/types';
import { getSizeEstimate } from '@/lib/package/sizes';

// ─── Types ──────────────────────────────────────────────────────
interface SizeEstimateProps {
  options: PackageOptions;
}

// ─── Helpers ─────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

// ─── Server metadata ────────────────────────────────────────────
interface ServerMeta {
  key: string;
  label: string;
  icon: React.ElementType;
}

const SERVER_META: ServerMeta[] = [
  { key: 'tabularium', label: 'Tabularium', icon: Database },
  { key: 'ianus', label: 'Ianus', icon: DoorOpen },
  { key: 'speculum', label: 'Speculum', icon: Search },
  { key: 'praetorium', label: 'Praetorium', icon: Crown },
  { key: 'imago', label: 'Imago', icon: Image },
  { key: 'nuntius', label: 'Nuntius', icon: Share2 },
];

interface ExtraMeta {
  key: string;
  label: string;
  icon: React.ElementType;
  condition: boolean;
}

function getExtras(opt: PackageOptions): ExtraMeta[] {
  return [
    { key: 'includeDocs', label: 'Documentazione', icon: FileText, condition: opt.includeDocs },
    { key: 'includeTemplates', label: 'Template', icon: FileJson, condition: opt.includeTemplates },
    { key: 'includeSetup', label: 'Script setup', icon: Terminal, condition: opt.includeSetup },
    { key: 'includeFsBackup', label: 'fs-backup', icon: Archive, condition: opt.includeFsBackup },
    { key: 'includeDist', label: 'dist/ pre-buildati', icon: Package, condition: opt.includeDist },
  ];
}

// ─── Bar component ──────────────────────────────────────────────
function SizeBar({
  label,
  icon: Icon,
  sizeBytes,
  totalBytes,
  enabled,
}: {
  label: string;
  icon: React.ElementType;
  sizeBytes: number;
  totalBytes: number;
  enabled: boolean;
}) {
  const percent = totalBytes > 0 ? (sizeBytes / totalBytes) * 100 : 0;
  const formatted = formatSize(sizeBytes);

  return (
    <div className="flex items-center gap-3">
      {/* Icon */}
      <span
        className={`flex-shrink-0 w-6 h-6 rounded flex items-center justify-center
          ${enabled ? 'text-roman-gold' : 'text-text-disabled'}`}
        aria-hidden="true"
      >
        <Icon size={14} />
      </span>

      {/* Label */}
      <span
        className={`flex-shrink-0 w-24 text-xs font-medium truncate
          ${enabled ? 'text-text-secondary' : 'text-text-disabled'}`}
      >
        {label}
      </span>

      {/* Bar */}
      <div className="flex-1 h-2 bg-surface-overlay rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out
            ${enabled ? 'bg-roman-gold' : 'bg-transparent'}`}
          style={{ width: `${enabled ? Math.max(percent, 1) : 0}%` }}
          role="progressbar"
          aria-valuenow={enabled ? Math.round(percent) : 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${formatted}`}
        />
      </div>

      {/* Size */}
      <span
        className={`flex-shrink-0 w-16 text-right text-xs font-mono tabular-nums
          ${enabled ? 'text-text-secondary' : 'text-text-disabled'}`}
      >
        {formatted}
      </span>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────
export default function SizeEstimate({ options }: SizeEstimateProps) {
  const estimate = getSizeEstimate(options);
  const { servers: serverSizes, total } = estimate;

  return (
    <section
      className="bg-surface-raised border border-border-subtle rounded-lg p-5 space-y-4"
      aria-label="Stima dimensioni pacchetto"
    >
      <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
        Stima Dimensioni
      </h2>

      {/* Server bars */}
      <div className="space-y-2">
        <span className="text-xs text-text-muted font-medium">Server</span>
        {SERVER_META.map((meta) => (
          <SizeBar
            key={meta.key}
            label={meta.label}
            icon={meta.icon}
            sizeBytes={serverSizes[meta.key] ?? 0}
            totalBytes={total}
            enabled={options.servers[meta.key as keyof PackageOptions['servers']]}
          />
        ))}
      </div>

      {/* Extra bars */}
      <div className="space-y-2 pt-2 border-t border-border-subtle">
        <span className="text-xs text-text-muted font-medium">Extra</span>
        {getExtras(options).map((extra) => (
          <SizeBar
            key={extra.key}
            label={extra.label}
            icon={extra.icon}
            sizeBytes={
              extra.key === 'includeDocs' ? 2_500_000
              : extra.key === 'includeTemplates' ? 50_000
              : extra.key === 'includeSetup' ? 100_000
              : extra.key === 'includeFsBackup' ? 500_000
              : extra.key === 'includeDist' ? 19_000_000
              : 0
            }
            totalBytes={total}
            enabled={extra.condition}
          />
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
        <span className="text-sm font-semibold text-text-primary">
          Totale
        </span>
        <span className="text-lg font-bold text-roman-gold font-mono tabular-nums">
          {formatSize(total)}
        </span>
      </div>
    </section>
  );
}

export { formatSize };
