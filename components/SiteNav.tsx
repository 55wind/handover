'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/send', 'Send a treat'],
  ['/ledger', 'Ledger'],
] as const;

/** The two places a visitor can go. The recipient's page has none: it is a card from a person, not a site to browse. */
export function SiteNav() {
  const path = usePathname() ?? '';
  if (path.startsWith('/t/')) return null;
  return (
    <nav className="site-nav" aria-label="Main">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
