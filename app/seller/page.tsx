'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { place, stamp } from '@/components/format';
import { gridDefaults, gridTheme } from '@/components/grid';
import { CopyId, DIAL, FAILED, Slider, api } from '@/components/ui';
import { countries, fromCents, toCents, worldTable } from '@/lib/pricing';
import { PRODUCTS, RULES, SELLER } from '@/lib/seller';
import type { Sale } from '@/lib/shop';
import type { Pool, Price, Product, Rules } from '@/lib/types';

interface Desk {
  seller: typeof SELLER;
  products: Product[];
  rules: Rules;
  pool: Pool;
  sales: Sale[];
}

const NAMES = new Map(countries().map((c) => [c.code, c.name]));
const usd = (v: string) => `$${v}`;
const one = (h: number) => h.toFixed(1);

// ---- the world table ----

const LIMIT = { floor: 'Floor', list: 'List price' };
const WORLD: ColDef<Price>[] = [
  { headerName: 'Country', field: 'countryName', width: 210, pinned: 'left' },
  { headerName: 'Income per hour', field: 'incomePerHour', width: 150, type: 'rightAligned', valueFormatter: (p) => usd(p.value), comparator: (a, b) => a - b },
  { headerName: 'Hours at list price', field: 'hoursAtList', width: 164, type: 'rightAligned', valueFormatter: (p) => one(p.value) },
  { headerName: 'Fair price', field: 'fair', width: 116, type: 'rightAligned', valueFormatter: (p) => usd(p.value), comparator: (a, b) => a - b },
  { headerName: 'Hours at fair price', field: 'hoursAtFair', width: 164, type: 'rightAligned', valueFormatter: (p) => one(p.value) },
  { headerName: 'Limit applied', field: 'limitedBy', flex: 1, minWidth: 136, valueFormatter: (p) => (p.value ? LIMIT[p.value as 'floor' | 'list'] : '') },
];
const worldDefaults = { ...gridDefaults.defaultColDef, sortable: true };

// ---- the sales ledger ----

interface Refunds {
  pending: string;
  errors: Record<string, string>;
  refund: (id: string) => void;
}
const Ctx = createContext<Refunds>({ pending: '', errors: {}, refund: () => {} });

function status(s: Sale): string {
  if (s.status === 'captured') return 'Captured';
  if (s.status === 'refunded') return 'Refunded';
  if (s.status !== 'voided') return s.status === 'settling' ? 'Waiting: checking the wallet' : 'Waiting for the buyer at PayPal';
  return s.walletCountry && s.walletCountry !== s.quotedCountry ? 'Released: wallet in another country' : 'Released';
}

type Cell = (p: { data?: Sale }) => React.ReactNode;

const ProductCell: Cell = ({ data: s }) =>
  s && (
    <div className="cell">
      <span>{s.productTitle}</span>
      <span className="small muted">{s.viaAgent ? 'Bought by an AI agent' : 'Bought by a person'}</span>
    </div>
  );

const WalletCell: Cell = ({ data: s }) =>
  s && (
    <div className="cell">
      <span className={s.status === 'voided' ? 'state' : undefined}>{s.walletCountryName ?? s.walletCountry ?? 'Not known yet'}</span>
      <span className="small muted">Quoted for {s.quotedCountryName}</span>
    </div>
  );

const PaidCell: Cell = ({ data: s }) =>
  s && (
    <div className="cell">
      <span>{s.status === 'voided' ? '$0.00' : usd(s.amount)}</span>
      <span className="small muted">
        {s.status === 'voided' ? `asked ${usd(s.amount)}, ` : ''}list {usd(s.list)}
        {s.help && `, help ${usd(s.help)}`}
        {toCents(s.gift) > 0 && `, gift ${usd(s.gift)}`}
      </span>
    </div>
  );

const HoursCell: Cell = ({ data: s }) =>
  s && (
    <div className="cell">
      <span>{one(s.hoursAtFair)}</span>
      <span className="small muted">{one(s.hoursAtList)} at list</span>
    </div>
  );

/** The status, the reason for a release, and on a captured row the refund. Two presses: the first asks, the second sends the money back. */
const StatusCell: Cell = ({ data: s }) => {
  const { pending, errors, refund } = useContext(Ctx);
  const [armed, setArmed] = useState(false);
  if (!s) return null;
  return (
    <div className="cell">
      <span className={s.status === 'voided' ? 'state state--bad' : 'state'}>{status(s)}</span>
      {s.reason && <span className="small">{s.reason}</span>}
      {s.status === 'captured' &&
        (armed ? (
          <>
            <button className="btn" type="button" disabled={pending !== ''} onClick={() => refund(s.id)}>
              {pending === s.id ? 'Refunding' : `Send ${usd(s.amount)} back`}
            </button>
            <button className="link small" type="button" disabled={pending !== ''} onClick={() => setArmed(false)}>
              Keep the payment
            </button>
          </>
        ) : (
          <button className="btn btn--quiet" type="button" onClick={() => setArmed(true)} aria-label={`Refund ${usd(s.amount)} for ${s.productTitle}`}>
            Refund
          </button>
        ))}
      {errors[s.id] && (
        <span className="small error" role="alert">
          {errors[s.id]}
        </span>
      )}
    </div>
  );
};

const IdsCell: Cell = ({ data: s }) => {
  if (!s) return null;
  const ids = [
    ['Order', s.paypal.orderId],
    ['Hold', s.paypal.authorizationId],
    ['Capture', s.paypal.captureId],
    ['Refund', s.paypal.refundId],
  ];
  return (
    <dl className="refs">
      {ids.map(
        ([label, id]) =>
          id && (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <CopyId value={id} />
              </dd>
            </div>
          ),
      )}
    </dl>
  );
};

const wrap = { wrapText: true, autoHeight: true };
const SALES: ColDef<Sale>[] = [
  { headerName: 'Time', field: 'ts', width: 116, valueFormatter: (p) => stamp(p.value) },
  { headerName: 'Product', width: 176, cellRenderer: ProductCell, ...wrap },
  { headerName: 'Wallet country', width: 152, cellRenderer: WalletCell, ...wrap },
  { headerName: 'Paid', width: 152, cellRenderer: PaidCell, ...wrap },
  { headerName: 'Hours', width: 96, cellRenderer: HoursCell, ...wrap },
  { headerName: 'Status', flex: 1, minWidth: 228, cellRenderer: StatusCell, ...wrap },
  { headerName: 'PayPal', width: 232, cellRenderer: IdsCell, ...wrap },
];
// The ledger grows with its rows up to about eight of them, then scrolls inside itself. Rows are not links, so they
// do not light up under the pointer; the only tinted rows are the released ones.
const salesTheme = gridTheme.withParams({ autoHeightMaxBodyHeight: 640, rowHoverColor: 'transparent' });

export default function SellerPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const rules = desk?.rules ?? RULES;
  const products = desk?.products ?? PRODUCTS;
  const seller = desk?.seller ?? SELLER;
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [dial, setDial] = useState(RULES.dial);
  const [floor, setFloor] = useState(RULES.floorPercent);
  const [find, setFind] = useState('');
  const product = products.find((p) => p.id === productId) ?? products[0];
  const world = useMemo(() => worldTable(product, { ...rules, dial, floorPercent: floor }), [product, rules, dial, floor]);
  const preview = dial !== rules.dial || floor !== rules.floorPercent;

  async function load() {
    const r = await api('/api/seller');
    setFailed(r.status !== 200);
    // An unchanged answer keeps the old object, so the grids are not redrawn every five seconds.
    if (r.status === 200) setDesk((old) => (JSON.stringify(old) === JSON.stringify(r.data) ? old : r.data));
  }
  useEffect(() => {
    load();
    const timer = setInterval(() => !document.hidden && load(), 5000);
    return () => clearInterval(timer);
  }, []);

  async function refund(id: string) {
    setPending(id);
    const r = await api('/api/seller/refund', { purchaseId: id });
    setErrors((e) => ({ ...e, [id]: r.status === 200 ? '' : (r.data?.error ?? FAILED) }));
    await load();
    setPending('');
  }

  const sales = desk?.sales ?? [];
  const captured = sales.filter((s) => s.status === 'captured');
  const revenue = captured.reduce((n, s) => n + toCents(s.amount), 0);
  const soldTo = new Set(captured.map((s) => s.walletCountry)).size;
  const released = sales.filter((s) => s.status === 'voided').length;
  const first = seller.name.split(' ')[0];

  return (
    <div className="container page">
      <header className="page-head">
        <h1>{seller.shop}</h1>
        <p className="muted">
          {seller.name}, {seller.place}. This is what the seller sees.
        </p>
      </header>

      <section className="policy" aria-labelledby="rules-h">
        <div className="stack--tight">
          <h2 id="rules-h">The rules {first} set</h2>
          <p>Code applies them to every quote and every payment. The agents cannot change them.</p>
        </div>
        <ul>
          <li>List prices are set for {place(NAMES.get(rules.referenceCountry) ?? rules.referenceCountry)}.</li>
          <li>
            The fairness dial is at {rules.dial}. At 0 every country pays the same dollars. At 100 every country pays the same hours of
            average income.
          </li>
          <li>
            No price goes below {rules.floorPercent}% of the list price, or above the list price.
          </li>
          <li>
            The clerk may take up to {rules.help.maxPercent}% of the list price off for a buyer, paid from the pool, at most{' '}
            {rules.help.perMonth} times a month.
          </li>
          <li>A payment is taken only when PayPal reports the wallet in the quoted country. Each wallet can buy a product once.</li>
        </ul>
      </section>

      <section className="stack" aria-labelledby="sales-h">
        <div className="stack--tight">
          <h2 id="sales-h">Sales</h2>
          <p>Every purchase that reached PayPal, newest first, including the ones that were released. It refreshes every five seconds.</p>
        </div>
        <dl className="stats">
          <div>
            <dt>Captured</dt>
            <dd>{usd(fromCents(revenue))}</dd>
          </div>
          <div>
            <dt>Countries sold to</dt>
            <dd>{soldTo}</dd>
          </div>
          <div>
            <dt>Payments released</dt>
            <dd>{released}</dd>
          </div>
        </dl>
        <div role="status">
          {failed && <p className="error">The ledger could not be loaded. It will be tried again in five seconds.</p>}
          {!desk && !failed && <p className="muted">Loading the ledger.</p>}
          {desk && sales.length === 0 && (
            <p className="well">
              No sales yet. <Link href={`/buy/${products[0].id}?country=VN`}>Buy the course as someone in Viet Nam</Link> and the sale
              appears here, whether the payment is taken or released.
            </p>
          )}
        </div>
        {sales.length > 0 && (
          <Ctx.Provider value={{ pending, errors, refund }}>
            <div className="grid--lead ledger">
              <AgGridReact<Sale>
                {...gridDefaults}
                theme={salesTheme}
                rowData={sales}
                columnDefs={SALES}
                getRowId={(p) => p.data.id}
                rowClassRules={{ 'is-released': (p) => p.data?.status === 'voided' }}
                domLayout="autoHeight"
              />
            </div>
          </Ctx.Provider>
        )}
      </section>

      <section className="policy" aria-labelledby="pool-h">
        <div className="stack--tight">
          <h2 id="pool-h">The pool</h2>
          <p>
            Buyers can add a gift to their payment. The clerk draws on it to lower the price for a buyer whose circumstances do not
            match their wallet’s country.
          </p>
          <dl className="stats">
            <div>
              <dt>In the pool now</dt>
              <dd>{desk ? usd(desk.pool.balance) : ''}</dd>
            </div>
          </dl>
        </div>
        {desk && desk.pool.entries.length > 0 ? (
          <div className="scroll" tabIndex={0} role="region" aria-label="Pool entries">
            <table className="plain num">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Entry</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Purchase</th>
                </tr>
              </thead>
              <tbody>
                {[...desk.pool.entries].reverse().map((e, i) => {
                  const cents = toCents(e.amount) * (e.kind === 'help' ? -1 : 1);
                  return (
                    <tr key={i}>
                      <td>{stamp(e.ts)}</td>
                      <td>{e.kind === 'help' ? 'Help given by the clerk' : cents < 0 ? 'Gift returned with a refund' : 'Gift from a buyer'}</td>
                      <td>
                        {cents < 0 ? '-' : '+'}
                        {usd(fromCents(Math.abs(cents)))}
                      </td>
                      <td className="mono">{e.purchaseId}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="well">Nothing has gone in or out yet. A gift enters the pool once its payment has been captured.</p>
        )}
      </section>

      <section className="stack" aria-labelledby="world-h">
        <div className="stack--tight">
          <h2 id="world-h">What a price costs around the world</h2>
          <p>
            {world.length} countries, lowest income first. Move the dial or the floor to try other rules. This is a preview in your
            browser: nothing is saved, and buyers are still quoted with the rules above.
          </p>
        </div>
        <div className="controls">
          <label className="field">
            <span>Product</span>
            <select value={product.id} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}, {usd(p.listPrice)}
                </option>
              ))}
            </select>
          </label>
          <Slider id="world-dial" {...DIAL} value={dial} saved={rules.dial} onChange={setDial} />
          <Slider id="world-floor" label="Floor" lo="1% of the list price" hi="100%: the list price everywhere" unit="%" value={floor} saved={rules.floorPercent} onChange={(n) => setFloor(Math.max(1, n))} />
        </div>
        <div className="split">
          <label className="field world__find">
            <span>Find a country</span>
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
          <p className="small" role="status">
            {preview ? (
              <>
                Preview: dial {dial}, floor {floor}%.{' '}
                <button
                  className="link"
                  type="button"
                  onClick={() => {
                    setDial(rules.dial);
                    setFloor(rules.floorPercent);
                  }}
                >
                  Back to the saved rules
                </button>
              </>
            ) : (
              <span className="muted">
                Showing the saved rules: dial {rules.dial}, floor {rules.floorPercent}%.
              </span>
            )}
          </p>
        </div>
        <div className="grid--lead world">
          <AgGridReact<Price> {...gridDefaults} defaultColDef={worldDefaults} rowData={world} columnDefs={WORLD} getRowId={(p) => p.data.country} quickFilterText={find} />
        </div>
      </section>
    </div>
  );
}
