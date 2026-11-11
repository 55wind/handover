'use client';

import { useEffect, useRef } from 'react';
import { MERCHANTS } from '@/lib/merchants';
import type { Event, MerchantSlug, Phase } from '@/lib/types';
import { clock, withIds, withoutMerchant } from './ui';

const RUNNING: Record<Phase, string> = {
  intake: 'Reading the document.',
  plan: 'Asking each merchant what was running, and drafting a plan.',
  pause: 'Pausing every active subscription.',
  resume: 'Resuming what was paused.',
  execute: 'Carrying out the approved plan.',
};

const ACTORS = { agent: 'Agent', guard: 'Guard', family: 'Family', system: 'System' };
const actor = (a: Event['actor']) =>
  a in ACTORS ? ACTORS[a as keyof typeof ACTORS] : `${MERCHANTS[a.slice(5) as MerchantSlug]?.name ?? a.slice(5)} desk`;

export function Activity({ events, running }: { events: Event[]; running: Phase | null }) {
  const log = useRef<HTMLOListElement>(null);

  // Keeps the newest line in view while a run is writing, and when its last lines land just after it ends.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [events.length]);

  return (
    <section className="stack--tight no-print" aria-labelledby="activity-h">
      <h2 id="activity-h">Activity</h2>
      <p role="status">{running && RUNNING[running]}</p>
      {running && <div className="progress" />}
      <ol className="log" ref={log} tabIndex={0} aria-label="Activity log">
        {events.map((e, i) => (
          <li key={i} className={e.type === 'denied' || e.type === 'error' ? 'is-blocked' : undefined}>
            <time dateTime={e.ts}>{clock(e.ts)}</time>
            <span className="log__actor">{actor(e.actor)}</span>
            <span className="log__text">
              {withIds(e.actor.startsWith('desk:') ? withoutMerchant(e.summary) : e.summary)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
