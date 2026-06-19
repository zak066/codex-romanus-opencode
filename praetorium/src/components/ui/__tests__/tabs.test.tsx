import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../tabs';

const tabs = [
  { id: 'tab1', label: 'Primo Tab', content: <p>Contenuto primo</p> },
  { id: 'tab2', label: 'Secondo Tab', content: <p>Contenuto secondo</p> },
  { id: 'tab3', label: 'Terzo Tab', content: <p>Contenuto terzo</p> },
];

describe('Tabs', () => {
  it('mostra tutti i tab label', () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByText('Primo Tab')).toBeInTheDocument();
    expect(screen.getByText('Secondo Tab')).toBeInTheDocument();
    expect(screen.getByText('Terzo Tab')).toBeInTheDocument();
  });

  it('defaultTab selezionato all\'inizio', () => {
    render(<Tabs tabs={tabs} defaultTab="tab2" />);
    const tab2 = screen.getByText('Secondo Tab').closest('button')!;
    expect(tab2).toHaveAttribute('aria-selected', 'true');
  });

  it('primo tab selezionato di default se defaultTab non fornito', () => {
    render(<Tabs tabs={tabs} />);
    const tab1 = screen.getByText('Primo Tab').closest('button')!;
    expect(tab1).toHaveAttribute('aria-selected', 'true');
  });

  it('defaultTab non valido non causa errori', () => {
    const { container } = render(<Tabs tabs={tabs} defaultTab="nonexistent" />);
    // Should render without crash, no tab selected
    expect(container.querySelector('[aria-selected="true"]')).not.toBeInTheDocument();
  });

  it('onChange chiamato al click su tab', () => {
    const handleChange = vi.fn();
    render(<Tabs tabs={tabs} onChange={handleChange} />);
    fireEvent.click(screen.getByText('Secondo Tab'));
    expect(handleChange).toHaveBeenCalledWith('tab2');
  });

  it('mostra contenuto del tab attivo', () => {
    render(<Tabs tabs={tabs} defaultTab="tab2" />);
    expect(screen.getByText('Contenuto secondo')).toBeInTheDocument();
  });

  it('non mostra contenuto tab inattivo', () => {
    render(<Tabs tabs={tabs} defaultTab="tab2" />);
    expect(screen.queryByText('Contenuto primo')).not.toBeInTheDocument();
    expect(screen.queryByText('Contenuto terzo')).not.toBeInTheDocument();
  });

  it('cambia contenuto al click su tab diverso', () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByText('Contenuto primo')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Secondo Tab'));
    expect(screen.getByText('Contenuto secondo')).toBeInTheDocument();
    expect(screen.queryByText('Contenuto primo')).not.toBeInTheDocument();
  });

  it('click su tab attivo imposta aria-selected="true"', () => {
    render(<Tabs tabs={tabs} />);
    const tab2 = screen.getByText('Secondo Tab').closest('button')!;
    fireEvent.click(tab2);
    expect(tab2).toHaveAttribute('aria-selected', 'true');
    const tab1 = screen.getByText('Primo Tab').closest('button')!;
    expect(tab1).toHaveAttribute('aria-selected', 'false');
  });

  // --- Keyboard: arrow keys ---
  it('ArrowRight naviga al tab successivo', () => {
    render(<Tabs tabs={tabs} />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowRight' });
    expect(screen.getByText('Secondo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenuto secondo')).toBeInTheDocument();
  });

  it('ArrowLeft naviga al tab precedente', () => {
    render(<Tabs tabs={tabs} defaultTab="tab2" />);
    const activeTab = screen.getByText('Secondo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowLeft' });
    expect(screen.getByText('Primo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenuto primo')).toBeInTheDocument();
  });

  it('ArrowRight chiama onChange con il tab successivo', () => {
    const handleChange = vi.fn();
    render(<Tabs tabs={tabs} onChange={handleChange} />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowRight' });
    expect(handleChange).toHaveBeenCalledWith('tab2');
  });

  it('ArrowLeft chiama onChange con il tab precedente', () => {
    const handleChange = vi.fn();
    render(<Tabs tabs={tabs} defaultTab="tab2" onChange={handleChange} />);
    const activeTab = screen.getByText('Secondo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowLeft' });
    expect(handleChange).toHaveBeenCalledWith('tab1');
  });

  it('ArrowRight wrappa all\'ultimo tab', () => {
    render(<Tabs tabs={tabs} defaultTab="tab3" />);
    const activeTab = screen.getByText('Terzo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowRight' });
    expect(screen.getByText('Primo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowLeft wrappa al primo tab', () => {
    render(<Tabs tabs={tabs} defaultTab="tab1" />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowLeft' });
    expect(screen.getByText('Terzo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  // --- Keyboard: Home & End keys ---
  it('Home naviga al primo tab', () => {
    render(<Tabs tabs={tabs} defaultTab="tab3" />);
    const activeTab = screen.getByText('Terzo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'Home' });
    expect(screen.getByText('Primo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenuto primo')).toBeInTheDocument();
  });

  it('End naviga all\'ultimo tab', () => {
    render(<Tabs tabs={tabs} defaultTab="tab1" />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'End' });
    expect(screen.getByText('Terzo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Contenuto terzo')).toBeInTheDocument();
  });

  it('Home chiama onChange con il primo tab', () => {
    const handleChange = vi.fn();
    render(<Tabs tabs={tabs} defaultTab="tab2" onChange={handleChange} />);
    const activeTab = screen.getByText('Secondo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'Home' });
    expect(handleChange).toHaveBeenCalledWith('tab1');
  });

  it('End chiama onChange con l\'ultimo tab', () => {
    const handleChange = vi.fn();
    render(<Tabs tabs={tabs} defaultTab="tab1" onChange={handleChange} />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'End' });
    expect(handleChange).toHaveBeenCalledWith('tab3');
  });

  // --- Keyboard: altre keys non fanno nulla ---
  it('ArrowDown non fa nulla (key ignorata)', () => {
    render(<Tabs tabs={tabs} />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'ArrowDown' });
    // Primo tab rimane selezionato
    expect(screen.getByText('Primo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  it('altri tasti non hanno effetto', () => {
    render(<Tabs tabs={tabs} />);
    const activeTab = screen.getByText('Primo Tab').closest('button')!;
    fireEvent.keyDown(activeTab, { key: 'a' });
    // Primo tab rimane selezionato
    expect(screen.getByText('Primo Tab').closest('button')).toHaveAttribute('aria-selected', 'true');
  });

  // --- ARIA attributes ---
  it('ha role="tablist" e role="tab"', () => {
    render(<Tabs tabs={tabs} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').length).toBe(3);
  });

  it('ha role="tabpanel" per il tab attivo', () => {
    render(<Tabs tabs={tabs} />);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Contenuto primo');
  });

  it('tab ha aria-controls che referenzia tabpanel', () => {
    render(<Tabs tabs={tabs} />);
    const tab1 = screen.getByText('Primo Tab').closest('button')!;
    expect(tab1).toHaveAttribute('aria-controls');
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe(tab1.getAttribute('aria-controls'));
  });

  it('tabpanel ha aria-labelledby che referenzia tab', () => {
    render(<Tabs tabs={tabs} />);
    const tab1 = screen.getByText('Primo Tab').closest('button')!;
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab1.id);
  });

  // --- Edge cases ---
  it('ritorna null se tabs è vuoto', () => {
    const { container } = render(<Tabs tabs={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('funziona con un solo tab', () => {
    render(<Tabs tabs={[{ id: 'solo', label: 'Solo', content: <p>Unico</p> }]} />);
    expect(screen.getByText('Solo')).toBeInTheDocument();
    expect(screen.getByText('Unico')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').length).toBe(1);
  });

  it('cambia tab cliccando e verifica tabIndex corretto', () => {
    render(<Tabs tabs={tabs} />);
    const tab1 = screen.getByText('Primo Tab').closest('button')!;
    const tab2 = screen.getByText('Secondo Tab').closest('button')!;

    expect(tab1).toHaveAttribute('tabIndex', '0');
    expect(tab2).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(tab2);
    expect(tab1).toHaveAttribute('tabIndex', '-1');
    expect(tab2).toHaveAttribute('tabIndex', '0');
  });
});
