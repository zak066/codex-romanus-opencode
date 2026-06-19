import type { Meta, StoryObj } from '@storybook/react';
import { ErrorState } from './error-state';

const meta: Meta<typeof ErrorState> = {
  title: 'UI/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
  argTypes: {
    message: {
      control: 'text',
      description: 'Messaggio di errore mostrato all\'utente',
    },
    title: {
      control: 'text',
      description: 'Titolo del messaggio di errore',
    },
    onRetry: {
      action: 'retry clicked',
      description: 'Callback per il pulsante Riprova',
    },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {
  args: {
    message: 'Si è verificato un errore durante il caricamento dei dati.',
  },
};

export const CustomTitle: Story = {
  args: {
    message: 'Il server non risponde. Riprova più tardi.',
    title: 'Connessione persa',
  },
};

export const WithRetry: Story = {
  args: {
    message: 'Impossibile caricare i dati. Controlla la connessione.',
    title: 'Errore di rete',
    onRetry: () => {},
  },
};

export const LongMessage: Story = {
  args: {
    message:
      'Si è verificato un errore imprevisto durante l\'elaborazione della richiesta. Se il problema persiste, contatta il supporto tecnico fornendo il codice di riferimento: ERR-2024-001.',
    title: 'Errore del sistema',
    onRetry: () => {},
  },
};

export const WithRetryAndCustomTitle: Story = {
  args: {
    message: 'Autenticazione fallita. Verifica le credenziali e riprova.',
    title: 'Accesso negato',
    onRetry: () => {},
  },
};
