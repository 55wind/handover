import Link from 'next/link';
import { Ledger } from '@/components/Ledger';
import { MERCHANTS, SLUGS } from '@/lib/merchants';
import type { MerchantSlug } from '@/lib/types';

export default async function MerchantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  if (!SLUGS.includes(slug as MerchantSlug)) {
    return (
      <div className="container page">
        <div className="page-head">
          <h1>No merchant by that name</h1>
          <p>The demo has three merchants. Each has a console.</p>
        </div>
        <ul className="index">
          {SLUGS.map((s) => (
            <li key={s}>
              <Link href={`/merchant/${s}`}>
                <span className="index__name">{MERCHANTS[s].name}</span>
                <span>{MERCHANTS[s].blurb}</span>
                <span className="index__go">Open the console</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const m = MERCHANTS[slug as MerchantSlug];
  return (
    <div className="container page">
      <header className="page-head">
        <h1>{m.name}</h1>
        <p className="muted">{m.blurb}. This is what the merchant sees.</p>
      </header>

      <section className="policy" aria-labelledby="policy-h">
        <div className="stack--tight">
          <h2 id="policy-h">Policy when a customer dies</h2>
          <p>{m.policy.summary}</p>
        </div>
        <ul>
          <li>
            {m.policy.prorataCurrentPeriod
              ? 'Refunds the unused days of a period already under way.'
              : 'Does not refund a period already under way.'}
          </li>
          <li>
            {m.policy.waiveUndeliveredInvoices
              ? 'Waives invoices for services that were not delivered.'
              : 'Does not waive open invoices.'}
          </li>
          <li>
            {m.policy.allowTakeOver
              ? 'A family member may take the account over.'
              : 'Accounts are personal and cannot be taken over.'}
          </li>
        </ul>
      </section>

      <Ledger slug={m.slug} />
    </div>
  );
}
