'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity } from '@/components/Activity';
import { hrs, place, stamp } from '@/components/format';
import { CopyId, FAILED, api } from '@/components/ui';
import { countries, fromCents, hoursFor, toCents } from '@/lib/pricing';
import { SELLER, productById } from '@/lib/seller';
import type { Purchase } from '@/lib/types';

type Query = Promise<{ [key: string]: string | string[] | undefined }>;

const NAMES = new Map(countries().map((c) => [c.code, c.name]));
/** PayPal's country code as a name. A code the table does not have is shown as PayPal sent it. */
const nameOf = (code: string) => NAMES.get(code) ?? code;
/** The agent's message often opens with the very words of the heading above it. They are not said twice. */
const after = (head: string, text: string) => (text.startsWith(`${head}. `) ? text.slice(head.length + 2) : text);

function Ids({ p }: { p: Purchase }) {
  const ids = [
    ['PayPal order', p.paypal.orderId],
    ['Authorisation', p.paypal.authorizationId],
    ['Capture', p.paypal.captureId],
    ['Refund', p.paypal.refundId],
  ];
  return ids.map(
    ([label, id]) =>
      id && (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <CopyId value={id} />
          </dd>
        </div>
      ),
  );
}

export default function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Query }) {
  const { id } = use(params);
  const cancelled = use(searchParams).cancelled !== undefined;
  const base = `/api/purchases/${id}`;
  const [p, setPurchase] = useState<Purchase | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'gone' | 'failed'>('loading');
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    let stream: EventSource | undefined;

    async function fetchPurchase() {
      const r = await api(base);
      if (!live) return false;
      if (r.status === 200) setPurchase(r.data);
      setLoad(r.status === 200 ? 'ready' : r.status === 404 ? 'gone' : 'failed');
      return r.status === 200;
    }

    fetchPurchase().then((ok) => {
      if (!ok || !live) return;
      stream = new EventSource(`${base}/events`);
      stream.onmessage = (m) => setPurchase(JSON.parse(m.data).purchase);
      // Settlement starts a moment after PayPal sends the buyer back, so anything written between the first
      // read and the stream opening is read once more here.
      stream.onopen = () => void fetchPurchase();
      // The browser reconnects by itself after a dropped connection. It gives up only when the server
      // answers with an error, which is what happens once a restart has cleared the purchase.
      stream.onerror = () => {
        if (stream?.readyState === EventSource.CLOSED) fetchPurchase();
      };
    });

    return () => {
      live = false;
      stream?.close();
    };
  }, [base]);

  if (!p) {
    return (
      <div className="container page">
        <div className="page-head" role="status">
          {load === 'loading' && <p className="muted">Loading the purchase.</p>}
          {load === 'failed' && <p className="error">The purchase could not be loaded. Reload the page to try again.</p>}
          {load === 'gone' && (
            <>
              <h1>This purchase is no longer available</h1>
              <p>Purchases in this demo are kept in memory and are cleared when the server restarts.</p>
              <p>
                <Link href="/">Back to the start</Link>
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const product = productById(p.productId);
  const title = product?.title ?? p.productId;
  const price = p.quote.price;
  const wallet = p.paypal.walletCountry;
  const offer = p.outcome?.offer;
  const own = toCents(p.amount) - toCents(p.gift); // what the product itself cost this buyer, in cents
  const again = `/buy/${p.productId}?country=${price.country}`;
  const waiting = p.status === 'approving' || p.status === 'settling';
  const stopped = cancelled && (p.status === 'approving' || p.status === 'open');
  const done = p.status === 'captured' || p.status === 'refunded' || p.status === 'voided';

  const working = !p.running
    ? ''
    : p.status === 'settling'
      ? 'The agent is asking PayPal which country the wallet is registered in.'
      : p.status === 'captured' || p.status === 'voided'
        ? 'Reading the result back from PayPal.'
        : 'Working.';

  async function buyOffer() {
    if (!offer) return;
    setBuying(true);
    setError('');
    const made = await api('/api/purchases', { quoteId: offer.id, language: p!.buyer.language });
    const r = made.status === 201 ? await api(`/api/purchases/${made.data.id}/checkout`, {}) : made;
    // The button stays busy while the browser leaves for PayPal.
    if (r.status === 200 && r.data?.approveUrl) return window.location.assign(r.data.approveUrl);
    setError(r.data?.error ?? FAILED);
    setBuying(false);
  }

  return (
    <div className={`container page${done ? ' result' : ''}`}>
      {stopped && (
        <header className="page-head">
          <h1>You cancelled at PayPal. Nothing was taken.</h1>
          <p>
            The price for {place(price.countryName)} is still ${price.fair} for “{title}”.
          </p>
          <div className="actions">
            <Link className="btn" href={again}>
              Back to {title}
            </Link>
            {p.paypal.approveUrl && (
              <a className="btn btn--quiet" href={p.paypal.approveUrl}>
                Return to PayPal
              </a>
            )}
          </div>
        </header>
      )}

      {!stopped && p.status === 'open' && (
        <header className="page-head">
          <h1>This purchase has not been paid for</h1>
          <p>
            “{title}” at ${p.amount}, the price for {place(price.countryName)}.
          </p>
          <div className="actions">
            <Link className="btn" href={`${again}&purchase=${p.id}`}>
              Continue to payment
            </Link>
          </div>
        </header>
      )}

      {!stopped && waiting && (
        <header className="page-head" role="status">
          <h1>{p.status === 'approving' ? 'Waiting for PayPal' : 'Checking the wallet’s country'}</h1>
          <p>
            {p.status === 'approving'
              ? 'PayPal has not told us yet that you approved the payment. Nothing has been taken.'
              : `Your payment of $${p.amount} is only held. It is taken if PayPal reports a wallet registered in ${place(price.countryName)}, and released if not.`}
          </p>
          {p.status === 'approving' && p.paypal.approveUrl && (
            <p>
              <a href={p.paypal.approveUrl}>Continue at PayPal</a>
            </p>
          )}
        </header>
      )}

      {(p.status === 'captured' || p.status === 'refunded') && (
        <>
          <header className="page-head no-print">
            <h1>{p.status === 'refunded' ? 'This payment was refunded' : 'Paid'}</h1>
            {p.outcome?.text && p.status === 'captured' && <p role="status">{after('Paid', p.outcome.text)}</p>}
            {p.status === 'refunded' && (
              <p>
                The seller sent ${p.amount} back to the wallet that paid.
                {p.paypal.refundId && (
                  <>
                    {' '}
                    Refund <CopyId value={p.paypal.refundId} />
                  </>
                )}
              </p>
            )}
          </header>

          <article className="statement" aria-label="Receipt">
            <p className="statement__mark">
              <b>{SELLER.shop}</b>
              <span className="muted">{p.status === 'refunded' ? 'Receipt, refunded' : 'Receipt'}</span>
            </p>
            <div className="stack--tight">
              <h2>{title}</h2>
              {product && <p className="muted">{product.blurb}</p>}
            </div>
            <div className="stack--tight">
              <p className="statement__total num">${p.amount}</p>
              <p>
                {toCents(p.gift) > 0 && `Without your gift that is $${fromCents(own)}: `}
                {hrs(hoursFor(own, price.country) ?? price.hoursAtFair)} of average income in {place(price.countryName)}.
                {own < toCents(price.list) && ` At the list price of $${price.list} it would have been ${price.hoursAtList}.`}
              </p>
            </div>
            <dl className="lines">
              <div>
                <dt>Fair price for {place(price.countryName)}</dt>
                <dd className="num">${price.fair}</dd>
              </div>
              {p.help && (
                <div>
                  <dt>Help from the pool</dt>
                  <dd>
                    <span className="num">-${p.help.amount}</span>
                    <br />
                    <span className="small muted">{p.help.reason}</span>
                  </dd>
                </div>
              )}
              {toCents(p.gift) > 0 && (
                <div>
                  <dt>Your gift to the pool</dt>
                  <dd className="num">+${p.gift}</dd>
                </div>
              )}
              <div>
                <dt>Wallet country, as PayPal reported it</dt>
                <dd>{wallet ? nameOf(wallet) : 'Not reported'}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{stamp(p.createdAt)}</dd>
              </div>
              <Ids p={p} />
            </dl>
            <p className="verified" role="status">
              {p.outcome?.verified ? 'Confirmed with PayPal.' : p.running ? 'Reading the capture back from PayPal.' : p.outcome ? 'PayPal has not confirmed this capture.' : ''}
            </p>
            <p className="small muted">
              Paid on the PayPal sandbox. No real money moved. Hours are hours of average income per person (World Bank, {price.year}),
              not wages.
            </p>
          </article>

          <div className="actions no-print">
            <button className="btn btn--quiet" type="button" onClick={() => window.print()}>
              Print this receipt
            </button>
            <Link href="/seller">See this sale in the seller’s ledger</Link>
          </div>
        </>
      )}

      {p.status === 'voided' && (
        <>
          <header className="page-head">
            <h1>Nothing was taken</h1>
            {p.outcome?.text && <p role="status">{after('Nothing was taken', p.outcome.text)}</p>}
          </header>

          <section className="statement" aria-label="What happened">
            <dl className="lines">
              <div>
                <dt>Wallet country, as PayPal reported it</dt>
                <dd>{wallet ? nameOf(wallet) : 'PayPal did not report one'}</dd>
              </div>
              <div>
                <dt>The price was quoted for</dt>
                <dd>
                  {price.countryName}, ${price.fair}
                </dd>
              </div>
              <div>
                <dt>Your money</dt>
                <dd>{p.paypal.authorizationId ? 'The hold was released. Nothing was taken.' : 'No hold was placed. Nothing was taken.'}</dd>
              </div>
              <Ids p={p} />
            </dl>

            {offer ? (
              <div className="stack">
                <div className="stack--tight">
                  <h2>The price for {place(offer.price.countryName)}</h2>
                  <p className="statement__total num">${offer.price.fair}</p>
                  <p>
                    {hrs(offer.price.hoursAtFair)} of average income in {place(offer.price.countryName)}. The list price is $
                    {offer.price.list}.
                  </p>
                </div>
                <div className="actions">
                  <button className="btn" type="button" onClick={buyOffer} disabled={buying} aria-busy={buying}>
                    {buying ? 'Going to PayPal' : 'Buy at this price'}
                  </button>
                  <Link href={`/buy/${p.productId}?country=${offer.price.country}`}>See how this price is worked out</Link>
                </div>
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <p>
                <Link href={again}>Back to {title}</Link>
              </p>
            )}
          </section>

          <p className="no-print">
            <Link href="/seller">See this released payment in the seller’s ledger</Link>
          </p>
        </>
      )}

      {p.events.length > 0 && <Activity events={p.events} working={working} />}
    </div>
  );
}
