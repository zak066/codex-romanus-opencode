import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ChannelsPage from '../channels/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/channels' }));

describe('Channels Page', () => {
  it('renderizza sidebar con canali', async () => {
    render(<ChannelsPage />);
    await waitFor(() => {
      expect(screen.getByText('general')).toBeInTheDocument();
    });
  });

  it('mostra tutti i canali dalla fetch', async () => {
    render(<ChannelsPage />);
    await waitFor(() => {
      expect(screen.getByText('general')).toBeInTheDocument();
      expect(screen.getByText('design')).toBeInTheDocument();
    });
  });
});
