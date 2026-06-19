'use client';

import { useState } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';
import type { PackageOptions } from '@/lib/package/types';

function generateCliCommand(options: PackageOptions): string {
  const servers = Object.entries(options.servers)
    .filter(([, v]) => v)
    .map(([k]) => k.charAt(0).toUpperCase())
    .join(',');

  const preset = options.presets.large ? 'Large' : options.presets.medium ? 'Medium' : 'Small';
  const parts = [`-Servers ${servers}`, `-Preset ${preset}`];
  if (options.includeDocs) parts.push('-IncludeDocs');
  if (options.includeDist) parts.push('-IncludeDist');

  return `pack-codex-romanum.ps1 ${parts.join(' ')}`;
}

export default function CLIBox({ options }: { options: PackageOptions }) {
  const [copied, setCopied] = useState(false);
  const command = generateCliCommand(options);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg p-3 flex items-center gap-2">
      <Terminal size={14} className="text-text-muted flex-shrink-0" />
      <code className="flex-1 text-xs text-text-muted font-mono truncate">{command}</code>
      <button
        onClick={handleCopy}
        className="flex-shrink-0 p-1.5 rounded-md text-text-muted hover:text-roman-gold hover:bg-surface-overlay transition-colors"
        aria-label={copied ? 'Copiato' : 'Copia comando'}
      >
        {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
