'use client';

import { useEffect, useRef } from 'react';
import type { Event } from '@/lib/types';
import { clock } from './format';
import { withIds } from './ui';

const ACTOR: Record<Event['actor'], string> = {
  clerk: 'Clerk',
  agent: 'Agent',
  desk: 'Seller’s desk',
  rules: 'Rules',
  buyer: 'Buyer',
  system: 'System',
};

/** The purchase's log as it is written. `working` says what is going on right now, or is empty when nothing is. */
export function Activity({ events, working }: { events: Event[]; working: string }) {
  const log = useRef<HTMLOListElement>(null);

  // Keeps the newest line in view while a run is writing, and when its last lines land just after it ends.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [events.length]);

  return (
    <section className="stack--tight no-print" aria-labelledby="activity-h">
      <h2 id="activity-h">Activity</h2>
      <p role="status">{working}</p>
      {working && <div className="progress" />}
      <ol className="log" ref={log} tabIndex={0} aria-label="Activity log">
        {events.map((e, i) => (
          <li key={i} className={e.type === 'refused' || e.type === 'error' ? 'is-blocked' : undefined}>
            <time dateTime={e.ts}>{clock(e.ts)}</time>
            <span className="log__actor">{ACTOR[e.actor] ?? e.actor}</span>
            <span className="log__text">{withIds(e.summary)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
