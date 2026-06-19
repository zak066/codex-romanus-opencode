import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toast, type ToastVariant } from '../toast';

const baseToast: ToastVariant = { id: '1', message: 'Test message', variant: 'success', duration: 5000, createdAt: Date.now() };

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('renderizza messaggio', () => {
    render(<Toast toast={baseToast} onDismiss={vi.fn()} />);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('ha ruolo alert', () => {
    render(<Toast toast={baseToast} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('ha bottone di chiusura', () => {
    render(<Toast toast={baseToast} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText('Chiudi notifica')).toBeInTheDocument();
  });

  it('chiama onDismiss al click su X (con delay 200ms)', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast toast={baseToast} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Chiudi notifica'));
    vi.advanceTimersByTime(250);
    expect(onDismiss).toHaveBeenCalledWith('1');
  });

  it('renderizza variante error', () => {
    render(<Toast toast={{ ...baseToast, variant: 'error' }} onDismiss={vi.fn()} />);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('renderizza variante warning', () => {
    render(<Toast toast={{ ...baseToast, variant: 'warning' }} onDismiss={vi.fn()} />);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('renderizza variante info', () => {
    render(<Toast toast={{ ...baseToast, variant: 'info' }} onDismiss={vi.fn()} />);
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });
});
