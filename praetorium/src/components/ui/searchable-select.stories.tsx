import type { Meta, StoryObj } from '@storybook/react';
import { SearchableSelect } from './searchable-select';

const sampleOptions = [
  { value: 'option-1', label: 'Option 1 — Lorem ipsum' },
  { value: 'option-2', label: 'Option 2 — Dolor sit amet' },
  { value: 'option-3', label: 'Option 3 — Consectetur adipiscing' },
  { value: 'option-4', label: 'Option 4 — Sed do eiusmod' },
  { value: 'option-5', label: 'Option 5 — Tempor incididunt' },
  { value: 'option-6', label: 'Option 6 — Ut labore et dolore' },
  { value: 'option-7', label: 'Option 7 — Magna aliqua' },
  { value: 'option-8', label: 'Option 8 — Ut enim ad minim' },
];

const meta: Meta<typeof SearchableSelect> = {
  title: 'UI/SearchableSelect',
  component: SearchableSelect,
  tags: ['autodocs'],
  argTypes: {
    placeholder: { control: 'text' },
    searchPlaceholder: { control: 'text' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof SearchableSelect>;

export const Default: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Seleziona un\'opzione...',
    searchPlaceholder: 'Cerca opzione...',
  },
};

export const WithPreselectedValue: Story = {
  args: {
    options: sampleOptions,
    value: 'option-2',
    placeholder: 'Seleziona...',
    searchPlaceholder: 'Cerca...',
  },
};

export const LongList: Story = {
  args: {
    options: Array.from({ length: 25 }, (_, i) => ({
      value: `opt-${i + 1}`,
      label: `Elemento ${i + 1} — opzione lunga con descrizione per testare lo scroll`,
    })),
    placeholder: 'Seleziona da lista lunga...',
    searchPlaceholder: 'Filtra elementi...',
  },
};

export const Disabled: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Selezione disabilitata',
    searchPlaceholder: 'Cerca...',
    disabled: true,
  },
};

export const EmptyResults: Story = {
  args: {
    options: [],
    placeholder: 'Nessuna opzione disponibile',
    searchPlaceholder: 'Cerca...',
  },
};
