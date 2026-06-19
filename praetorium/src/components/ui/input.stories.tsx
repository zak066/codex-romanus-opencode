import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number'],
    },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    error: { control: 'text' },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    label: 'Username',
    placeholder: 'Enter your username',
  },
};

export const WithValue: Story = {
  args: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
    defaultValue: 'user@codex-romanus.dev',
  },
};

export const Password: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter your password',
  },
};

export const WithError: Story = {
  args: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
    defaultValue: 'invalid-email',
    error: 'Please enter a valid email address',
  },
};

export const Disabled: Story = {
  args: {
    label: 'Read-only field',
    placeholder: 'This field is disabled',
    disabled: true,
    defaultValue: 'Pre-filled value',
  },
};

export const WithPlaceholder: Story = {
  args: {
    placeholder: 'Search...',
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-sm">
      <Input label="Default" placeholder="Normal input" />
      <Input label="With Value" defaultValue="Some value" />
      <Input label="Password" type="password" placeholder="********" />
      <Input label="With Error" defaultValue="bad data" error="This field has an error" />
      <Input label="Disabled" disabled defaultValue="Cannot edit" />
    </div>
  ),
};
