import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../select';

const options = [
  { value: 'option1', label: 'Opzione 1' },
  { value: 'option2', label: 'Opzione 2' },
  { value: 'option3', label: 'Opzione 3' },
];

describe('Select', () => {
  describe('Render di base', () => {
    it('mostra placeholder quando nessun valore selezionato', () => {
      render(<Select options={options} placeholder="Scegli..." />);
      expect(screen.getByText('Scegli...')).toBeInTheDocument();
    });

    it('mostra placeholder di default quando non fornito', () => {
      render(<Select options={options} />);
      expect(screen.getByText('Seleziona...')).toBeInTheDocument();
    });

    it('mostra valore selezionato quando value è fornito', () => {
      render(<Select options={options} value="option1" />);
      expect(screen.getByText('Opzione 1')).toBeInTheDocument();
    });

    it('applica className custom al wrapper', () => {
      const { container } = render(
        <Select options={options} className="my-class" />,
      );
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv.className).toContain('my-class');
    });
  });

  describe('Label e errore', () => {
    it('mostra errore quando fornito', () => {
      render(<Select options={options} error="Seleziona un'opzione" />);
      expect(screen.getByText("Seleziona un'opzione")).toBeInTheDocument();
    });

    it('mostra errore con ruolo alert', () => {
      render(<Select options={options} error="Errore" />);
      expect(screen.getByRole('alert')).toHaveTextContent('Errore');
    });

    it('mostra label quando fornita', () => {
      render(<Select options={options} label="Preferenza" />);
      expect(screen.getByText('Preferenza')).toBeInTheDocument();
    });

    it('label ha id associato al combobox via aria-labelledby', () => {
      render(<Select options={options} label="Test Label" />);
      const label = screen.getByText('Test Label');
      const combobox = screen.getByRole('combobox');
      expect(combobox.getAttribute('aria-labelledby')).toBe(label.getAttribute('id'));
    });
  });

  describe('Disabled state', () => {
    it('disabilitato non apre dropdown al click', async () => {
      render(<Select options={options} disabled />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('disabilitato ha attributo disabled sul button', () => {
      render(<Select options={options} disabled />);
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    it('disabilitato non risponde a Enter', async () => {
      render(<Select options={options} disabled />);
      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('Dropdown toggle', () => {
    it('apre dropdown al click', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('chiude dropdown al secondo click', async () => {
      render(<Select options={options} />);
      const combobox = screen.getByRole('combobox');
      await userEvent.click(combobox);
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await userEvent.click(combobox);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('mostra tutte le opzioni nel dropdown', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.getByText('Opzione 1')).toBeInTheDocument();
      expect(screen.getByText('Opzione 2')).toBeInTheDocument();
      expect(screen.getByText('Opzione 3')).toBeInTheDocument();
    });
  });

  describe('Selezione', () => {
    it('seleziona opzione al click', async () => {
      const handleChange = vi.fn();
      render(<Select options={options} onChange={handleChange} />);
      await userEvent.click(screen.getByRole('combobox'));
      await userEvent.click(screen.getByText('Opzione 2'));
      expect(handleChange).toHaveBeenCalledWith('option2');
    });

    it('onChange chiamato con valore corretto', async () => {
      const handleChange = vi.fn();
      render(<Select options={options} onChange={handleChange} />);
      await userEvent.click(screen.getByRole('combobox'));
      await userEvent.click(screen.getByText('Opzione 3'));
      expect(handleChange).toHaveBeenCalledWith('option3');
    });

    it('chiude dropdown dopo selezione', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      await userEvent.click(screen.getByText('Opzione 1'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('seleziona opzione con Enter sull\'opzione', async () => {
      const handleChange = vi.fn();
      render(<Select options={options} onChange={handleChange} />);
      await userEvent.click(screen.getByRole('combobox'));
      const secondOption = screen.getByText('Opzione 2');
      fireEvent.keyDown(secondOption, { key: 'Enter' });
      expect(handleChange).toHaveBeenCalledWith('option2');
    });

    it('aggiorna valore selezionato quando prop value cambia esternamente', () => {
      const { rerender } = render(<Select options={options} value="option1" />);
      expect(screen.getByText('Opzione 1')).toBeInTheDocument();
      rerender(<Select options={options} value="option2" />);
      expect(screen.getByText('Opzione 2')).toBeInTheDocument();
    });
  });

  describe('Keyboard navigation', () => {
    it('apre dropdown con Enter', async () => {
      render(<Select options={options} />);
      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await userEvent.keyboard('{Enter}');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('apre dropdown con Spazio', async () => {
      render(<Select options={options} />);
      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await userEvent.keyboard(' ');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('chiude dropdown con Escape', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('seleziona opzione dopo ArrowDown + Enter', async () => {
      const handleChange = vi.fn();
      render(<Select options={options} onChange={handleChange} />);
      await userEvent.click(screen.getByRole('combobox'));
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Enter}');
      expect(handleChange).toHaveBeenCalledWith('option1');
    });

    it('apre dropdown con ArrowDown', async () => {
      render(<Select options={options} />);
      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('naviga con ArrowDown tra le opzioni', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      const firstOption = screen.getAllByRole('option')[0];
      firstOption.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getAllByRole('option')[1]).toHaveFocus();
    });

    it('wrappa con ArrowDown dall\'ultima alla prima', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      const opts = screen.getAllByRole('option');
      opts.at(-1)!.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getAllByRole('option')[0]).toHaveFocus();
    });

    it('naviga con ArrowUp tra le opzioni', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      const opts = screen.getAllByRole('option');
      opts.at(-1)!.focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(opts.at(-2)).toHaveFocus();
    });

    it('wrappa con ArrowUp dalla prima all\'ultima', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      screen.getAllByRole('option')[0].focus();
      await userEvent.keyboard('{ArrowUp}');
      expect(screen.getAllByRole('option').at(-1)).toHaveFocus();
    });

    it('Home va alla prima opzione', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      const opts = screen.getAllByRole('option');
      opts.at(-1)!.focus();
      await userEvent.keyboard('{Home}');
      expect(screen.getAllByRole('option')[0]).toHaveFocus();
    });

    it('End va all\'ultima opzione', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      screen.getAllByRole('option')[0].focus();
      await userEvent.keyboard('{End}');
      expect(screen.getAllByRole('option').at(-1)).toHaveFocus();
    });
  });

  describe('Opzioni vuote', () => {
    it('mostra messaggio quando non ci sono opzioni', async () => {
      render(<Select options={[]} />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.getByText('Nessuna opzione')).toBeInTheDocument();
    });

    it('non mostra option quando lista vuota', async () => {
      render(<Select options={[]} />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });
  });

  describe('Click fuori', () => {
    it('chiude dropdown al click fuori', async () => {
      render(
        <div>
          <button data-testid="outside">Fuori</button>
          <Select options={options} />
        </div>,
      );
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await userEvent.click(screen.getByTestId('outside'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('Ruoli ARIA e accessibilità', () => {
    it('ha ruolo combobox sul trigger', () => {
      render(<Select options={options} />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('ha ruolo listbox quando aperto', async () => {
      render(<Select options={options} />);
      await userEvent.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('ha aria-expanded dinamico', async () => {
      render(<Select options={options} />);
      const combobox = screen.getByRole('combobox');
      expect(combobox).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(combobox);
      expect(combobox).toHaveAttribute('aria-expanded', 'true');
    });

    it('ha aria-haspopup e aria-controls sul trigger', async () => {
      render(<Select options={options} />);
      const combobox = screen.getByRole('combobox');
      expect(combobox).toHaveAttribute('aria-haspopup', 'listbox');
      expect(combobox).toHaveAttribute('aria-controls');
      await userEvent.click(combobox);
      const listbox = screen.getByRole('listbox');
      expect(listbox.id).toBe(combobox.getAttribute('aria-controls'));
    });

    it('ha aria-selected sull\'opzione attiva', async () => {
      render(<Select options={options} value="option2" />);
      await userEvent.click(screen.getByRole('combobox'));
      const options_aria = screen.getAllByRole('option');
      const option2 = options_aria.find((opt) => opt.textContent === 'Opzione 2')!;
      expect(option2).toHaveAttribute('aria-selected', 'true');
    });

    it('ha aria-invalid quando errore presente', () => {
      render(<Select options={options} error="Errore" />);
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid');
    });
  });
});
