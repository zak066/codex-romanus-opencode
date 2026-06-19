'use client';

import { useState, useCallback } from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

export function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarPeek, setSidebarPeek] = useState(false);

  const sidebarVisible = sidebarOpen || sidebarPeek;

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
    setSidebarPeek(false);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    setSidebarPeek(false);
  }, []);

  const peekSidebar = useCallback(() => {
    if (!sidebarOpen) setSidebarPeek(true);
  }, [sidebarOpen]);

  const unpeekSidebar = useCallback(() => {
    setSidebarPeek(false);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base">
      <Sidebar
        visible={sidebarVisible}
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        onPeekEnd={unpeekSidebar}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onToggleSidebar={toggleSidebar}
          onPeekStart={peekSidebar}
          onPeekEnd={unpeekSidebar}
        />
        <main className="flex-1 overflow-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
