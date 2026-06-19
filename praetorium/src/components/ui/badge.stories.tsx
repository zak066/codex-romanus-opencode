import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'success', 'warning', 'error', 'info'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: {
    variant: 'default',
    children: 'Default Badge',
    size: 'md',
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    children: 'Operazione completata',
    size: 'md',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    children: 'Attenzione',
    size: 'md',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    children: 'Errore critico',
    size: 'md',
  },
};

export const Info: Story = {
  args: {
    variant: 'info',
    children: 'Informazione',
    size: 'md',
  },
};

export const Small: Story = {
  args: {
    variant: 'default',
    children: 'Small',
    size: 'sm',
  },
};

export const WithIcon: Story = {
  args: {
    variant: 'success',
    children: 'Verificato',
    size: 'md',
    icon: (
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="info">Info</Badge>
    </div>
  ),
};
