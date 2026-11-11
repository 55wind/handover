import type { Case, CustomerRecord, Event, LedgerEntry, MerchantSlug } from './types';

type Listener = (e: Event, c: Case) => void;

interface State {
  cases: Map<string, Case>;
  records: Map<MerchantSlug, CustomerRecord[]>;
  ledger: Map<MerchantSlug, LedgerEntry[]>;
  refunded: Map<string, number>; // capture id -> cents already refunded by Handover
  done: Map<string, Set<string>>; // case id -> "tool:targetId" already executed
  listeners: Map<string, Set<Listener>>;
  demo: { day: string; n: number };
}

// ponytail: all state lives in this process and is lost on restart; move to a database if cases must outlive a deploy.
const g = globalThis as { __handover?: State };
const s: State = (g.__handover ??= {
  cases: new Map(),
  records: new Map(),
  ledger: new Map(),
  refunded: new Map(),
  done: new Map(),
  listeners: new Map(),
  demo: { day: '', n: 0 },
});

export const store = {
  cases: s.cases,
  records: s.records,
  ledger: s.ledger,
  refunded: s.refunded,

  doneFor(caseId: string): Set<string> {
    let set = s.done.get(caseId);
    if (!set) s.done.set(caseId, (set = new Set()));
    return set;
  },

  /** Appends the event to the case and notifies anyone streaming it. */
  emit(caseId: string, e: Omit<Event, 'ts'>): Event {
    const c = s.cases.get(caseId);
    const event: Event = { ts: new Date().toISOString(), ...e };
    if (!c) return event;
    c.events.push(event);
    for (const fn of s.listeners.get(caseId) ?? []) {
      try {
        fn(event, c);
      } catch {
        /* a broken stream must never stop the run that is reporting to it */
      }
    }
    return event;
  },

  subscribe(caseId: string, fn: Listener): () => void {
    let set = s.listeners.get(caseId);
    if (!set) s.listeners.set(caseId, (set = new Set()));
    set.add(fn);
    return () => void set.delete(fn);
  },

  log(slug: MerchantSlug, entry: Omit<LedgerEntry, 'ts'>): void {
    const list = s.ledger.get(slug) ?? [];
    list.push({ ts: new Date().toISOString(), ...entry });
    s.ledger.set(slug, list);
  },

  /** False once today's demo allowance is used up. */
  takeDemoSlot(): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (s.demo.day !== day) s.demo = { day, n: 0 };
    if (s.demo.n >= Number(process.env.DEMO_DAILY_LIMIT ?? 40)) return false;
    s.demo.n++;
    return true;
  },
};

/** The case as sent to the browser: without the uploaded image, and without raw PayPal payloads in event details. */
export function publicCase(c: Case): Case {
  const slim = (detail: unknown) =>
    detail && typeof detail === 'object' && 'result' in detail ? { ...detail, result: undefined } : detail;
  return {
    ...c,
    document: { ...c.document, dataUrl: undefined },
    events: c.events.map((e) => ({ ...e, detail: slim(e.detail) })),
  };
}

