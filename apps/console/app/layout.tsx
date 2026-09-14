import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'CreditFlow · credit-ops',
  description: 'Queue, case review, policy editor, and dashboard for the CreditFlow decisioning platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
