import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../../hooks/use-toast';

// ─── Wrapper ──────────────────────────────────────────────────
function wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restituisce toasts vuoto inizialmente', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(result.current.toasts).toEqual([]);
  });

  it('restituisce dismiss, dismissAll e toast come funzioni', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(typeof result.current.toast).toBe('function');
    expect(typeof result.current.dismiss).toBe('function');
    expect(typeof result.current.dismissAll).toBe('function');
  });

  it('addToast aggiunge un toast alla lista', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'Test message' });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Test message');
    expect(result.current.toasts[0].variant).toBe('info'); // default variant
  });

  it('addToast accetta variant e duration custom', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'Success!', variant: 'success', duration: 3000 });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].variant).toBe('success');
    expect(result.current.toasts[0].duration).toBe(3000);
  });

  it('dismiss rimuove un toast specifico per id', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    let id: string;
    act(() => {
      id = result.current.toast({ message: 'To dismiss' });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.dismiss(id!);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('dismiss non fallisce con id inesistente', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'Keep me' });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.dismiss('non-existent-id');
    });

    // Il toast esistente non viene rimosso
    expect(result.current.toasts).toHaveLength(1);
  });

  it('dismissAll rimuove tutti i toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'First' });
      result.current.toast({ message: 'Second' });
      result.current.toast({ message: 'Third' });
    });

    expect(result.current.toasts).toHaveLength(3);

    act(() => {
      result.current.dismissAll();
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('i toast hanno id univoci', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'A' });
      result.current.toast({ message: 'B' });
      result.current.toast({ message: 'C' });
    });

    const ids = result.current.toasts.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('i toast hanno id, message, variant, duration, createdAt', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'Full toast' });
    });

    const toast = result.current.toasts[0];
    expect(toast).toHaveProperty('id');
    expect(toast).toHaveProperty('message');
    expect(toast).toHaveProperty('variant');
    expect(toast).toHaveProperty('duration');
    expect(toast).toHaveProperty('createdAt');
    expect(typeof toast.id).toBe('string');
    expect(typeof toast.createdAt).toBe('number');
  });

  it('non supera MAX_VISIBLE_TOASTS (5)', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: '1' });
      result.current.toast({ message: '2' });
      result.current.toast({ message: '3' });
      result.current.toast({ message: '4' });
      result.current.toast({ message: '5' });
      result.current.toast({ message: '6' }); // sesto toast
    });

    // Dovrebbe mantenere solo gli ultimi 5
    expect(result.current.toasts).toHaveLength(5);
    // Il primo toast (message:'1') dovrebbe essere stato rimosso
    expect(result.current.toasts[0].message).toBe('2');
  });

  it('lancia errore se usato fuori dal provider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useToast())).toThrow(
      'useToast must be used within a ToastProvider',
    );
    consoleSpy.mockRestore();
  });

  it('auto-dismiss dopo duration scaduta (duration > 0)', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'Auto dismiss', duration: 1000 });
    });

    expect(result.current.toasts).toHaveLength(1);

    // Avanza il tempo oltre la durata
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('non auto-dismiss se duration = 0', () => {
    const { result } = renderHook(() => useToast(), { wrapper });

    act(() => {
      result.current.toast({ message: 'Persistent', duration: 0 });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(10000); // anche dopo tanto tempo
    });

    expect(result.current.toasts).toHaveLength(1);
  });
});
