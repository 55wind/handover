'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Talk } from '@/components/Talk';
import { hours, usd } from '@/components/format';
import { api, errorOf } from '@/components/ui';
import { localLabel } from '@/lib/rules';
import { CITIES, HOLD_DAYS, itemOf, shopById } from '@/lib/shops';
import type { Treat } from '@/lib/types';

type Query = Promise<{ [key: string]: string | string[] | undefined }>;

// One per city, each a different reason to send a meal.
const EXAMPLES = [
  'My mom in Busan has a cold. Get her something warm tonight.',
  'My sister Ada in Lagos has exams all week. Buy her a proper lunch.',
  'My grandmother Elena in Mexico City has her birthday today. Send her a slice of cake.',
];

const WORDS = {
  person: 'You',
  agent: 'Agent',
  writing: 'The agent is looking at shops and menus.',
  box: 'Your message',
  send: 'Send to the agent',
  log: 'Your conversation with the errand agent',
};

const cities = `${CITIES.slice(0, -1).join(', ')} and ${CITIES.at(-1)}`;

export default function SendPage({ searchParams }: { searchParams: Query }) {
  const asked = use(searchParams).treat;
  const first = typeof asked === 'string' ? asked : '';
  const [id, setId] = useState(first);
  const [treat, setTreat] = useState<Treat | null>(null);
  const [load, setLoad] = useState<'ready' | 'loading' | 'gone' | 'failed'>(first ? 'loading' : 'ready');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState<'' | 'agent' | 'paypal'>('');
  const [error, setError] = useState('');
  const [payError, setPayError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  // A reload, or coming back from PayPal without approving, picks the conversation up where it was.
  useEffect(() => {
    if (!first) return;
    let live = true;
    api(`/api/treats/${encodeURIComponent(first)}`).then((r) => {
      if (!live) return;
      if (r.status === 200 && r.data?.id) {
        setTreat(r.data);
        setLoad('ready');
      } else if (r.status === 404) {
        // The next message starts a new treat.
        setId('');
        setLoad('gone');
        window.history.replaceState(null, '', '/send');
      } else {
        setLoad('failed');
      }
    });
    return () => {
      live = false;
    };
  }, [first]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy('agent');
    setError('');
    setSent(text);
    setDraft('');

    let r: { status: number; data: any } | undefined;
    let treatId = id;
    if (!treatId) {
      r = await api('/api/treats', { name: name.trim() || 'A friend', language: navigator.language });
      if ((r.status === 201 || r.status === 200) && r.data?.id) {
        treatId = r.data.id as string;
        setId(treatId);
        setTreat(r.data);
        setLoad('ready');
        // The id stays in the address, so a reload resumes this conversation.
        window.history.replaceState(null, '', `/send?treat=${encodeURIComponent(treatId)}`);
      }
    }
    if (treatId) r = await api(`/api/treats/${encodeURIComponent(treatId)}/errand`, { text });

    if (r && r.status === 200 && r.data?.id) {
      setTreat(r.data);
    } else {
      setError(errorOf(r ?? { data: null }));
      // The sentence goes back into the box, so it does not have to be typed again.
      setDraft((now) => now || text);
    }
    setSent('');
    setBusy('');
  }

  async function hold() {
    if (!id || busy) return;
    setBusy('paypal');
    setPayError('');
    const r = await api(`/api/treats/${encodeURIComponent(id)}/checkout`, {});
    // The button stays busy while the browser leaves for PayPal.
    if (r.status === 200 && typeof r.data?.approveUrl === 'string') return window.location.assign(r.data.approveUrl);
    setPayError(errorOf(r));
    setBusy('');
  }

  function fill(text: string) {
    setDraft(text);
    box.current?.focus();
  }

  const shop = shopById(treat?.shopId);
  const item = itemOf(shop, treat?.itemId);
  const proposal = treat && shop && item && treat.card && treat.price ? { shop, item, card: treat.card, price: treat.price } : null;
  const past = treat && treat.status !== 'draft' && treat.status !== 'approving';
  // Once the payment has started at PayPal the server takes no more changes: the conversation is shown, not continued.
  const locked = treat?.status === 'approving';
  const messages = treat?.errand ?? [];

  return (
    <div className={`container page send${proposal ? ' send--two' : ''}`}>
      <header className="page-head">
        <h1>Who do you miss?</h1>
        <p>
          Say who it is for, where they are and what is going on. One sentence is enough. The agent picks a dish at a shop near
          them and writes your card in their language.
        </p>
        <p className="small muted">Shops take part in {cities}.</p>
      </header>

      <section className="stack" aria-labelledby="talk-h">
        <h2 id="talk-h" className="sr">
          Your conversation with the agent
        </h2>

        <div role="status">
          {load === 'loading' && <p className="muted">Loading your conversation.</p>}
          {load === 'failed' && <p className="error">Your conversation could not be loaded. Reload the page to try again.</p>}
          {load === 'gone' && (
            <p className="well">
              That conversation is no longer available. Treats in this demo are kept in memory and are cleared when the server
              restarts. You can start a new one below.
            </p>
          )}
        </div>

        {past && (
          <p className="well">
            This treat has already gone to PayPal. <Link href={`/treat/${treat.id}`}>Open the treat’s page</Link> to share it and
            follow it.
          </p>
        )}

        {load !== 'loading' && load !== 'failed' && !past && (
          <>
            {treat ? (
              <p className="small muted">The card is signed “{treat.from.name}”.</p>
            ) : (
              <label className="field send__name" htmlFor="send-name">
                <span>Your name (optional)</span>
                <input id="send-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="A friend" autoComplete="given-name" />
                <span className="help">The card is signed with it. Left empty, it says “A friend”.</span>
              </label>
            )}

            <Talk id="send" messages={messages} busy={busy === 'agent'} sent={sent} draft={draft} onDraft={setDraft} onSend={send} words={WORDS} error={error} boxRef={box} closed={locked}>
              {messages.length === 0 && !sent && !locked && (
                <div className="examples">
                  <p className="small muted" id="examples-h">
                    Or start from an example. It fills the box and you can change it.
                  </p>
                  <ul aria-labelledby="examples-h">
                    {EXAMPLES.map((text) => (
                      <li key={text}>
                        <button className="example" type="button" onClick={() => fill(text)}>
                          {text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Talk>
            {proposal && !locked && (
              <p className="small muted">
                To change the treat, tell the agent what you would like instead.{' '}
                <a className="send__jump" href="#proposal">
                  See the treat and the hold below.
                </a>
              </p>
            )}
            {locked && (
              <p className="well">
                The payment for this treat has started at PayPal, so it can no longer be changed. To send something else,{' '}
                <Link href={`/treat/${treat.id}`}>cancel it on the treat’s page</Link> and <a href="/send">start a new treat</a>.
              </p>
            )}
          </>
        )}
      </section>

      {proposal && treat && !past && (
        <aside className="proposal" id="proposal" aria-labelledby="proposal-h">
          <div className="stack--tight">
            <h2 id="proposal-h">{treat.to?.name ? `For ${treat.to.name}` : 'The treat'}</h2>
            {treat.to?.place && <p className="muted">{treat.to.place}</p>}
          </div>

          <div className="dish">
            <p className="dish__local" lang={proposal.shop.language}>
              {proposal.item.localName}
            </p>
            {proposal.item.localName !== proposal.item.name && <p className="dish__name">{proposal.item.name}</p>}
            <p className="muted">{proposal.item.about}</p>
          </div>

          <dl className="lines">
            <div>
              <dt>Shop</dt>
              <dd>
                <span lang={proposal.shop.language}>{proposal.shop.localName}</span>
                {proposal.shop.localName !== proposal.shop.name && ` (${proposal.shop.name})`}, {proposal.shop.kind}
              </dd>
            </div>
            <div>
              <dt>Where</dt>
              <dd>
                {proposal.shop.area}, {proposal.shop.city}
              </dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd className="num">{hours(proposal.shop.hours)}, local time</dd>
            </div>
            {treat.reason && (
              <div>
                <dt>Why this</dt>
                <dd>{treat.reason}</dd>
              </div>
            )}
          </dl>

          <figure className="card">
            <blockquote lang={treat.to?.language}>{proposal.card.forRecipient}</blockquote>
            {proposal.card.forSender !== proposal.card.forRecipient && (
              <figcaption>
                <span className="small muted">What it says</span>
                <span>{proposal.card.forSender}</span>
              </figcaption>
            )}
          </figure>

          <dl className="sum num">
            <div>
              <dt>Price of the dish</dt>
              <dd>
                {usd(proposal.price)} <span className="small muted">({localLabel(proposal.shop, proposal.item)} at the shop)</span>
              </dd>
            </div>
            <div>
              <dt>PayPal holds</dt>
              <dd>{usd(treat.ceiling)}</dd>
            </div>
          </dl>
          <p className="small">
            PayPal holds {usd(treat.ceiling)} and takes none of it. When they eat, only the price of what they ate is taken and the
            rest is released. If the treat is not used within {HOLD_DAYS} days, all of it is released.
          </p>

          {locked ? (
            treat.paypal.approveUrl && (
              <a className="btn btn--wide" href={treat.paypal.approveUrl}>
                Continue at PayPal
              </a>
            )
          ) : (
            <button className="btn btn--wide" type="button" onClick={hold} disabled={busy !== ''} aria-busy={busy === 'paypal'}>
              {busy === 'paypal' ? 'Going to PayPal' : `Hold ${usd(treat.ceiling)} with PayPal`}
            </button>
          )}
          {payError && (
            <p className="error" role="alert">
              {payError}
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
