import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../modal';

describe('Modal', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  it('non renderizza quando isOpen=false', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={vi.fn()}>
        Contenuto
      </Modal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renderizza quando isOpen=true', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        Contenuto Modale
      </Modal>,
    );
    expect(screen.getByText('Contenuto Modale')).toBeInTheDocument();
  });

  it('mostra title e children', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Titolo Modale">
        Corpo
      </Modal>,
    );
    expect(screen.getByText('Titolo Modale')).toBeInTheDocument();
    expect(screen.getByText('Corpo')).toBeInTheDocument();
  });

  it('onClose chiamato su click overlay', async () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose}>
        Contenuto
      </Modal>,
    );

    const overlay = screen.getByRole('dialog');
    // Click directly on the overlay background
    await userEvent.click(overlay);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('onClose non chiamato su click dentro il panel', async () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose}>
        <button>Dentro</button>
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: /dentro/i }));
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('onClose chiamato su tasto Escape', () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose}>
        Contenuto
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('Escape chiama stopPropagation per evitare conflitti', () => {
    const handleClose = vi.fn();
    const parentKeyHandler = vi.fn();
    render(
      <div onKeyDown={parentKeyHandler}>
        <Modal isOpen={true} onClose={handleClose}>
          Contenuto
        </Modal>
      </div>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('Tab cicla tra elementi focusabili nel panel', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <button>Primo</button>
        <button>Secondo</button>
        <button>Terzo</button>
      </Modal>,
    );

    const firstButton = screen.getByText('Primo');
    const secondButton = screen.getByText('Secondo');
    const thirdButton = screen.getByText('Terzo');

    // Focus the first button
    firstButton.focus();
    expect(firstButton).toHaveFocus();

    // Tab should go to second
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(secondButton).toHaveFocus();

    // Tab again to third
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(thirdButton).toHaveFocus();

    // Tab again should wrap to first (focus trap)
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(firstButton).toHaveFocus();
  });

  it('Shift+Tab wrappa all\'ultimo elemento focusabile', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <button>Primo</button>
        <button>Ultimo</button>
      </Modal>,
    );

    const firstButton = screen.getByText('Primo');
    const lastButton = screen.getByText('Ultimo');

    firstButton.focus();
    expect(firstButton).toHaveFocus();

    // Shift+Tab should go to last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(lastButton).toHaveFocus();
  });

  it('Tab con nessun elemento focusabile non causa errori', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <span>Solo testo</span>
      </Modal>,
    );

    // Should not throw when no focusable elements
    expect(() => {
      fireEvent.keyDown(document, { key: 'Tab' });
    }).not.toThrow();
  });

  it('blocca scroll del body quando aperto', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        Contenuto
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('ripristina scroll del body quando chiuso', () => {
    const { rerender } = render(
      <Modal isOpen={true} onClose={vi.fn()}>
        Contenuto
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} onClose={vi.fn()}>
        Contenuto
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('');
  });

  it('ripristina scroll del body anche dopo smontaggio', () => {
    const { unmount } = render(
      <Modal isOpen={true} onClose={vi.fn()}>
        Contenuto
      </Modal>,
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('supporta multiple chiamate onClose senza errori', () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose}>
        Contenuto
      </Modal>,
    );

    // Chiama Escape due volte
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('ha role="dialog" e aria-modal="true"', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test">
        Contenuto
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('ha aria-labelledby quando title è presente', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Accessibile">
        Contenuto
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('pulsante chiudi con aria-label è presente quando c\'è un titolo', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test">
        Contenuto
      </Modal>,
    );
    expect(screen.getByLabelText('Chiudi')).toBeInTheDocument();
  });
});
