import { render, screen } from '@testing-library/react';
import { PageHeader } from '../page-header';

describe('PageHeader', () => {
  // --- Render with title only ---
  it('renderizza con title', () => {
    render(<PageHeader title="Metrics" />);
    expect(screen.getByRole('heading', { level: 1, name: /metrics/i })).toBeInTheDocument();
  });

  // --- Render with title + description ---
  it('renderizza title e description', () => {
    render(
      <PageHeader
        title="Agents"
        description="Stato in tempo reale degli agenti Codex Romanus."
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: /agents/i })).toBeInTheDocument();
    expect(screen.getByText(/stato in tempo reale/i)).toBeInTheDocument();
  });

  // --- Render with actions ---
  it('renderizza actions quando fornite', () => {
    render(
      <PageHeader
        title="Decisions"
        actions={<button>+ New</button>}
      />,
    );
    expect(screen.getByRole('button', { name: /\+ new/i })).toBeInTheDocument();
  });

  // --- Non mostra description quando assente ---
  it('non mostra description se non fornita', () => {
    const { container } = render(<PageHeader title="Only Title" />);
    // The only paragraph is from the description — should not exist
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs.length).toBe(0);
  });

  // --- displayName ---
  it('ha displayName corretto', () => {
    expect(PageHeader.displayName).toBe('PageHeader');
  });

  // --- className custom ---
  it('applica className custom', () => {
    const { container } = render(
      <PageHeader title="Test" className="my-custom-class" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('my-custom-class');
  });
});
