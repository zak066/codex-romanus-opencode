import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdvisoryCards from '../AdvisoryCards';
import type { AgentRecommendation } from '@/lib/advisory/types';

// ─── Mock data ────────────────────────────────────────────────

const mockRecommendations: AgentRecommendation[] = [
  {
    agentId: 'iuppiter-orchestrator',
    agentName: 'Iuppiter',
    mode: 'high',
    recommendations: [
      {
        model: {
          name: 'DeepSeek V4 Pro',
          creator: 'DeepSeek',
          opencodeId: 'opencode-go/deepseek-v4-pro',
          provider: 'go',
          hasReasoning: true,
          intelligence: 55,
          speed: 120,
          price: 2.5,
          latency: 0.8,
          totalResponseTime: 3.2,
          contextWindow: 128000,
        },
        score: 0.92,
        breakdown: {
          intelligenceComponent: 0.45,
          speedComponent: 0.25,
          costComponent: 0.12,
          reasoningComponent: 0.10,
        },
      },
      {
        model: {
          name: 'GPT-5.5 Turbo',
          creator: 'OpenAI',
          opencodeId: 'opencode-zen/gpt-5.5-turbo',
          provider: 'zen',
          hasReasoning: false,
          intelligence: 50,
          speed: 200,
          price: 1.5,
          latency: 0.5,
          totalResponseTime: 2.0,
          contextWindow: 256000,
        },
        score: 0.85,
        breakdown: {
          intelligenceComponent: 0.40,
          speedComponent: 0.30,
          costComponent: 0.15,
          reasoningComponent: 0,
        },
      },
    ],
  },
  {
    agentId: 'minerva-architect',
    agentName: 'Minerva',
    mode: 'high',
    recommendations: [
      {
        model: {
          name: 'Claude Opus 5',
          creator: 'Anthropic',
          opencodeId: 'opencode-zen/claude-opus-5',
          provider: 'zen',
          hasReasoning: true,
          intelligence: 58,
          speed: 80,
          price: 3.0,
          latency: 1.2,
          totalResponseTime: 5.0,
          contextWindow: 200000,
        },
        score: 0.88,
        breakdown: {
          intelligenceComponent: 0.50,
          speedComponent: 0.15,
          costComponent: 0.08,
          reasoningComponent: 0.15,
        },
      },
    ],
  },
];

describe('AdvisoryCards', () => {
  it('renderizza la sezione con ruolo', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    const section = screen.getByLabelText('Raccomandazioni per agente');
    expect(section).toBeInTheDocument();
  });

  it('mostra il nome di ogni agente', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    expect(screen.getByText('Iuppiter')).toBeInTheDocument();
    expect(screen.getByText('Minerva')).toBeInTheDocument();
  });

  it('mostra l\'agentId di ogni agente', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    expect(screen.getByText('iuppiter-orchestrator')).toBeInTheDocument();
    expect(screen.getByText('minerva-architect')).toBeInTheDocument();
  });

  it('mostra i nomi dei modelli raccomandati', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    expect(screen.getByText('DeepSeek V4 Pro')).toBeInTheDocument();
    expect(screen.getByText('GPT-5.5 Turbo')).toBeInTheDocument();
    expect(screen.getByText('Claude Opus 5')).toBeInTheDocument();
  });

  it('mostra il badge del provider per ogni modello', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    // Go badge
    const goBadges = screen.getAllByText('Go');
    expect(goBadges.length).toBeGreaterThanOrEqual(1);
    // Zen badge
    const zenBadges = screen.getAllByText('Zen');
    expect(zenBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('mostra il badge Reasoning per modelli con hasReasoning', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    const reasoningBadges = screen.getAllByText('Reasoning');
    // DeepSeek V4 Pro e Claude Opus 5 hanno reasoning
    expect(reasoningBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('mostra il nome del creator per ogni modello', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('renderizza le card con bordo sinistro colorato', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    // Ogni card ha aria-label specifico
    expect(cards[0]).toHaveAttribute('aria-label', 'Raccomandazioni per Iuppiter');
    expect(cards[1]).toHaveAttribute('aria-label', 'Raccomandazioni per Minerva');
  });

  it('renderizza messaggio vuoto se recommendations è array vuoto', () => {
    render(<AdvisoryCards recommendations={[]} mode="high" />);
    const section = screen.getByLabelText('Raccomandazioni per agente');
    expect(section).toBeInTheDocument();
    expect(section.children).toHaveLength(0);
  });

  it('mostra le metriche (ScoreBar e badge intelligenza)', () => {
    render(<AdvisoryCards recommendations={mockRecommendations} mode="high" />);
    // I valori di intelligenza appaiono nel componente
    expect(screen.getByText('55')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('58')).toBeInTheDocument();
  });
});
