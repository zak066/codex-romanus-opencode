import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './empty-state';
import { Search, Filter, AlertTriangle } from 'lucide-react';

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  argTypes: {
    message: {
      control: 'text',
      description: 'Messaggio principale dello stato vuoto',
    },
    description: {
      control: 'text',
      description: 'Descrizione opzionale più dettagliata',
    },
    action: {
      control: 'object',
      description: 'Configurazione del pulsante azione { label, onClick }',
    },
    icon: {
      control: false,
      description: 'Componente icona personalizzata (default: Inbox)',
    },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    message: 'Nessun dato disponibile',
  },
};

export const WithDescription: Story = {
  args: {
    message: 'Nessun utente trovato',
    description: 'Non ci sono utenti che corrispondono ai criteri di ricerca. Prova a modificare i filtri.',
  },
};

export const WithAction: Story = {
  args: {
    message: 'Nessun progetto ancora creato',
    description: 'Inizia creando il tuo primo progetto per vedere i dati qui.',
    action: {
      label: 'Crea progetto',
      onClick: () => {},
    },
  },
};

export const WithCustomIcon: Story = {
  args: {
    message: 'Nessun risultato dalla ricerca',
    description: 'Prova a utilizzare termini di ricerca diversi.',
    icon: Search,
    action: {
      label: 'Nuova ricerca',
      onClick: () => {},
    },
  },
};

export const FilterIcon: Story = {
  args: {
    message: 'Nessun filtro applicato',
    description: 'Applica dei filtri per restringere i risultati.',
    icon: Filter,
    action: {
      label: 'Applica filtri',
      onClick: () => {},
    },
  },
};

export const WarningState: Story = {
  args: {
    message: 'Nessun avviso attivo',
    description: 'Tutti i sistemi funzionano correttamente. Non ci sono avvisi da mostrare.',
    icon: AlertTriangle,
  },
};

export const WithActionOnly: Story = {
  args: {
    message: 'Carrello vuoto',
    action: {
      label: 'Torna allo shop',
      onClick: () => {},
    },
  },
};

export const AllFeatures: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <EmptyState
        message="Nessun dato"
        description="Descrizione generica per lo stato vuoto."
      />
      <EmptyState
        message="Nessun risultato"
        action={{ label: 'Azione', onClick: () => {} }}
      />
    </div>
  ),
};
