import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from '../searchable-select';

const options = [
  { value: 'italy', label: 'Italia' },
  { value: 'france', label: 'Francia' },
  { value: 'germany', label: 'Germania' },
  { value: 'spain', label: 'Spagna' },
  { value: 'uk', label: 'Regno Unito' },
  { value: 'usa', label: 'Stati Uniti' },
  { value: 'japan', label: 'Giappone' },
  { value: 'china', label: 'Cina' },
];

describe('SearchableSelect', () => {
  describe('Render di base', () => {
    it('renderizza con placeholder di default', () => {
      render(<SearchableSelect options={options} />);
      expect(screen.getByText('Seleziona...')).toBeInTheDocument();
    });

    it('renderizza con placeholder custom', () => {
      render(
        <SearchableSelect options={options} placeholder="Scegli una nazione..." />,
      );
      expect(screen.getByText('Scegli una nazione...')).toBeInTheDocument();
    });

    it('mostra il valore selezionato', () => {
      render(<SearchableSelect options={options} value="italy" />);
      expect(screen.getByText('Italia')).toBeInTheDocument();
    });

    it('mostra il placeholder quando niente è selezionato', () => {
      render(<SearchableSelect options={options} />);
      const trigger = screen.getByRole('combobox');
      expect(trigger).toHaveTextContent('Seleziona...');
    });

    it('applica className custom al wrapper', () => {
      const { container } = render(
        <SearchableSelect options={options} className="my-custom-class" />,
      );
      const outerDiv = container.firstChild as HTMLElement;
      expect(outerDiv.className).toContain('my-custom-class');
    });
  });

  describe('Dropdown toggle', () => {
    it('apre il dropdown al click sul trigger', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByRole('searchbox')).toBeInTheDocument();
    });

    it('chiude il dropdown al secondo click sul trigger', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await user.click(screen.getByRole('combobox'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('mostra tutte le opzioni quando il dropdown è aperto', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      expect(screen.getByText('Italia')).toBeInTheDocument();
      expect(screen.getByText('Francia')).toBeInTheDocument();
      expect(screen.getByText('Germania')).toBeInTheDocument();
      expect(screen.getByText('Cina')).toBeInTheDocument();
    });
  });

  describe('Filtro e ricerca', () => {
    it('filtra le opzioni in base al testo di ricerca', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const searchInput = screen.getByRole('searchbox');
      await user.type(searchInput, 'ia');

      // Italia, Francia, Germania, Giappone contengono "ia"
      expect(screen.getByText('Italia')).toBeInTheDocument();
      expect(screen.getByText('Francia')).toBeInTheDocument();
      expect(screen.getByText('Germania')).toBeInTheDocument();
      expect(screen.getByText('Giappone')).toBeInTheDocument();
      // Spagna, Cina, Regno Unito, Stati Uniti no
      expect(screen.queryByText('Spagna')).not.toBeInTheDocument();
      expect(screen.queryByText('Cina')).not.toBeInTheDocument();
    });

    it('filtra le opzioni case-insensitive', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const searchInput = screen.getByRole('searchbox');
      await user.type(searchInput, 'IA');

      // Dovrebbe comunque trovare Italia, Francia, Germania, Giappone
      expect(screen.getByText('Italia')).toBeInTheDocument();
      expect(screen.getByText('Francia')).toBeInTheDocument();
      expect(screen.getByText('Germania')).toBeInTheDocument();
      expect(screen.getByText('Giappone')).toBeInTheDocument();
      expect(screen.queryByText('Spagna')).not.toBeInTheDocument();
    });

    it('filtra per value field (non solo label)', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const searchInput = screen.getByRole('searchbox');
      await user.type(searchInput, 'uk');

      expect(screen.getByText('Regno Unito')).toBeInTheDocument();
      expect(screen.queryByText('Italia')).not.toBeInTheDocument();
    });

    it('mostra messaggio empty results quando nessuna opzione corrisponde', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const searchInput = screen.getByRole('searchbox');
      await user.type(searchInput, 'zzzzz');

      expect(screen.getByText('Nessun risultato')).toBeInTheDocument();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('resetta la ricerca quando il dropdown viene chiuso', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const searchInput = screen.getByRole('searchbox');
      await user.type(searchInput, 'ia');

      // Chiudi dropdown selezionando un'opzione
      await user.click(screen.getByText('Italia'));

      // Riapri dropdown
      await user.click(screen.getByRole('combobox'));

      // Il campo di ricerca dovrebbe essere vuoto e tutte le opzioni visibili
      const searchInputAgain = screen.getByRole('searchbox');
      expect(searchInputAgain).toHaveValue('');
      expect(screen.getByText('Francia')).toBeInTheDocument();
    });

    it('ha searchPlaceholder custom', async () => {
      const user = userEvent.setup();
      render(
        <SearchableSelect
          options={options}
          searchPlaceholder="Trova paese..."
        />,
      );

      await user.click(screen.getByRole('combobox'));

      expect(
        screen.getByPlaceholderText('Trova paese...'),
      ).toBeInTheDocument();
    });
  });

  describe('Selezione', () => {
    it('seleziona opzione al click e chiude dropdown', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<SearchableSelect options={options} onChange={handleChange} />);

      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByText('Francia'));

      expect(handleChange).toHaveBeenCalledWith('france');
      expect(handleChange).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('chiama onChange con valore corretto', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<SearchableSelect options={options} onChange={handleChange} />);

      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByText('Giappone'));

      expect(handleChange).toHaveBeenCalledWith('japan');
    });

    it('seleziona opzione con Enter da tastiera', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<SearchableSelect options={options} onChange={handleChange} />);

      // Apri con Enter
      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('listbox')).toBeInTheDocument();

      // Premi Enter per selezionare l'opzione evidenziata (la prima: Italia)
      // Ma quando si apre col trigger, non c'è aria-selected impostato
      // Quindi Enter sul container non farà nulla - testiamo invece il click sull'opzione

      // Invece, premi ArrowDown e poi Enter
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(handleChange).toHaveBeenCalledWith('italy');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('non chiama onChange quando disabilitato', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<SearchableSelect options={options} onChange={handleChange} disabled />);

      await user.click(screen.getByRole('combobox'));
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard navigation', () => {
    it('apre dropdown con Enter sul trigger', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('apre dropdown con ArrowDown sul trigger', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await user.keyboard('{ArrowDown}');

      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('chiude dropdown con Escape', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('naviga con ArrowDown tra le opzioni', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      // Dopo ArrowDown, la prima opzione dovrebbe ricevere focus
      const firstOption = screen.getAllByRole('option')[0];
      firstOption.focus();
      expect(firstOption).toHaveFocus();

      // ArrowDown alla prossima
      await user.keyboard('{ArrowDown}');
      const secondOption = screen.getAllByRole('option')[1];
      expect(secondOption).toHaveFocus();
    });

    it('naviga con ArrowUp tra le opzioni', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const lastOption = screen.getAllByRole('option').at(-1)!;
      lastOption.focus();

      await user.keyboard('{ArrowUp}');
      const secondLastOption = screen.getAllByRole('option').at(-2)!;
      expect(secondLastOption).toHaveFocus();
    });

    it('wrappa con ArrowDown dall\'ultima opzione alla prima', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      const options_list = screen.getAllByRole('option');
      options_list.at(-1)!.focus();

      await user.keyboard('{ArrowDown}');
      expect(screen.getAllByRole('option')[0]).toHaveFocus();
    });

    it('wrappa con ArrowUp dalla prima opzione all\'ultima', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      await user.click(screen.getByRole('combobox'));

      screen.getAllByRole('option')[0].focus();

      await user.keyboard('{ArrowUp}');
      expect(screen.getAllByRole('option').at(-1)!).toHaveFocus();
    });
  });

  describe('Stati ed edge case', () => {
    it('ha stile opacizzato quando disabilitato', () => {
      render(<SearchableSelect options={options} disabled />);

      const trigger = screen.getByRole('combobox');
      expect(trigger).toBeDisabled();
    });

    it('non apre dropdown quando disabilitato', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} disabled />);

      await user.click(screen.getByRole('combobox'));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('non risponde a keyboard quando disabilitato', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} disabled />);

      const combobox = screen.getByRole('combobox');
      combobox.focus();
      await user.keyboard('{Enter}');

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('funziona con lista opzioni vuota', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={[]} />);

      expect(screen.getByText('Seleziona...')).toBeInTheDocument();

      await user.click(screen.getByRole('combobox'));

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByText('Nessun risultato')).toBeInTheDocument();
    });

    it('seleziona opzione con Enter diretto sull\'opzione', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<SearchableSelect options={options} onChange={handleChange} />);

      await user.click(screen.getByRole('combobox'));

      const spagnaOption = screen.getByText('Spagna');
      spagnaOption.focus();
      await user.keyboard('{Enter}');

      expect(handleChange).toHaveBeenCalledWith('spain');
    });
  });

  describe('Ruoli ARIA e accessibilità', () => {
    it('ha ruolo combobox sul trigger e searchbox sul campo ricerca', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      expect(screen.getByRole('combobox')).toBeInTheDocument();

      await user.click(screen.getByRole('combobox'));

      expect(screen.getByRole('searchbox')).toBeInTheDocument();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('ha aria-expanded sul trigger quando il dropdown è aperto', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      const combobox = screen.getByRole('combobox');
      expect(combobox).toHaveAttribute('aria-expanded', 'false');

      await user.click(combobox);
      expect(combobox).toHaveAttribute('aria-expanded', 'true');
    });

    it('ha aria-haspopup e aria-controls sul trigger', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} />);

      const combobox = screen.getByRole('combobox');
      expect(combobox).toHaveAttribute('aria-haspopup', 'listbox');
      expect(combobox).toHaveAttribute('aria-controls');

      await user.click(combobox);
      const listbox = screen.getByRole('listbox');
      expect(listbox.id).toBe(combobox.getAttribute('aria-controls'));
    });

    it('ha aria-selected sull\'opzione attiva', async () => {
      const user = userEvent.setup();
      render(<SearchableSelect options={options} value="italy" />);

      await user.click(screen.getByRole('combobox'));

            const italiaOption = screen.getAllByRole('option').find(el => el.textContent === 'Italia')!;
      expect(italiaOption).toHaveAttribute('aria-selected', 'true');
    });
  });
});
