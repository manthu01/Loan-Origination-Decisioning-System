'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Queue' },
  { href: '/policy', label: 'Policy' },
  { href: '/dashboard', label: 'Dashboard' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <span className="text-sm font-bold tracking-tight">CreditFlow · credit-ops</span>
        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
