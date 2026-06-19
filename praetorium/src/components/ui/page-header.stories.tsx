import type { Meta, StoryObj } from '@storybook/react';
import { PageHeader } from './page-header';
import { Button } from './button';

const meta: Meta<typeof PageHeader> = {
  title: 'UI/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PageHeader>;

export const Default: Story = {
  args: {
    title: 'Metrics',
  },
};

export const WithDescription: Story = {
  args: {
    title: 'Agents',
    description: 'Stato in tempo reale degli agenti Codex Romanus.',
  },
};

export const WithActions: Story = {
  args: {
    title: 'Decisions',
    description: 'Architecture Decision Records del Codex Romanus.',
    actions: (
      <Button variant="primary" size="sm">
        + New Decision
      </Button>
    ),
  },
};
