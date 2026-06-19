import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '../toggle';

describe('Toggle', () => {
  it('renderizza con label', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Notifiche" />);
    expect(screen.getByText('Notifiche')).toBeInTheDocument();
  });

  it('checked=true → aria-checked="true"', () => {
    render(<Toggle checked={true} onChange={vi.fn()} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('checked=false → aria-checked="false"', () => {
    render(<Toggle checked={false} onChange={vi.fn()} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('onClick chiamato con !checked quando checked=true', async () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it('onClick chiamato con !checked quando checked=false', async () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('ha role="switch"', () => {
    render(<Toggle checked={false} onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('label è associata al toggle via htmlFor', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Opzione" />);
    const toggle = screen.getByRole('switch');
    const label = screen.getByText('Opzione');
    expect(label).toHaveAttribute('for', toggle.id);
  });

  it('disabilitato non chiama onChange al click', async () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} disabled />);
    await userEvent.click(screen.getByRole('switch'));
    expect(handleChange).not.toHaveBeenCalled();
  });

  // --- Keyboard tests ---
  it('Enter toggla checked da false a true', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('Enter toggla checked da true a false', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it('Space toggla checked da false a true', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('Space toggla checked da true a false', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it('Enter non toggla quando disabilitato', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} disabled />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('Space non toggla quando disabilitato', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} disabled />);
    const toggle = screen.getByRole('switch');
    fireEvent.keyDown(toggle, { key: ' ' });
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('Enter chiama preventDefault', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    const toggle = screen.getByRole('switch');

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    toggle.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('stile checked quando checked=true', () => {
    render(<Toggle checked={true} onChange={vi.fn()} />);
    const toggle = screen.getByRole('switch');
    expect(toggle.className).toContain('bg-roman-gold');
  });

  it('stile unchecked quando checked=false', () => {
    render(<Toggle checked={false} onChange={vi.fn()} />);
    const toggle = screen.getByRole('switch');
    expect(toggle.className).not.toContain('bg-roman-gold');
  });

  it('disabilitato ha classe opacity-50', () => {
    render(<Toggle checked={false} onChange={vi.fn()} disabled />);
    const toggle = screen.getByRole('switch');
    expect(toggle.className).toContain('opacity-50');
  });

  it('label ha colore disabilitato quando disabled', () => {
    render(<Toggle checked={false} onChange={vi.fn()} disabled label="Off" />);
    const label = screen.getByText('Off');
    expect(label.className).toContain('text-text-disabled');
  });
});
