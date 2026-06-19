import { render, screen } from '@testing-library/react';
import SettingsPage from '../settings/page';
import { ToastProvider } from '@/hooks/use-toast';
import { ThemeProvider } from '@/lib/theme-provider';
import { vi, describe, it, expect } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/settings' }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>
    <ToastProvider>{children}</ToastProvider>
  </ThemeProvider>
);

describe('Settings Page', () => {
  it('renderizza titolo Settings', () => {
    render(<SettingsPage />, { wrapper });
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('ha sezione General', () => {
    render(<SettingsPage />, { wrapper });
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('ha sezione Server', () => {
    render(<SettingsPage />, { wrapper });
    expect(screen.getByText('Server')).toBeInTheDocument();
  });

  it('ha campo Nome Progetto', () => {
    render(<SettingsPage />, { wrapper });
    expect(screen.getByDisplayValue('Codex Romanus')).toBeInTheDocument();
  });
});
