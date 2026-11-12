'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Activity } from '@/components/Activity';
import { dayAndTime, hours, usd } from '@/components/format';
import { CopyId, api, errorOf, useCopy } from '@/components/ui';
import { useLive } from '@/components/useLive';
import { localLabel } from '@/lib/rules';
import { HOLD_DAYS, PLATFORM, itemOf, shopById } from '@/lib/shops';
import type { Treat } from '@/lib/types';

type Query = Promise<{ [key: string]: string | string[] | undefined }>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function working(t: Treat): string {
  if (!t.running) return '';
  if (t.status === 'draft') return 'The errand agent is working.';
  if (t.status === 'approving') return 'Asking PayPal to place the hold.';
  if (t.status === 'held') return 'The host agent is talking with the recipient.';
  if (t.status === 'settling') return 'The till agent is taking the price of the dish and releasing the rest.';
  return 'Reading the result back from PayPal.';
}

function Ids({ t }: { t: Treat }) {
  const ids: [string, string | undefined, string?][] = [
    ['Order', t.paypal.orderId],
    ['Hold', t.paypal.authorizationId],
    ['Capture', t.paypal.captureId],
    ['Payout to the shop', t.paypal.payoutId, t.paypal.payoutStatus],
  ];
  const known = ids.filter(([, id]) => id);
  return (
    <section className="stack--tight" aria-labelledby="ids-h">
      <h2 id="ids-h">PayPal’s ids</h2>
      {known.length === 0 ? (
        <p className="muted">Nothing has reached PayPal yet.</p>
      ) : (
        <dl className="refs refs--wide">
          {known.map(([label, id, state]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <CopyId value={id!} />
                {state && <span className="small muted">{state.toLowerCase()}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The link the sender passes on, the code, and how long it is good for. */
function Share({ t, who }: { t: Treat; who: string }) {
  const link = `${window.location.origin}/t/${t.code}`;
  const [copied, copy] = useCopy(link);
  return (
    <section className="share" aria-labelledby="share-h">
      <div className="stack--tight">
        <h2 id="share-h">Send this link to {who}</h2>
        <p>It opens your card, the treat and the code for the counter. It never shows a price.</p>
      </div>
      <div className="share__link">
        <a href={link}>{link}</a>
        <button className="btn btn--quiet" type="button" onClick={copy}>
          Copy the link
        </button>
        <span className="small muted" role="status">
          {copied && 'Copied'}
        </span>
      </div>
      <dl className="facts">
        <dt>Code</dt>
        <dd className="mono">{t.code}</dd>
        {t.expiresAt && (
          <>
            <dt>Valid until</dt>
            <dd>{dayAndTime(t.expiresAt, 'en-GB')}</dd>
          </>
        )}
        {t.visit && (
          <>
            <dt>They plan to go</dt>
            <dd>{t.visit}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

export default function TreatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Query }) {
  const { id } = use(params);
  // PayPal sends the sender back here with this mark when they leave without approving.
  const leftPayPal = use(searchParams).cancelled !== undefined;
  const base = `/api/treats/${encodeURIComponent(id)}`;
  const { data: t, load, set } = useLive<Treat>(base, 'treat');
  const [armed, setArmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  if (!t) {
    return (
      <div className="container page">
        <div className="page-head" role="status">
          {load === 'loading' && <p className="muted">Loading the treat.</p>}
          {load === 'failed' && <p className="error">The treat could not be loaded. Reload the page to try again.</p>}
          {load === 'gone' && (
            <>
              <h1>This treat is no longer available</h1>
              <p>Treats in this demo are kept in memory and are cleared when the server restarts. A hold that is forgotten this way is never taken.</p>
              <p>
                <Link href="/send">Send a new treat</Link>
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  async function cancel() {
    setCancelling(true);
    setError('');
    const r = await api(`${base}/cancel`, {});
    if (r.status === 200 && r.data?.id) set(r.data);
    else setError(errorOf(r));
    setCancelling(false);
    setArmed(false);
  }

  const shop = shopById(t.shopId);
  const item = itemOf(shop, t.itemId);
  const who = t.to?.name || 'them';
  const o = t.outcome;
  const waiting = t.status === 'approving' && !t.running;

  // Two presses: the first asks, the second cancels. A cancelled treat cannot be brought back.
  const cancelButtons = armed ? (
    <>
      <button className="btn" type="button" onClick={cancel} disabled={cancelling} aria-busy={cancelling}>
        {cancelling ? 'Cancelling' : waiting ? 'Yes, cancel this treat' : 'Yes, release the hold'}
      </button>
      <button className="btn btn--quiet" type="button" onClick={() => setArmed(false)} disabled={cancelling}>
        Keep the treat
      </button>
    </>
  ) : (
    <button className="btn btn--quiet" type="button" onClick={() => setArmed(true)}>
      {waiting ? 'Cancel this treat' : 'Cancel and release the hold'}
    </button>
  );

  return (
    <div className="container page treat">
      <div className="treat__main">
        <header className="page-head" aria-live="polite">
          {t.status === 'draft' && (
            <>
              <h1>This treat has not gone to PayPal yet</h1>
              <p>Nothing is held and nothing has been taken.</p>
              <div className="actions">
                <Link className="btn" href={`/send?treat=${t.id}`}>
                  Go back to the agent
                </Link>
              </div>
            </>
          )}
          {t.status === 'approving' && t.running && (
            <>
              <h1>Placing the hold</h1>
              <p>PayPal is being asked to hold {usd(t.ceiling)}. This takes a few seconds.</p>
              <div className="progress" />
            </>
          )}
          {waiting && (
            <>
              <h1>{leftPayPal ? 'You left PayPal without approving' : 'Waiting for PayPal'}</h1>
              <p>The hold is placed once you approve it at PayPal. So far nothing is held and nothing has been taken.</p>
              <div className="actions">
                {t.paypal.approveUrl && (
                  <a className="btn" href={t.paypal.approveUrl}>
                    Go back to PayPal
                  </a>
                )}
                {cancelButtons}
              </div>
              <p className="small muted">
                A treat cannot be changed once its payment has started. To send something else, cancel this one and{' '}
                <Link href="/send">start a new treat</Link>.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
          {t.status === 'held' && (
            <>
              <h1>PayPal is holding {usd(t.ceiling)}</h1>
              <p>
                None of it has been taken. When {who} eats, only the price of the dish is taken and the rest is released. If the
                treat is not used within {HOLD_DAYS} days, all of it is released.
              </p>
            </>
          )}
          {t.status === 'settling' && (
            <>
              <h1>{cap(who)} is at the counter</h1>
              <p>The price of the dish is being taken and the rest of the hold released. This can take up to 20 seconds.</p>
              <div className="progress" />
            </>
          )}
          {t.status === 'enjoyed' && (
            <>
              <h1>{cap(who)} has been served</h1>
              {o?.forSender && <p>{o.forSender}</p>}
            </>
          )}
          {t.status === 'released' && (
            <>
              <h1>Nothing was taken</h1>
              <p>{o?.forSender ?? t.declined?.forSender ?? 'The hold was released.'}</p>
              {o?.forSender && t.declined?.forSender && <p>{t.declined.forSender}</p>}
              <div className="actions">
                <Link className="btn btn--quiet" href="/send">
                  Send another treat
                </Link>
              </div>
            </>
          )}
        </header>

        {t.status === 'held' && <Share t={t} who={who} />}

        {t.thanks && (
          <figure className="card">
            <blockquote>{t.thanks.forSender}</blockquote>
            <figcaption>
              <span className="small muted">{cap(who)} wrote{t.thanks.original !== t.thanks.forSender && ', in their own words'}</span>
              {t.thanks.original !== t.thanks.forSender && <span lang={t.to?.language}>{t.thanks.original}</span>}
            </figcaption>
          </figure>
        )}

        {(t.status === 'enjoyed' || t.status === 'released') && (
          <section className="statement" aria-labelledby="result-h">
            <div className="statement__mark">
              <b>{PLATFORM.name}</b>
              <span className="small muted">{t.ref}</span>
            </div>
            <h2 id="result-h" className="sr">
              What PayPal did
            </h2>
            <dl className="lines num">
              {t.status === 'enjoyed' && item && (
                <div>
                  <dt>What they ate</dt>
                  <dd>
                    <span lang={shop?.language}>{item.localName}</span>
                    {item.localName !== item.name && ` (${item.name})`}
                  </dd>
                </div>
              )}
              {t.status === 'enjoyed' && shop && (
                <div>
                  <dt>Where</dt>
                  <dd>
                    <span lang={shop.language}>{shop.localName}</span>
                    {shop.localName !== shop.name && ` (${shop.name})`}, {shop.area}, {shop.city}
                  </dd>
                </div>
              )}
              <div>
                <dt>Charged</dt>
                <dd>{t.status === 'enjoyed' ? usd(o?.charged) : usd(o?.charged ?? '0.00')}</dd>
              </div>
              <div>
                <dt>Released</dt>
                <dd>{t.paypal.authorizationId ? usd(o?.released ?? (t.status === 'released' ? t.ceiling : undefined)) : 'Nothing was held'}</dd>
              </div>
              <div>
                <dt>PayPal</dt>
                <dd className={o?.verified ? 'verified' : 'muted'}>{o?.verified ? 'Confirmed with PayPal' : 'Not confirmed with PayPal'}</dd>
              </div>
            </dl>
          </section>
        )}

        {shop && item && t.status !== 'enjoyed' && (
          <section className="stack--tight" aria-labelledby="treat-h">
            <h2 id="treat-h">{t.status === 'released' ? 'What the treat was' : 'The treat'}</h2>
            {t.status === 'held' && <p className="small muted">{cap(who)} can change the dish within what is held. This shows the current one.</p>}
            <dl className="lines">
              <div>
                <dt>Dish</dt>
                <dd>
                  <span lang={shop.language}>{item.localName}</span>
                  {item.localName !== item.name && ` (${item.name})`}
                </dd>
              </div>
              <div>
                <dt>Shop</dt>
                <dd>
                  <span lang={shop.language}>{shop.localName}</span>
                  {shop.localName !== shop.name && ` (${shop.name})`}, {shop.kind}, {shop.area}, {shop.city}
                </dd>
              </div>
              <div>
                <dt>Open</dt>
                <dd className="num">{hours(shop.hours)}, local time</dd>
              </div>
              {t.price && (
                <div>
                  <dt>Price of the dish</dt>
                  <dd className="num">
                    {usd(t.price)} <span className="small muted">({localLabel(shop, item)} at the shop)</span>
                  </dd>
                </div>
              )}
              {t.card && (
                <div>
                  <dt>Your card</dt>
                  <dd>
                    <span lang={t.to?.language}>{t.card.forRecipient}</span>
                    {t.card.forSender !== t.card.forRecipient && <span className="small muted card-says">What it says: {t.card.forSender}</span>}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {t.status === 'held' && (
          <>
            <section className="stack--tight" aria-labelledby="cancel-h">
              <h2 id="cancel-h">Cancel the treat</h2>
              <p>Cancelling releases the whole hold. Nothing is taken, and the link stops working.</p>
              <div className="actions">{cancelButtons}</div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </section>

            <aside className="demo" aria-labelledby="demo-h">
              <h2 id="demo-h">Demo helpers</h2>
              <p className="small">
                In real use the recipient and the shopkeeper are other people, on their own phones. These two links let you play
                them. Each opens in a new tab.
              </p>
              <div className="actions">
                <a className="btn btn--quiet" href={`/t/${t.code}`} target="_blank" rel="noreferrer">
                  Open the recipient’s page
                </a>
                {t.shopId && (
                  <a className="btn btn--quiet" href={`/shop/${t.shopId}?code=${encodeURIComponent(t.code)}`} target="_blank" rel="noreferrer">
                    Play the shopkeeper
                  </a>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      <div className="treat__side">
        <Activity events={t.events} working={working(t)} />
        <Ids t={t} />
      </div>
    </div>
  );
}
