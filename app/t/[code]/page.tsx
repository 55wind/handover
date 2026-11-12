'use client';

import { use, useState } from 'react';
import { Talk } from '@/components/Talk';
import { dayAndTime } from '@/components/format';
import { api } from '@/components/ui';
import { useLive } from '@/components/useLive';
import { browserLanguage, languageOf, wordsFor } from '@/components/words';
import type { RecipientView } from '@/lib/types';

// The recipient's page: a card from a person, a dish, a code for the counter. No price and no amount appears on it.
export default function RecipientPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const base = `/api/t/${encodeURIComponent(code)}`;
  const { data: view, load, set } = useLive<RecipientView>(base, 'view');
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Before the link has been used, or when it opens nothing, the browser's language is the best guess.
  const unopened = !view || view.status === 'draft' || view.status === 'approving';
  if (unopened) {
    const w = wordsFor(browserLanguage());
    return (
      <div className="container page gift" lang={languageOf(browserLanguage())} suppressHydrationWarning>
        <div className="page-head" role="status">
          {!view && load === 'loading' && (
            <p className="muted" suppressHydrationWarning>
              {w.loading}
            </p>
          )}
          {!view && load === 'failed' && <p className="error">{w.failed}</p>}
          {(view || load === 'gone') && (
            <>
              <h1>{w.notFound}</h1>
              <p>{w.notFoundMore}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const w = wordsFor(view.language);
  const lang = languageOf(view.language);
  const { shop, item } = view;
  const released = view.released || view.status === 'released';
  const enjoyed = !released && (view.enjoyed || view.status === 'enjoyed');
  const held = view.status === 'held';

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setSent(text);
    setDraft('');
    const r = await api(`${base}/host`, { text });
    if (r.status === 200 && r.data?.code) {
      set(r.data);
    } else {
      setError(typeof r.data?.error === 'string' && r.data.error ? r.data.error : w.notSent);
      setDraft((now) => now || text);
    }
    setSent('');
    setBusy(false);
  }

  if (released) {
    return (
      <div className="container page gift" lang={lang}>
        <header className="page-head" role="status">
          <h1>{w.gone}</h1>
          <p className="lead">{w.nothingTaken(view.fromName)}</p>
        </header>
      </div>
    );
  }

  return (
    <div className="container page gift" lang={lang}>
      <header className="page-head">
        <h1 aria-live="polite">{enjoyed ? w.enjoy : w.hello(view.toName)}</h1>
        <p className="lead">{w.sent(view.fromName)}</p>
      </header>

      <figure className="card card--letter" aria-label={w.card}>
        <blockquote>{view.card}</blockquote>
        <figcaption>{view.fromName}</figcaption>
      </figure>

      <section className="stack" aria-labelledby="gift-treat-h">
        <h2 id="gift-treat-h">{w.treat}</h2>
        <div className="dish">
          <p className="dish__local">{item.localName}</p>
          {item.localName !== item.name && (
            <p className="dish__name" lang="en">
              {item.name}
            </p>
          )}
          <p className="muted" lang="en">
            {item.about}
          </p>
        </div>
        <dl className="lines">
          <div>
            <dt>{w.shop}</dt>
            <dd>
              {shop.localName}
              {shop.localName !== shop.name && <span lang="en"> ({shop.name})</span>}
              <span className="small muted gift__where" lang="en">
                {shop.kind}, {shop.area}, {shop.city}
              </span>
            </dd>
          </div>
          <div>
            <dt>{w.open}</dt>
            <dd className="num">{shop.hours.replace('-', '–')}</dd>
          </div>
          <div>
            <dt>{w.keeper}</dt>
            <dd>{shop.keeper}</dd>
          </div>
        </dl>
      </section>

      {held && (
        <section className="ticket" aria-labelledby="ticket-h">
          <h2 id="ticket-h">{w.show}</h2>
          <p className="ticket__code" translate="no">
            {view.code}
          </p>
          <p>{w.covered}</p>
          {view.expiresAt && <p className="small muted">{w.until(dayAndTime(view.expiresAt, view.language))}</p>}
          {view.visit && <p className="small muted">{w.visit(view.visit)}</p>}
        </section>
      )}

      {view.status === 'settling' && (
        <section className="ticket" role="status">
          <p>{w.settling}</p>
          <div className="progress" />
        </section>
      )}

      {view.thanks && (
        <figure className="card">
          <blockquote>{view.thanks}</blockquote>
          <figcaption>{w.thanks}</figcaption>
        </figure>
      )}

      {(held || enjoyed) && (
        <section className="stack" aria-labelledby="gift-talk-h">
          <div className="stack--tight">
            <h2 id="gift-talk-h">{held ? w.talkTitle : w.thankTitle}</h2>
            <p className="muted">
              {held && `${w.changeHelp} `}
              {w.thankHelp(view.fromName)}
            </p>
          </div>
          <Talk
            id="host"
            messages={view.host}
            busy={busy || (held && view.running)}
            sent={sent}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            words={{ person: w.you, agent: w.host, writing: w.writing, box: w.box, send: w.send, log: w.log }}
            error={error}
          />
        </section>
      )}

      {held && (
        <aside className="demo" lang="en" aria-labelledby="gift-demo-h">
          <h2 id="gift-demo-h">Demo helper</h2>
          <p className="small">
            This box is not part of the recipient’s page. In real use the shopkeeper enters the code on the shop’s own screen.
          </p>
          <p className="small">
            <a href={`/shop/${shop.id}?code=${encodeURIComponent(view.code)}`} target="_blank" rel="noreferrer">
              At the counter
            </a>{' '}
            (opens in a new tab)
          </p>
        </aside>
      )}
    </div>
  );
}
