import type { Meta, StoryObj } from '@storybook/react';
import { useCallback } from 'react';
import { Tabs } from './tabs';
import { Badge } from './badge';

const sampleTabs = [
  {
    id: 'overview',
    label: 'Overview',
    content: (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-text-primary">Overview</h3>
        <p className="text-text-secondary">This is the overview tab content. Here you can see a summary of the main information.</p>
        <div className="grid grid-cols-3 gap-3">
          {['Users', 'Revenue', 'Orders'].map((stat) => (
            <div key={stat} className="bg-surface-base rounded-md p-3 text-center">
              <p className="text-2xl font-bold text-roman-gold">—</p>
              <p className="text-xs text-text-muted mt-1">{stat}</p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'details',
    label: 'Details',
    content: (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-text-primary">Details</h3>
        <p className="text-text-secondary">Detailed information about the selected item goes here.</p>
        <ul className="space-y-2">
          {['Created: 2026-01-15', 'Status: Active', 'Priority: High'].map((detail) => (
            <li key={detail} className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-roman-gold" />
              {detail}
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    content: (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-text-primary">Settings</h3>
        <p className="text-text-secondary">Configure your preferences here.</p>
        <div className="space-y-2">
          {['Notifications', 'Privacy', 'Security'].map((setting) => (
            <label key={setting} className="flex items-center gap-3 p-2 rounded-md bg-surface-base cursor-pointer">
              <input type="checkbox" className="accent-roman-gold" defaultChecked={setting === 'Notifications'} />
              <span className="text-sm text-text-primary">{setting}</span>
            </label>
          ))}
        </div>
      </div>
    ),
  },
];

const meta: Meta<typeof Tabs> = {
  title: 'UI/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  argTypes: {
    defaultTab: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

export const Default: Story = {
  args: {
    tabs: sampleTabs,
  },
};

export const WithCustomDefault: Story = {
  args: {
    tabs: sampleTabs,
    defaultTab: 'settings',
  },
};

export const TwoTabs: Story = {
  args: {
    tabs: sampleTabs.slice(0, 2),
  },
};

export const WithBadges: Story = {
  args: {
    tabs: [
      {
        id: 'all',
        label: 'All',
        content: <p className="text-text-secondary">All items displayed here.</p>,
      },
      {
        id: 'active',
        label: 'Active',
        content: <p className="text-text-secondary">Active items displayed here.</p>,
      },
      {
        id: 'archived',
        label: 'Archived',
        content: <p className="text-text-secondary">Archived items displayed here.</p>,
      },
    ],
  },
  render: (args) => (
    <Tabs
      {...args}
      tabs={args.tabs.map((tab) => ({
        ...tab,
        label: tab.label,
      }))}
    />
  ),
};

export const Interactive: Story = {
  render: () => {
    const handleChange = useCallback((tabId: string) => {
      console.log('Tab changed:', tabId);
    }, []);

    return (
      <div className="space-y-4">
        <Tabs tabs={sampleTabs} onChange={handleChange} />
        <p className="text-xs text-text-muted">Check the browser console to see tab change events.</p>
      </div>
    );
  },
};
