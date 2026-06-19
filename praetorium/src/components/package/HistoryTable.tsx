'use client';

import { useState, useEffect } from 'react';
import { Clock, HardDrive } from 'lucide-react';
import type { PackageHistoryEntry } from '@/lib/package/types';

export default function HistoryTable() {
  const [history, setHistory] = useState<PackageHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/package/history', { signal: AbortSignal.timeout(8000) })
      .then((res) => res.json())
      .then((data) => {
        setHistory(data.history ?? []);
        setError(false);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // --- Loading state ---
  if (loading) {
    return (
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
          <Clock size={14} /> Cronologia
        </h3>
        <div className="animate-pulse space-y-3">
          <div className="h-3 bg-surface-overlay rounded w-1/3" />
          <div className="h-3 bg-surface-overlay rounded w-1/2" />
          <div className="h-3 bg-surface-overlay rounded w-2/5" />
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
          <Clock size={14} /> Cronologia
        </h3>
        <p className="text-xs text-red-400 text-center py-4">
          Unable to load history
        </p>
      </div>
    );
  }

  // --- Empty state ---
  if (history.length === 0) {
    return (
      <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
        <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
          <Clock size={14} /> Cronologia
        </h3>
        <p className="text-xs text-text-muted text-center py-4">
          Nessun archivio generato
        </p>
      </div>
    );
  }

  // --- Data table ---
  return (
    <div className="bg-surface-raised border border-border-subtle rounded-xl p-4">
      <h3 className="text-sm font-semibold text-text-secondary mb-3 flex items-center gap-2">
        <Clock size={14} /> Cronologia
      </h3>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead>
          <tr className="text-text-muted border-b border-border-subtle">
            <th className="text-left py-1.5 pr-1.5 sm:py-2 sm:pr-2 font-medium">Data</th>
            <th className="text-left py-1.5 px-1.5 sm:py-2 sm:px-2 font-medium">Server</th>
            <th className="text-right py-1.5 pl-1.5 sm:py-2 sm:pl-2 font-medium">Dimensione</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row, i) => (
            <tr
              key={`${row.generatedAt}-${i}`}
              className="border-b border-border-subtle/50 hover:bg-surface-overlay/50 transition-colors"
            >
              <td className="py-1.5 pr-1.5 sm:py-2 sm:pr-2 text-text-primary">{row.date}</td>
              <td className="py-1.5 px-1.5 sm:py-2 sm:px-2">
                <div className="flex gap-1">
                  {row.servers.map((s) => (
                    <span
                      key={s}
                      className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-overlay text-text-muted"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-1.5 pl-1.5 sm:py-2 sm:pl-2 text-right text-text-secondary">
                <span className="inline-flex items-center gap-1">
                  <HardDrive size={10} />
                  {row.size}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
