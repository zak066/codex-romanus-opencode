import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Toggle } from './toggle';

const meta: Meta<typeof Toggle> = {
  title: 'UI/Toggle',
  component: Toggle,
  tags: ['autodocs'],
  argTypes: {
    checked: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

export const Unchecked: Story = {
  args: {
    checked: false,
    label: 'Notifications',
    onChange: () => {},
  },
};

export const Checked: Story = {
  args: {
    checked: true,
    label: 'Dark Mode',
    onChange: () => {},
  },
};

export const Disabled: Story = {
  args: {
    checked: false,
    disabled: true,
    label: 'Disabled toggle',
    onChange: () => {},
  },
};

export const DisabledChecked: Story = {
  args: {
    checked: true,
    disabled: true,
    label: 'Disabled & active',
    onChange: () => {},
  },
};

export const WithoutLabel: Story = {
  args: {
    checked: false,
    onChange: () => {},
  },
};

export const Interactive: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [darkMode, setDarkMode] = useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [notifications, setNotifications] = useState(true);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [autoSave, setAutoSave] = useState(true);

    return (
      <div className="space-y-4 max-w-sm">
        <div className="bg-surface-raised border border-border-subtle rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">Settings</h3>
          <div className="space-y-3">
            <Toggle
              checked={darkMode}
              onChange={setDarkMode}
              label="Dark Mode"
            />
            <Toggle
              checked={notifications}
              onChange={setNotifications}
              label="Push Notifications"
            />
            <Toggle
              checked={autoSave}
              onChange={setAutoSave}
              label="Auto Save"
            />
          </div>
          <p className="text-xs text-text-muted pt-2 border-t border-border-subtle">
            Dark Mode: {darkMode ? 'ON' : 'OFF'} | Notifications: {notifications ? 'ON' : 'OFF'} | Auto Save: {autoSave ? 'ON' : 'OFF'}
          </p>
        </div>
      </div>
    );
  },
};
