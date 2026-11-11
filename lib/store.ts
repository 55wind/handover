import { POOL_SEED } from './seller';
import type { Event, Pool, Purchase, Quote } from './types';

type Listener = (e: Event, p: Purchase) => void;

/** What is counted per day. Each has its own allowance, so talking to the clerk cannot use up settlements. */
export type Budget = 'clerk' | 'settle' | 'checkout';
const LIMITS: Record<Budget, [env: string, fallback: number]> = {
  clerk: ['DAILY_CLERK_LIMIT', 300], // model runs for conversation
  settle: ['DAILY_SETTLE_LIMIT', 200], // model runs for settlement; past this the rules settle without a model
  checkout: ['DAILY_CHECKOUT_LIMIT', 400], // orders created at PayPal
};

interface State {
  purchases: Map<string, Purchase>;
  quotes: Map<string, Quote>;
  pool: Pool;
  bought: Set<string>; // "payerId:productId" for captured purchases
  listeners: Map<string, Set<Listener>>;
  runs: { day: string; n: Partial<Record<Budget, number>> };
}

// ponytail: all state lives in this process and is lost on restart; move to a database if sales must outlive a deploy.
const g = globalThis as { __fairHour?: State };
const s: State = (g.__fairHour ??= {
  purchases: new Map(),
  quotes: new Map(),
  // The seller opens the pool with a small sum, so the clerk can help the first buyer after a restart.
  pool: { balance: POOL_SEED, entries: Number(POOL_SEED) > 0 ? [{ ts: new Date().toISOString(), ref: '', kind: 'seed', amount: POOL_SEED }] : [] },
  bought: new Set(),
  listeners: new Map(),
  runs: { day: '', n: {} },
});

const MAX_QUOTES = 5000;
const MAX_PURCHASES = 3000;
const age = (iso: string) => Date.now() - Date.parse(iso);

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
    return () => {
      set.delete(fn);
      if (!set.size) s.listeners.delete(purchaseId);
    };
  },

  /** False once today's allowance for this kind of work is used up. */
  takeRun(kind: Budget): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (s.runs.day !== day) s.runs = { day, n: {} };
    const [env, fallback] = LIMITS[kind];
    const used = s.runs.n[kind] ?? 0;
    if (used >= Number(process.env[env] ?? fallback)) return false;
    s.runs.n[kind] = used + 1;
    return true;
  },

  /**
   * Forgets what can no longer be used: expired quotes, purchases never paid for, and attempts abandoned at PayPal.
   * Sales that reached a result stay: they are the seller's ledger. Returns false while the shop holds too much to take more.
   */
  makeRoom(): boolean {
    for (const [id, q] of s.quotes) if (age(q.expiresAt) > 0) s.quotes.delete(id);
    for (const [id, p] of s.purchases) {
      if (p.running) continue;
      if ((p.status === 'open' && age(p.createdAt) > 2 * 3600_000) || (p.status === 'approving' && age(p.createdAt) > 24 * 3600_000)) {
        s.purchases.delete(id);
        s.listeners.delete(id);
      }
    }
    return s.quotes.size < MAX_QUOTES && s.purchases.size < MAX_PURCHASES;
  },
};

/** The purchase as sent to a browser: without raw PayPal payloads in event details. */
export function publicPurchase(p: Purchase): Purchase {
  const slim = (detail: unknown) => (detail && typeof detail === 'object' && 'result' in detail ? { ...detail, result: undefined } : detail);
  return { ...p, events: p.events.map((e) => ({ ...e, detail: slim(e.detail) })) };
}
