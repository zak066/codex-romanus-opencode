import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Modal } from './modal';
import { Button } from './button';

const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  tags: ['autodocs'],
  argTypes: {
    isOpen: { control: 'boolean' },
    title: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Modal>;

export const Closed: Story = {
  args: {
    isOpen: false,
    title: 'Modal Title',
    children: <p className="text-text-secondary">This modal content is not visible because isOpen is false.</p>,
  },
};

export const OpenWithContent: Story = {
  args: {
    isOpen: true,
    title: 'Information',
    children: (
      <div className="space-y-3">
        <p className="text-text-secondary">
          This is a modal dialog. Click outside or press Escape to close.
        </p>
        <div className="bg-surface-base rounded-md p-3">
          <p className="text-sm text-text-muted">Modal content area with additional details.</p>
        </div>
      </div>
    ),
  },
};

export const WithoutTitle: Story = {
  args: {
    isOpen: true,
    children: (
      <p className="text-text-secondary">A modal without a title — useful for confirmations or simple dialogs.</p>
    ),
  },
};

export const WithLongContent: Story = {
  args: {
    isOpen: true,
    title: 'Terms and Conditions',
    children: (
      <div className="space-y-4 max-h-60 overflow-y-auto">
        {Array.from({ length: 6 }, (_, i) => (
          <p key={i} className="text-sm text-text-secondary">
            Section {i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.
            Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
            Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
          </p>
        ))}
      </div>
    ),
  },
};

export const Interactive: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Open Modal
        </Button>
        <Modal isOpen={open} onClose={() => setOpen(false)} title="Interactive Modal">
          <div className="space-y-4">
            <p className="text-text-secondary">
              This modal is controlled by React state. Click outside, press Escape, or
              click the close button to dismiss it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Confirm
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  },
};
