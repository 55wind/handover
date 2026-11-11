import type { Event, Pool, Purchase, Quote } from './types';

type Listener = (e: Event, p: Purchase) => void;

interface State {
  purchases: Map<string, Purchase>;
  quotes: Map<string, Quote>;
  pool: Pool;
  bought: Set<string>; // "payerId:productId" for captured purchases
  listeners: Map<string, Set<Listener>>;
  runs: { day: string; n: number };
}

// ponytail: all state lives in this process and is lost on restart; move to a database if sales must outlive a deploy.
const g = globalThis as { __fairHour?: State };
const s: State = (g.__fairHour ??= {
  purchases: new Map(),
  quotes: new Map(),
  pool: { balance: '0.00', entries: [] },
  bought: new Set(),
  listeners: new Map(),
  runs: { day: '', n: 0 },
});

export const store = {
  purchases: s.purchases,
  quotes: s.quotes,
  pool: s.pool,
  bought: s.bought,

  /** Appends the event to the purchase and notifies anyone streaming it. */
  emit(purchaseId: string, e: Omit<Event, 'ts'>): Event {
    const p = s.purchases.get(purchaseId);
    const event: Event = { ts: new Date().toISOString(), ...e };
    if (!p) return event;
    p.events.push(event);
    for (const fn of s.listeners.get(purchaseId) ?? []) {
      try {
        fn(event, p);
      } catch {
        /* a broken stream must never stop the run that is reporting to it */
      }
    }
    return event;
  },

  subscribe(purchaseId: string, fn: Listener): () => void {
    let set = s.listeners.get(purchaseId);
    if (!set) s.listeners.set(purchaseId, (set = new Set()));
    set.add(fn);
    return () => void set.delete(fn);
  },

  /** False once today's allowance of model runs is used up. Every clerk reply and settlement costs model calls. */
  takeRun(): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (s.runs.day !== day) s.runs = { day, n: 0 };
    if (s.runs.n >= Number(process.env.DAILY_RUN_LIMIT ?? 400)) return false;
    s.runs.n++;
    return true;
  },
};

/** The purchase as sent to a browser: without raw PayPal payloads in event details. */
export function publicPurchase(p: Purchase): Purchase {
  const slim = (detail: unknown) => (detail && typeof detail === 'object' && 'result' in detail ? { ...detail, result: undefined } : detail);
  return { ...p, events: p.events.map((e) => ({ ...e, detail: slim(e.detail) })) };
}
