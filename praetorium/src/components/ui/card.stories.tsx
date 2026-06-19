import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './card';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: (
      <Card.Body>This is a plain card with just body content.</Card.Body>
    ),
  },
};

export const WithHeaderAndBody: Story = {
  args: {
    children: (
      <>
        <Card.Header title="Card Title" subtitle="Optional subtitle for context" />
        <Card.Body>
          <p className="text-text-secondary">This is the main content area of the card. Cards are used to group related information.</p>
        </Card.Body>
      </>
    ),
  },
};

export const WithHeaderAction: Story = {
  args: {
    children: (
      <>
        <Card.Header
          title="Projects"
          subtitle="3 active projects"
          action={
            <button className="px-3 py-1 text-sm bg-roman-gold text-text-inverse rounded-md hover:bg-roman-gold-dark transition-colors">
              + New
            </button>
          }
        />
        <Card.Body>
          <div className="space-y-3">
            {['Codex Romanus', 'Praetorium Dashboard', 'Aurelius API'].map((project) => (
              <div key={project} className="flex items-center gap-3 p-2 rounded-md bg-surface-base">
                <div className="h-2 w-2 rounded-full bg-roman-gold" />
                <span className="text-sm text-text-primary">{project}</span>
              </div>
            ))}
          </div>
        </Card.Body>
      </>
    ),
  },
};

export const WithFooter: Story = {
  args: {
    children: (
      <>
        <Card.Header title="Confirm Action" />
        <Card.Body>
          <p className="text-text-secondary">Are you sure you want to proceed with this action? This cannot be undone.</p>
        </Card.Body>
        <Card.Footer>
          <div className="flex justify-end gap-2">
            <button className="px-4 py-2 text-sm border border-border-default rounded-md hover:bg-surface-overlay transition-colors">
              Cancel
            </button>
            <button className="px-4 py-2 text-sm bg-roman-gold text-text-inverse rounded-md hover:bg-roman-gold-dark transition-colors">
              Confirm
            </button>
          </div>
        </Card.Footer>
      </>
    ),
  },
};
