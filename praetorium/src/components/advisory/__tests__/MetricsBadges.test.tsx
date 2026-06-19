import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MetricsBadges from '../MetricsBadges';

describe('MetricsBadges', () => {
  it('renderizza intelligence', () => {
    render(<MetricsBadges intelligence={85} speed={42} price={1.5} />);
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('renderizza speed con unità', () => {
    render(<MetricsBadges intelligence={85} speed={42} price={1.5} />);
    expect(screen.getByText('42 t/s')).toBeInTheDocument();
  });

  it('renderizza price con formato', () => {
    render(<MetricsBadges intelligence={85} speed={42} price={1.5} />);
    expect(screen.getByText('$1.50')).toBeInTheDocument();
  });

  it('ha label accessibile', () => {
    render(<MetricsBadges intelligence={85} speed={42} price={1.5} />);
    expect(screen.getByLabelText('Metriche del modello')).toBeInTheDocument();
  });
});
