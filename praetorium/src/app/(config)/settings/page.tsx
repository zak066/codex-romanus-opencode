'use client';

import { useLocalStorage } from '@/hooks/use-local-storage';
import { useToast } from '@/hooks/use-toast';
import { Settings as SettingsIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useTheme } from '@/lib/theme-provider';
import { themes, type Theme } from '@/lib/themes';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const { toast } = useToast();
  const [projectName, setProjectName] = useLocalStorage('settings-projectName', 'Codex Romanus');
  const [language, setLanguage] = useLocalStorage('settings-language', 'it');
  const [tabulariumUrl, setTabulariumUrl] = useLocalStorage('settings-tabulariumUrl', 'http://localhost:3100');
  const [pollingInterval, setPollingInterval] = useLocalStorage('settings-pollingInterval', '10000');
  const { theme: savedTheme, setTheme, saving } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<Theme>(savedTheme);

  // Sync local selection when saved theme changes from outside
  useEffect(() => {
    setSelectedTheme(savedTheme);
  }, [savedTheme]);

  const languageOptions = [
    { value: 'it', label: 'Italiano' },
    { value: 'en', label: 'English' },
  ];

  const pollingOptions = [
    { value: '5000', label: '5 secondi' },
    { value: '10000', label: '10 secondi' },
    { value: '30000', label: '30 secondi' },
    { value: '60000', label: '60 secondi' },
  ];

  const handleSave = () => {
    toast({ message: 'Impostazioni salvate', variant: 'success' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="w-6 h-6 text-roman-gold" />
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="text-text-muted mt-1">
            Configura le impostazioni globali del progetto.
          </p>
        </div>
      </div>

      {/* General Section */}
      <Card className="p-4 sm:p-6">
        <Card.Header title="General" subtitle="Informazioni di base del progetto." />
        <Card.Body className="space-y-4">
          <Input
            label="Project name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Inserisci il nome del progetto"
          />
          <Select
            label="Lingua"
            options={languageOptions}
            value={language}
            onChange={setLanguage}
          />
        </Card.Body>
      </Card>

      {/* Server Section */}
      <Card className="p-4 sm:p-6">
        <Card.Header title="Server" subtitle="Configurazione del server Tabularium." />
        <Card.Body className="space-y-4">
          <Input
            label="Tabularium URL"
            value={tabulariumUrl}
            onChange={(e) => setTabulariumUrl(e.target.value)}
            placeholder="http://localhost:3100"
          />
          <Select
            label="Polling interval"
            options={pollingOptions}
            value={pollingInterval}
            onChange={setPollingInterval}
          />
        </Card.Body>
      </Card>

      {/* Appearance Section */}
      <Card className="p-4 sm:p-6">
        <Card.Header title="Appearance" subtitle="Scegli il tema dell'interfaccia." />
        <Card.Body>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(Object.keys(themes) as Theme[]).map((themeId) => {
              const t = themes[themeId];
              const isSelected = selectedTheme === themeId;
              return (
                <button
                  key={themeId}
                  onClick={() => setSelectedTheme(themeId)}
                  className={`relative flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                    isSelected
                      ? 'border-roman-gold bg-roman-gold/5'
                      : 'border-border-subtle hover:border-border-default hover:bg-surface-overlay'
                  }`}
                >
                  <span className="text-2xl">{t.icon}</span>
                  <div className="text-center">
                    <p className="font-semibold text-text-primary">{t.name}</p>
                    <p className="text-xs text-text-muted mt-1">{t.description}</p>
                  </div>
                  {/* Color swatches */}
                  <div className="flex gap-1.5">
                    {[t.colors.background, t.colors.surface, t.colors.primary, t.colors.text].map((c, i) => (
                      <span
                        key={i}
                        className="w-4 h-4 rounded-full border border-border-default"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  {isSelected && (
                    <span className="absolute top-2 right-2 text-roman-gold text-sm">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card.Body>
        <Card.Footer className="flex justify-end">
          <Button
            onClick={async () => {
              await setTheme(selectedTheme);
              toast({ message: 'Tema aggiornato con successo', variant: 'success' });
            }}
            disabled={selectedTheme === savedTheme || saving}
          >
            {saving ? 'Salvataggio...' : 'Salva tema'}
          </Button>
        </Card.Footer>
      </Card>

      {/* General Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave}>Salva impostazioni</Button>
      </div>
    </div>
  );
}
