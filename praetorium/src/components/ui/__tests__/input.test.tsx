import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../input';

describe('Input', () => {
  it('renderizza input con placeholder', () => {
    render(<Input placeholder="Inserisci nome" />);
    const input = screen.getByPlaceholderText('Inserisci nome');
    expect(input).toBeInTheDocument();
  });

  it('Label viene renderizzata e associata via htmlFor', () => {
    render(<Input label="Nome" id="name-input" />);
    const input = screen.getByLabelText('Nome');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'name-input');
  });

  it('label genera id automaticamente se non fornito', () => {
    render(<Input label="Email" />);
    const input = screen.getByLabelText('Email');
    // id dovrebbe essere "email" (label lowercase e senza spazi)
    expect(input).toHaveAttribute('id', 'email');
  });

  it('onChange viene chiamato', async () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} />);
    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'a');
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('stampa errore sotto l\'input', () => {
    render(<Input label="Nome" error="Campo obbligatorio" />);
    expect(screen.getByText('Campo obbligatorio')).toBeInTheDocument();
    expect(screen.getByText('Campo obbligatorio')).toHaveAttribute('role', 'alert');
  });

  it('aria-invalid quando errore', () => {
    render(<Input label="Nome" error="Errore" />);
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('aria-describedby punta all\'errore', () => {
    render(<Input label="Nome" error="Errore test" />);
    const input = screen.getByLabelText('Nome');
    const error = screen.getByText('Errore test');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('non ha aria-invalid senza errore', () => {
    render(<Input label="Nome" />);
    const input = screen.getByLabelText('Nome');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('forwardRef funziona', () => {
    const ref = vi.fn();
    render(<Input ref={ref} />);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
  });
});
