import type { Metadata } from 'next';
import { Bodoni_Moda, IBM_Plex_Mono, Libre_Franklin } from 'next/font/google';
import Link from 'next/link';
import { isFake, isScripted } from '@/lib/seller';
import './globals.css';

// Bodoni over Franklin is the old print pairing for price lists and receipts. Plex Mono is kept for PayPal ids alone.
const display = Bodoni_Moda({ subsets: ['latin'], axes: ['opsz'], variable: '--font-bodoni', display: 'swap' });
const body = Libre_Franklin({ subsets: ['latin'], variable: '--font-franklin', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: '400', variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Fair Hour',
  description: 'Priced in hours, not dollars. Proven by the wallet, not the IP address. A demo on the PayPal sandbox.',
};

// The development banner depends on the server's environment at request time, never on what was true at build.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const standIns = [isFake() && 'fake PayPal', isScripted() && 'scripted model'].filter(Boolean);
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {standIns.length > 0 && (
          <p className="dev-banner">DEVELOPMENT MODE: {standIns.join(' and ')}. Nothing here is real.</p>
        )}
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="site-head">
          <div className="container">
            <Link className="wordmark" href="/" aria-label="Fair Hour, home">
              Fair Hour
            </Link>
            <span className="site-head__marker">PayPal sandbox demo</span>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="site-foot">
          <div className="container">
            Runs on the PayPal sandbox. The seller and buyers shown here are fictional. No real money moves.
          </div>
        </footer>
      </body>
    </html>
  );
}
