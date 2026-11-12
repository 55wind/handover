import type { Event, Treat } from './types';

type Listener = (e: Event | null, t: Treat) => void;

/** What is counted per day. Each has its own allowance, so chatting cannot use up settlements. */
export type Budget = 'errand' | 'host' | 'till' | 'checkout';
const LIMITS: Record<Budget, [env: string, fallback: number]> = {
  errand: ['DAILY_ERRAND_LIMIT', 300], // model runs for senders
  host: ['DAILY_HOST_LIMIT', 300], // model runs for recipients
  till: ['DAILY_TILL_LIMIT', 200], // model runs at the counter; past this the rules settle without a model
  checkout: ['DAILY_CHECKOUT_LIMIT', 300], // orders created at PayPal
};

interface State {
  treats: Map<string, Treat>; // by id
  codes: Map<string, string>; // code -> id
  listeners: Map<string, Set<Listener>>;
  runs: { day: string; n: Partial<Record<Budget, number>> };
}

// ponytail: all state lives in this process and is lost on restart; move to a database if treats must outlive a deploy.
// A hold that is forgotten this way is never taken: PayPal lets it lapse.
const g = globalThis as { __haveYouEaten?: State };
const s: State = (g.__haveYouEaten ??= { treats: new Map(), codes: new Map(), listeners: new Map(), runs: { day: '', n: {} } });

const MAX_TREATS = 3000;
const age = (iso: string) => Date.now() - Date.parse(iso);

export const store = {
  treats: s.treats,
  codes: s.codes,

  byCode(code: unknown): Treat | undefined {
    const id = typeof code === 'string' ? s.codes.get(code.trim().toUpperCase()) : undefined;
    return id ? s.treats.get(id) : undefined;
  },

  /** Appends the event to the treat and notifies anyone streaming it. */
  emit(treatId: string, e: Omit<Event, 'ts'>): Event {
    const t = s.treats.get(treatId);
    const event: Event = { ts: new Date().toISOString(), ...e };
    if (!t) return event;
    t.events.push(event);
    notify(t, event);
    return event;
  },

  /** Tells anyone streaming the treat that it changed without adding an event (a chat message, a new status). */
  touch(t: Treat): void {
    notify(t, null);
  },

  subscribe(treatId: string, fn: Listener): () => void {
    let set = s.listeners.get(treatId);
    if (!set) s.listeners.set(treatId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) s.listeners.delete(treatId);
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
   * Forgets what can no longer be used: drafts nobody finished and approvals abandoned at PayPal.
   * Treats that reached a result stay: they are the ledger. Returns false while too much is held to take more.
   */
  makeRoom(): boolean {
    for (const [id, t] of s.treats) {
      if (t.running) continue;
      if ((t.status === 'draft' && age(t.createdAt) > 2 * 3600_000) || (t.status === 'approving' && age(t.createdAt) > 24 * 3600_000)) {
        s.treats.delete(id);
        s.codes.delete(t.code);
        s.listeners.delete(id);
      }
    }
    return s.treats.size < MAX_TREATS;
  },
};

function notify(t: Treat, event: Event | null): void {
  for (const fn of s.listeners.get(t.id) ?? []) {
    try {
      fn(event, t);
    } catch {
      /* a broken stream must never stop the run that is reporting to it */
    }
  }
}
