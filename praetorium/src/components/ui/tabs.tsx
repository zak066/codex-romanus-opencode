'use client';

import React, { useState, useCallback, useId } from 'react';

interface Tab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  defaultTab?: string;
  onChange?: (tabId: string) => void;
  className?: string;
}

function Tabs({ tabs, defaultTab, onChange, className = '' }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || tabs[0]?.id || '');
  const id = useId();

  const handleTabClick = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      onChange?.(tabId);
    },
    [onChange],
  );

  const activeContent = tabs.find((tab) => tab.id === activeTab)?.content;

  if (tabs.length === 0) return null;

  return (
    <div className={className}>
      <div
        className="flex overflow-x-auto whitespace-nowrap [&::-webkit-scrollbar]:hidden border-b border-border-subtle"
        role="tablist"
        aria-orientation="horizontal"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const tabId = `${id}-tab-${tab.id}`;
          const panelId = `${id}-panel-${tab.id}`;

          return (
            <button
              key={tab.id}
              id={tabId}
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => {
                let targetIndex: number | null = null;

                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  targetIndex = (tabs.findIndex((t) => t.id === activeTab) + 1) % tabs.length;
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  targetIndex =
                    (tabs.findIndex((t) => t.id === activeTab) - 1 + tabs.length) % tabs.length;
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  targetIndex = 0;
                } else if (e.key === 'End') {
                  e.preventDefault();
                  targetIndex = tabs.length - 1;
                }

                if (targetIndex !== null) {
                  const targetTab = tabs[targetIndex];
                  setActiveTab(targetTab.id);
                  onChange?.(targetTab.id);
                  document.getElementById(`${id}-tab-${targetTab.id}`)?.focus();
                }
              }}
              className={`px-4 py-2.5 text-sm font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-roman-gold/50 ${
                isActive
                  ? 'text-roman-gold border-b-2 border-roman-gold'
                  : 'text-text-muted hover:text-text-secondary border-b-2 border-transparent hover:border-border-default'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        id={`${id}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${activeTab}`}
        className="pt-4"
      >
        {activeContent}
      </div>
    </div>
  );
}

export { Tabs };
export type { TabsProps, Tab };
