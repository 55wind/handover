'use client';

import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { hrs, place } from '@/components/format';
import { Bar, FAILED, api } from '@/components/ui';
import { amountDue, countries, fromCents, priceFor, toCents } from '@/lib/pricing';
import { PRODUCTS, RULES, SELLER, productById } from '@/lib/seller';
import type { Price, Purchase, Quote } from '@/lib/types';

type Query = Promise<{ [key: string]: string | string[] | undefined }>;

const COUNTRIES = countries();
const GIFTS = [
  ['0.00', 'No gift'],
  ['2.00', '$2.00'],
  ['5.00', '$5.00'],
];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** One sentence on why this is the price, and one on the seller's limit when a limit decided it. */
function explain(p: Price, ref: Price): [string, string] {
  if (p.country === ref.country) return [`The list price was set for ${place(p.countryName)}, where it costs ${hrs(p.hoursAtList)} of average income.`, ''];
  if (p.fair === p.list)
    return [
      `In ${place(p.countryName)} the list price costs ${hrs(p.hoursAtList)} of average income. That is no more than it costs in ${place(ref.countryName)} (${hrs(ref.hoursAtList)}), so the price is the list price.`,
      'The seller never charges more than the list price.',
    ];
  return [
    `At the list price this would cost ${hrs(p.hoursAtList)} of average income in ${place(p.countryName)}. At $${p.fair} it costs ${p.hoursAtFair}, closer to what it costs a buyer in ${place(ref.countryName)} (${hrs(ref.hoursAtList)}).`,
    p.limitedBy === 'floor' ? `The seller never charges less than ${RULES.floorPercent}% of the list price, so $${p.fair} is as low as this price goes.` : '',
  ];
}

export default function BuyPage({ params, searchParams }: { params: Promise<{ product: string }>; searchParams: Query }) {
  const product = productById(use(params).product);
  const query = use(searchParams);
  const router = useRouter();

  const [country, setCountry] = useState(one(query.country).toUpperCase());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [resuming, setResuming] = useState(!!one(query.purchase));
  const [gift, setGift] = useState('0.00');
  const [busy, setBusy] = useState<'clerk' | 'gift' | 'pay' | null>(null);
  const [talking, setTalking] = useState(false);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState('');
  const [clerkError, setClerkError] = useState('');
  const [error, setError] = useState('');

  // A purchase named in the address is picked up again, so a reload keeps the conversation and any help.
  useEffect(() => {
    const id = one(query.purchase);
    if (!id) return;
    let live = true;
    api(`/api/purchases/${id}`).then((r) => {
      if (!live) return;
      const p: Purchase | null = r.status === 200 ? r.data : null;
      if (p && p.status !== 'open') return router.replace(`/purchase/${p.id}`);
      if (p && p.productId === product?.id) {
        setPurchase(p);
        setCountry(p.quote.price.country);
        setGift(p.gift);
        setTalking(p.messages.length > 0);
      }
      setResuming(false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const local = product && country ? priceFor(product, RULES, country) : null;
  const held = purchase?.quote.price.country === country ? purchase.quote : null;

  // The price on screen is worked out here at once; the quote the payment will use comes from the server.
  useEffect(() => {
    if (!product || !local || held || resuming) return;
    let live = true;
    setQuote(null);
    setQuoteError('');
    api('/api/quote', { productId: product.id, country }).then((r) => {
      if (!live) return;
      if (r.status === 200) setQuote(r.data);
      else setQuoteError(r.data?.error ?? 'The price could not be confirmed with the seller.');
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, country, !!local, !!held, resuming, attempt]);

  if (!product) {
    return (
      <div className="container page">
        <div className="page-head">
          <h1>There is no such product</h1>
          <p>{SELLER.shop} sells these.</p>
        </div>
        <ul className="index">
          {PRODUCTS.map((p) => (
            <li key={p.id}>
              <Link href={`/buy/${p.id}`}>
                <span className="index__name">{p.title}</span>
                <span>{p.blurb}</span>
                <span className="index__go">See the price</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const active = held ?? quote;
  const price = active?.price ?? local;
  const ref = priceFor(product, RULES, RULES.referenceCountry);
  const [why, limit] = price && ref ? explain(price, ref) : ['', ''];
  const due = purchase && held ? purchase.amount : price ? amountDue(price.fair, undefined, gift) : null;
  const address = (c: string, purchaseId?: string) => window.history.replaceState(null, '', `?country=${c}${purchaseId ? `&purchase=${purchaseId}` : ''}`);

  function changeCountry(next: string) {
    setCountry(next);
    setPurchase(null);
    setClerkError('');
    setError('');
    address(next);
  }

  /** The purchase is created the first time it is needed: by the first message to the clerk, or by paying. */
  async function ensurePurchase(report: (message: string) => void): Promise<Purchase | null> {
    if (purchase && held) return purchase;
    if (!quote) return null;
    const r = await api('/api/purchases', { quoteId: quote.id, language: navigator.language, gift });
    if (r.status === 201) {
      setPurchase(r.data);
      address(country, r.data.id);
      return r.data;
    }
    report(r.data?.error ?? FAILED);
    // A quote the server no longer holds (it expires, and a restart forgets it) is asked for again.
    if (r.status === 400) setAttempt((n) => n + 1);
    return null;
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setBusy('clerk');
    setClerkError('');
    setSent(text);
    setDraft('');
    const p = await ensurePurchase(setClerkError);
    const r = p ? await api(`/api/purchases/${p.id}/clerk`, { text }) : null;
    if (r?.status === 200) setPurchase(r.data);
    else {
      // The message was not delivered, so it goes back into the box to be sent again.
      setDraft(text);
      if (r) setClerkError(r.status === 409 ? 'The clerk is still answering. Wait a moment, then send it again.' : (r.data?.error ?? FAILED));
    }
    setSent('');
    setBusy(null);
  }

  async function chooseGift(next: string) {
    const before = gift;
    setGift(next);
    if (!purchase || !held) return;
    setBusy('gift');
    setError('');
    const r = await api(`/api/purchases/${purchase.id}/gift`, { gift: next });
    if (r.status === 200) setPurchase(r.data);
    else {
      setGift(before);
      setError(r.data?.error ?? FAILED);
    }
    setBusy(null);
  }

  async function pay() {
    setBusy('pay');
    setError('');
    const p = await ensurePurchase(setError);
    if (p) {
      const r = await api(`/api/purchases/${p.id}/checkout`, {});
      // The button stays busy while the browser leaves for PayPal.
      if (r.status === 200 && r.data?.approveUrl) return window.location.assign(r.data.approveUrl);
      setError(r.data?.error ?? FAILED);
    }
    setBusy(null);
  }

  const messages = held ? (purchase?.messages ?? []) : [];
  const help = held ? purchase?.help : undefined;

  return (
    <div className="container page buy">
      <header className="page-head">
        <p className="muted">
          {SELLER.shop}, {SELLER.place}
        </p>
        <h1>{product.title}</h1>
        <p>{product.blurb}</p>
      </header>

      <div className="stack">
        <label className="field">
          <span>Country your PayPal wallet is registered in</span>
          <select value={local ? country : ''} onChange={(e) => changeCountry(e.target.value)} disabled={busy !== null}>
            <option value="" disabled>
              Choose a country
            </option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="help">The price is for this country. PayPal confirms it when you pay.</span>
        </label>

        {country && !local && (
          <p className="well" role="status">
            There is no income figure for “{country}”, so a fair price cannot be worked out for it. Choose a country from the list.
          </p>
        )}
        {!country && (
          <p className="well">
            The list price is ${product.listPrice}. Choose a country to see what that costs there in hours of average income, and the
            fair price.
          </p>
        )}

        {price && (
          <section className="quote" aria-label={`Price for ${price.countryName}`}>
            <dl className="figures">
              <div>
                <dt>Fair price for {place(price.countryName)}</dt>
                <dd className="num">${price.fair}</dd>
                <dd>{hrs(price.hoursAtFair)} of average income</dd>
              </div>
              <div className="is-list">
                <dt>List price</dt>
                <dd className="num">${price.list}</dd>
                <dd>{hrs(price.hoursAtList)} of average income</dd>
              </div>
            </dl>
            <Bar list={price.hoursAtList} fair={price.hoursAtFair} max={price.hoursAtList} />
            <div className="stack--tight" role="status">
              <p>{why}</p>
              {limit && <p className="muted">{limit}</p>}
            </div>
            <p className="small muted">
              Average income per person in {place(price.countryName)} is ${price.incomePerHour} an hour (World Bank, {price.year}). It is
              an average, not a wage.
            </p>
          </section>
        )}

        {price && (
          <details className="clerk" open={talking} onToggle={(e) => setTalking(e.currentTarget.open)}>
            <summary>Talk to the clerk</summary>
            <div>
              <p className="small muted">
                Ask about the price in any language. If your circumstances do not match your wallet’s country, say so. The clerk
                is an AI agent and can take a little off, paid from a pool other buyers have put money into.
              </p>
              {(messages.length > 0 || sent) && (
                <ol className="chat" aria-live="polite">
                  {messages.map((m, i) => (
                    <li key={i}>
                      <span>{m.from === 'buyer' ? 'You' : 'Clerk'}</span>
                      <p>{m.text}</p>
                    </li>
                  ))}
                  {sent && (
                    <li className="is-pending">
                      <span>You</span>
                      <p>{sent}</p>
                    </li>
                  )}
                </ol>
              )}
              {busy === 'clerk' && (
                <div className="stack--tight">
                  <p className="small" role="status">
                    The clerk is answering.
                  </p>
                  <div className="progress" />
                </div>
              )}
              {help && purchase && (
                <p className="well" role="status">
                  The clerk took ${help.amount} off, paid from the pool. You now pay ${purchase.amount}.
                  <br />
                  <span className="small muted">Reason on the seller’s ledger: {help.reason}</span>
                </p>
              )}
              <form onSubmit={send}>
                <label className="field">
                  <span>Your message</span>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} disabled={busy !== null} />
                </label>
                <button className="btn btn--quiet" type="submit" disabled={busy !== null || !draft.trim() || !active}>
                  Send to the clerk
                </button>
                {clerkError && (
                  <p className="error" role="alert">
                    {clerkError}
                  </p>
                )}
              </form>
            </div>
          </details>
        )}
      </div>

      {price && due && (
        <aside className="pay" aria-label="Payment">
          <fieldset disabled={busy !== null}>
            <legend>Cover an hour for someone (optional)</legend>
            <div className="choices">
              {GIFTS.map(([value, label]) => (
                <label key={value}>
                  <input type="radio" name="gift" value={value} checked={gift === value} onChange={() => chooseGift(value)} />
                  {label}
                </label>
              ))}
            </div>
            <p className="help">
              A gift goes into a pool. The clerk can use it to lower the price for a buyer whose circumstances do not match their
              wallet’s country.
            </p>
          </fieldset>

          <dl className="sum num" aria-live="polite">
            <div>
              <dt>Fair price for {place(price.countryName)}</dt>
              <dd>${price.fair}</dd>
            </div>
            {help && (
              <div>
                <dt>Help from the pool</dt>
                <dd>-${help.amount}</dd>
              </div>
            )}
            {toCents(gift) > 0 && (
              <div>
                <dt>Your gift to the pool</dt>
                <dd>+${fromCents(toCents(gift))}</dd>
              </div>
            )}
            <div>
              <dt>To pay now</dt>
              <dd>${due}</dd>
            </div>
          </dl>

          <div className="stack--tight">
            <button className="btn btn--wide" type="button" onClick={pay} disabled={busy !== null || !active} aria-busy={busy === 'pay'}>
              {busy === 'pay' ? 'Going to PayPal' : 'Pay with PayPal'}
            </button>
            <p className="small muted">
              Your payment is only held until PayPal confirms the wallet’s country. If it does not match, nothing is taken.
            </p>
          </div>
          <div role="alert">
            {error && <p className="error">{error}</p>}
            {quoteError && (
              <p className="error">
                {quoteError}{' '}
                <button className="link" type="button" onClick={() => setAttempt((n) => n + 1)}>
                  Ask for the price again
                </button>
              </p>
            )}
          </div>
          {!active && !quoteError && (
            <p className="small muted" role="status">
              Confirming the price with the seller.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
