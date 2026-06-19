'use client';

import { useState } from 'react';
import { Package } from 'lucide-react';
import PackageServerSection from '@/components/package/PackageServerSection';
import PackagePresetSection from '@/components/package/PackagePresetSection';
import PackageExtraSection from '@/components/package/PackageExtraSection';
import PackageTeamSection from '@/components/package/PackageTeamSection';

import SizeEstimate from '@/components/package/SizeEstimate';
import ProfileSelector from '@/components/package/ProfileSelector';
import HistoryTable from '@/components/package/HistoryTable';
import CLIBox from '@/components/package/CLIBox';
import { DEFAULT_OPTIONS, type PackageOptions } from '@/lib/package/types';
import { Button } from '@/components/ui/button';

const PROFILE_OPTIONS: Record<string, Partial<PackageOptions>> = {
  minimal: {
    servers: { ...DEFAULT_OPTIONS.servers, speculum: false, praetorium: false, imago: false, nuntius: false },
    includeDocs: false, includeTemplates: false, includeDist: false, includeFsBackup: false,
  },
  standard: { ...DEFAULT_OPTIONS },
  full: {
    servers: { tabularium: true, ianus: true, speculum: true, praetorium: true, imago: true, nuntius: true },
    presets: { large: true, medium: true, small: true },
    includeDocs: true, includeTemplates: true, includeSetup: true, includeDist: true, includeFsBackup: true,
  },
};

export default function PackagePage() {
  const [options, setOptions] = useState<PackageOptions>(DEFAULT_OPTIONS);
  const [generating, setGenerating] = useState(false);
  const [activeProfile, setActiveProfile] = useState('standard');

  const updateServers = (servers: PackageOptions['servers']) => {
    const updated = { ...servers };
    const ianusOn = updated.ianus;
    setOptions((prev) => ({
      ...prev,
      servers: updated,
      includeFsBackup: ianusOn ? true : prev.includeFsBackup,
    }));
    setActiveProfile('');
  };
  const updateTeam = (key: 'includeAgents' | 'includeSkills', value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
    setActiveProfile('');
  };

  const updatePresets = (presets: PackageOptions['presets']) => {
    setOptions((prev) => ({ ...prev, presets }));
    setActiveProfile('');
  };

  const updateExtra = (key: string, value: unknown) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
    setActiveProfile('');
  };

  const handleProfile = (profileId: string) => {
    const profile = PROFILE_OPTIONS[profileId];
    if (profile) {
      setOptions((prev) => ({ ...prev, ...profile }));
      setActiveProfile(profileId);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/package/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = `codex-romanum-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Generate failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Package className="w-6 h-6 text-roman-gold" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Packaging</h1>
          <p className="text-text-muted mt-1">
            Crea archivi compressi personalizzati di Codex Romanus
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Colonna sinistra */}
        <div className="space-y-6">
          <PackageServerSection servers={options.servers} onChange={updateServers} />
          <PackagePresetSection presets={options.presets} onChange={updatePresets} />
          <PackageTeamSection
            includeAgents={options.includeAgents}
            includeSkills={options.includeSkills}
            onChange={updateTeam}
          />
          <PackageExtraSection
            includeDocs={options.includeDocs}
            includeTemplates={options.includeTemplates}
            includeSetup={options.includeSetup}
            includeDist={options.includeDist}
            includeFsBackup={options.includeFsBackup}
            ianusSelected={options.servers.ianus}
            onChange={updateExtra}
          />
        </div>

        {/* Colonna destra */}
        <div className="space-y-6">
          <SizeEstimate options={options} />

          <Button
            onClick={handleGenerate}
            disabled={generating}
            loading={generating}
            size="lg"
            className="w-full"
            icon={<Package size={16} />}
            aria-label="Genera archivio"
          >
            {generating ? 'Generazione in corso...' : 'Genera Archivio'}
          </Button>

          <CLIBox options={options} />
          <ProfileSelector activeProfile={activeProfile} onSelect={handleProfile} onSave={() => {}} />
          <HistoryTable />
        </div>
      </div>
    </div>
  );
}
