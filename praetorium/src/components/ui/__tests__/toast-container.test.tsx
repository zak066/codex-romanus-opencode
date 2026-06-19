import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastContainer } from '../toast-container';

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toasts: [],
    dismiss: vi.fn(),
  })),
}));

describe('ToastContainer', () => {
  it('renderizza null quando toasts è vuoto', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });
});
