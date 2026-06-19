import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './select';

const sampleOptions = [
  { value: 'option-1', label: 'Option 1' },
  { value: 'option-2', label: 'Option 2' },
  { value: 'option-3', label: 'Option 3' },
  { value: 'option-4', label: 'Option 4' },
];

const meta: Meta<typeof Select> = {
  title: 'UI/Select',
  component: Select,
  tags: ['autodocs'],
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
    error: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Seleziona un\'opzione...',
    label: 'Scegli opzione',
  },
};

export const WithSelection: Story = {
  args: {
    options: sampleOptions,
    value: 'option-2',
    label: 'Opzione selezionata',
  },
};

export const Disabled: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Selezione disabilitata',
    label: 'Select disabilitato',
    disabled: true,
  },
};

export const WithPlaceholder: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Scegli...',
  },
};

export const WithError: Story = {
  args: {
    options: sampleOptions,
    label: 'Categoria',
    error: 'Seleziona una categoria valida',
  },
};

export const ManyOptions: Story = {
  args: {
    options: Array.from({ length: 12 }, (_, i) => ({
      value: `opt-${i + 1}`,
      label: `Option ${i + 1}`,
    })),
    label: 'Lunga lista',
    placeholder: 'Cerca tra molte opzioni...',
  },
};

export const NoLabel: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Seleziona senza label...',
  },
};
