import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage } from '../use-local-storage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restituisce il valore iniziale quando localStorage è vuoto', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('legge il valore salvato da localStorage al mount', () => {
    localStorage.setItem('test-key', JSON.stringify('stored-value'));
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('stored-value');
  });

  it('salva il valore in localStorage con setValue', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    act(() => {
      result.current[1]('new-value');
    });
    expect(result.current[0]).toBe('new-value');
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('new-value'));
  });

  it('legge oggetti complessi da localStorage', () => {
    const obj = { name: 'test', count: 42 };
    localStorage.setItem('obj-key', JSON.stringify(obj));
    const { result } = renderHook(() => useLocalStorage('obj-key', {}));
    expect(result.current[0]).toEqual(obj);
  });

  it('gestisce JSON non valido in localStorage senza crash', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('bad-json', '{invalid json}');
    const { result } = renderHook(() => useLocalStorage('bad-json', 'fallback'));
    // Dovrebbe rimanere il valore iniziale
    expect(result.current[0]).toBe('fallback');
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
