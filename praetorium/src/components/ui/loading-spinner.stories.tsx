import type { Meta, StoryObj } from '@storybook/react';
import { LoadingSpinner } from './loading-spinner';

const meta: Meta<typeof LoadingSpinner> = {
  title: 'UI/LoadingSpinner',
  component: LoadingSpinner,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    color: { control: 'color' },
  },
};

export default meta;
type Story = StoryObj<typeof LoadingSpinner>;

export const Small: Story = {
  args: {
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
  },
};

export const CustomColor: Story = {
  args: {
    size: 'md',
    color: '#d4a54a',
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      <div className="flex flex-col items-center gap-2">
        <LoadingSpinner size="sm" />
        <span className="text-xs text-text-muted">sm</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <LoadingSpinner size="md" />
        <span className="text-xs text-text-muted">md</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <LoadingSpinner size="lg" />
        <span className="text-xs text-text-muted">lg</span>
      </div>
    </div>
  ),
};

export const OnDarkBackground: Story = {
  decorators: [
    (Story) => (
      <div className="bg-surface-base p-8 rounded-lg flex items-center justify-center">
        <Story />
      </div>
    ),
  ],
  args: {
    size: 'lg',
  },
};
