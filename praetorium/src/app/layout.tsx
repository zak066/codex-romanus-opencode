import type { Metadata } from 'next';
import './globals.css';
import { PraetoriumProvider } from '@/lib/praetorium-context';
import { ThemeProvider } from '@/lib/theme-provider';
import { ToastProvider } from '@/hooks/use-toast';
import { Shell } from '@/components/layout/shell';

export const metadata: Metadata = {
  title: 'Praetorium — Codex Romanus',
  description: 'Piattaforma di comando unificata per il Codex Romanus',
};


export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body className="bg-surface-base text-text-primary min-h-screen antialiased">
        <ThemeProvider defaultTheme="dark">
          <PraetoriumProvider>
            <ToastProvider>
              <Shell>{children}</Shell>
            </ToastProvider>
          </PraetoriumProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
