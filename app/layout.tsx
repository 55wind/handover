import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, Libre_Franklin } from 'next/font/google';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { PLATFORM, isFake, isScripted } from '@/lib/shops';
import './globals.css';

// Fraunces over Franklin: a serif with enough weight in its thin strokes to stay readable on a screen and in a recording.
// Plex Mono is kept for codes and PayPal ids alone.
const display = Fraunces({ subsets: ['latin', 'latin-ext'], axes: ['opsz'], variable: '--font-serif', display: 'swap' });
const body = Libre_Franklin({ subsets: ['latin', 'latin-ext'], variable: '--font-franklin', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: '400', variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: PLATFORM.name,
  description: 'Tell an agent who you miss. It buys them a meal at the shop next door, and you pay only when they eat. A demo on the PayPal sandbox.',
};

// The development banner depends on the server's environment at request time, never on what was true at build.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const standIns = [isFake() && 'no PayPal', isScripted() && 'scripted model'].filter(Boolean);
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {standIns.length > 0 && <p className="dev-banner">Development stand-ins: {standIns.join(', ')}. Nothing here is real.</p>}
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-head">
          <div className="container">
            <Link className="wordmark" href="/" aria-label={`${PLATFORM.name} Home`}>
              {PLATFORM.name}
            </Link>
            <SiteNav />
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-foot">
          <div className="container">
            <p>Runs on the PayPal sandbox. No real money moves. The shops and the people shown here are fictional.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
