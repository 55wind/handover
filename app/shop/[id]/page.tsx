'use client';

import { use, useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { cap, hours, stamp, usd } from '@/components/format';
import { CopyId, FAILED, api, errorOf } from '@/components/ui';
import { fromCents, localLabel, usdCents } from '@/lib/rules';
import { SHOPS, shopById } from '@/lib/shops';
import type { LedgerRow, MenuItem } from '@/lib/types';

type Query = Promise<{ [key: string]: string | string[] | undefined }>;

/** A dish with its two prices already written out by the server. */
type Dish = MenuItem & { usd: string; local: string };
interface Counter {
  menu: Dish[];
  served: LedgerRow[];
}

interface Served {
  toName: string;
  item: string;
  localName: string;
  charged: string;
  forShop: string;
  verified: boolean;
}

// The counter: the shopkeeper enters the code a customer shows, and PayPal pays the shop the price of the dish.
export default function ShopPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Query }) {
  const { id } = use(params);
  const given = use(searchParams).code;
  const shop = shopById(id);
  const base = `/api/shops/${encodeURIComponent(id)}`;

  const [code, setCode] = useState(typeof given === 'string' ? given.toUpperCase() : '');
  const [busy, setBusy] = useState(false);
  const [served, setServed] = useState<Served | null>(null);
  const [error, setError] = useState('');
  const [counter, setCounter] = useState<Counter | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const r = await api(base);
    const ok = r.status === 200 && Array.isArray(r.data?.served) && Array.isArray(r.data?.shop?.menu);
    setFailed(!ok);
    if (!ok) return;
    const next: Counter = { menu: r.data.shop.menu, served: r.data.served };
    // An unchanged answer keeps the old object, so the tables are not redrawn every five seconds.
    setCounter((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [base]);

  useEffect(() => {
    if (!shop) return;
    void refresh();
    const timer = setInterval(() => !document.hidden && void refresh(), 5000);
    return () => clearInterval(timer);
  }, [shop, refresh]);

  if (!shop) {
    return (
      <div className="container page">
        <header className="page-head">
          <h1>No shop has this address</h1>
          <p>These shops take part:</p>
        </header>
        <ul className="stack--tight">
          {SHOPS.map((s) => (
            <li key={s.id}>
              <Link href={`/shop/${s.id}`}>
                {s.name}, {s.city}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  async function serve(e: FormEvent) {
    e.preventDefault();
    const entered = code.trim().toUpperCase();
    if (!entered || busy) return;
    setBusy(true);
    setError('');
    setServed(null);
    const r = await api(`${base}/redeem`, { code: entered });
    if (r.status === 200 && r.data?.served) {
      setServed(r.data.served);
      setCode('');
    } else {
      // A code works once. If the answer was lost on the way, the list below says whether it went through.
      setError(errorOf(r, r.status === 0 ? 'The answer did not arrive. Look at “Served today” below before entering the code again.' : FAILED));
    }
    setBusy(false);
    void refresh();
  }

  // The prices are written out by the server. If it cannot be reached, the same figures are worked out here.
  const menu: Dish[] | null = counter?.menu ?? (failed ? shop.menu.map((m) => ({ ...m, usd: fromCents(usdCents(shop, m)), local: localLabel(shop, m) })) : null);
  const rows = counter?.served ?? null;

  return (
    <div className="container page counter">
      <header className="page-head">
        <h1 lang={shop.language}>{shop.localName}</h1>
        <p>
          {shop.localName !== shop.name ? `${shop.name}, ${shop.kind}` : cap(shop.kind)} in {shop.area}, {shop.city}. {shop.keeper} is at
          the counter. Open {hours(shop.hours)}.
        </p>
        <p className="small muted">This is the shop’s screen. The shop and {shop.keeper} are fictional.</p>
      </header>

      <section className="till" aria-labelledby="till-h">
        <div className="stack--tight">
          <h2 id="till-h">A customer shows a code</h2>
          <p>Enter it and serve the dish. PayPal takes the price of the dish from the sender’s hold and pays the shop. The customer pays nothing.</p>
        </div>
        <form className="till__form" onSubmit={serve}>
          <label className="field" htmlFor="till-code">
            <span>Code</span>
            <input
              id="till-code"
              className="till__code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={24}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              readOnly={busy}
            />
          </label>
          <button className="btn" type="submit" disabled={busy || !code.trim()} aria-busy={busy}>
            {busy ? 'Serving' : 'Serve this treat'}
          </button>
        </form>

        <div className="stack--tight" role="status">
          {busy && (
            <>
              <p>Checking the code with PayPal, taking the price and releasing the rest. This can take up to 20 seconds. Keep this page open.</p>
              <div className="progress" />
            </>
          )}
          {served && (
            <div className="statement">
              <div className="statement__mark">
                <b>Served</b>
                <span className={served.verified ? 'verified' : 'muted'}>{served.verified ? 'Confirmed with PayPal' : 'Not confirmed with PayPal'}</span>
              </div>
              <p className="statement__total num">PayPal paid {usd(served.charged)}</p>
              <dl className="lines">
                <div>
                  <dt>For</dt>
                  <dd>{served.toName}</dd>
                </div>
                <div>
                  <dt>Dish</dt>
                  <dd>
                    <span lang={shop.language}>{served.localName}</span>
                    {served.localName !== served.item && ` (${served.item})`}
                  </dd>
                </div>
              </dl>
              {served.forShop && <p>{served.forShop}</p>}
            </div>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="stack" aria-labelledby="menu-h">
        <h2 id="menu-h">Menu</h2>
        {!menu ? (
          <p className="muted" role="status">
            Loading the menu.
          </p>
        ) : (
          <table className="menu menu--full num">
            <thead>
              <tr>
                <th scope="col">Dish</th>
                <th scope="col">Price</th>
                <th scope="col">For the sender</th>
              </tr>
            </thead>
            <tbody>
              {menu.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    <span lang={shop.language}>{item.localName}</span>
                    {item.localName !== item.name && <span className="small muted">{item.name}</span>}
                  </th>
                  <td>{item.local}</td>
                  <td>{usd(item.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="stack counter__served" aria-labelledby="served-h">
        <h2 id="served-h">Served today</h2>
        <div role="status">
          {!rows && !failed && <p className="muted">Loading.</p>}
          {!rows && failed && <p className="error">The list could not be loaded. It is tried again every five seconds.</p>}
          {rows && rows.length === 0 && <p className="muted">Nothing yet. A treat appears here once its code has been entered.</p>}
        </div>
        {rows && rows.length > 0 && (
          <div className="scroll-x" tabIndex={0} role="region" aria-labelledby="served-h">
            <table className="plain num">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Dish</th>
                  <th scope="col">PayPal paid</th>
                  <th scope="col">Confirmed with PayPal</th>
                  <th scope="col">Payout to the shop</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.ref}>
                    <td>{stamp(row.ts)}</td>
                    <td>{row.item}</td>
                    <td>{usd(row.charged)}</td>
                    <td>{row.verified ? 'Yes' : 'Not yet'}</td>
                    <td>
                      {row.paypal.payoutId ? <CopyId value={row.paypal.payoutId} /> : <span className="muted">None yet</span>}
                      {row.paypal.payoutStatus && <span className="small muted"> {row.paypal.payoutStatus.toLowerCase()}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
