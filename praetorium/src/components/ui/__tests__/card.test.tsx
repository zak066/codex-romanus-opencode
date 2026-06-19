import { render, screen } from '@testing-library/react';
import { Card } from '../card';

describe('Card', () => {
  it('Card renderizza children', () => {
    render(<Card>Contenuto</Card>);
    expect(screen.getByText('Contenuto')).toBeInTheDocument();
  });

  it('Card.Header renderizza title', () => {
    render(
      <Card>
        <Card.Header title="Titolo Card" />
      </Card>,
    );
    expect(screen.getByText('Titolo Card')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /titolo card/i })).toBeInTheDocument();
  });

  it('Card.Header renderizza subtitle', () => {
    render(
      <Card>
        <Card.Header title="Titolo" subtitle="Sottotitolo" />
      </Card>,
    );
    expect(screen.getByText('Sottotitolo')).toBeInTheDocument();
  });

  it('Card.Header non renderizza subtitle se non fornito', () => {
    render(
      <Card>
        <Card.Header title="Titolo" />
      </Card>,
    );
    expect(screen.queryByText('Sottotitolo')).not.toBeInTheDocument();
  });

  it('Card.Body renderizza children', () => {
    render(
      <Card>
        <Card.Body>Body content</Card.Body>
      </Card>,
    );
    expect(screen.getByText('Body content')).toBeInTheDocument();
  });

  it('Card.Footer renderizza children', () => {
    render(
      <Card>
        <Card.Footer>Footer content</Card.Footer>
      </Card>,
    );
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('Composizione: Card.Header + Card.Body + Card.Footer insieme', () => {
    render(
      <Card>
        <Card.Header title="Titolo" subtitle="Sottotitolo" />
        <Card.Body>Corpo</Card.Body>
        <Card.Footer>Footer</Card.Footer>
      </Card>,
    );
    expect(screen.getByText('Titolo')).toBeInTheDocument();
    expect(screen.getByText('Sottotitolo')).toBeInTheDocument();
    expect(screen.getByText('Corpo')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('Card.Header ha action opzionale', () => {
    render(
      <Card>
        <Card.Header title="Titolo" action={<button>Azione</button>} />
      </Card>,
    );
    expect(screen.getByRole('button', { name: /azione/i })).toBeInTheDocument();
  });

  it('Card applica className su CardRoot', () => {
    const { container } = render(<Card className="extra-card">Ciao</Card>);
    // Il primo div con children "Ciao" ha className extra-card
    expect(container.querySelector('.extra-card')).toBeInTheDocument();
  });
});
