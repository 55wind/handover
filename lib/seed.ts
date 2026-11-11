import { randomBytes } from 'node:crypto';
import { backendFor, seedFailure } from './paypal';
import type { Primitive } from './paypal';
import { store } from './store';
import type { Case, Charge, MerchantSlug, RecordItem } from './types';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Creates the demo estate (spec section 5) on PayPal, files it in the merchants' records and opens a case for it. */
export async function seedDemoCase(): Promise<Case> {
  const run = randomBytes(3).toString('hex');
  const died = Date.parse(iso(Date.now())) - 12 * DAY; // UTC midnight, 12 days ago
  const at = (offset: number) => iso(died + offset * DAY);
  const payer = { payerName: 'Daniel Reyes', payerEmail: `daniel.reyes.${run}@example.com` };

  /** A subscription with one card capture per billing period, given as day offsets from the date of death. */
  async function subscription(slug: MerchantSlug, n: number, label: string, price: string, periods: [number, number][]): Promise<RecordItem[]> {
    const backend = backendFor(slug);
    const sub = await backend.seedSubscription({ label, price, ...payer });
    if (!sub) return [];
    const charges: Charge[] = [];
    for (const [from, to] of periods) {
      const description = `${label}, ${at(from)} to ${at(to)}`;
      const cap = await backend.seedCharge({ label: description, amount: price, ...payer });
      if (cap) charges.push({ ...cap, amount: price, description, period: { start: at(from), end: at(to) } });
    }
    return [{ id: `${slug}-${n}-${run}`, kind: 'subscription', label, paypalId: sub.paypalId, planId: sub.planId, amount: price, cadence: 'month', charges }];
  }

  async function ironwoodItems(): Promise<RecordItem[]> {
    const backend = backendFor('ironwood');
    const locker = { label: 'Annual locker rental', amount: '120.00', period: { start: at(-255), end: at(110) } };
    const training = { label: 'Personal training, 3 sessions not taken', amount: '90.00' };
    const [membership, cap, invoice] = await Promise.all([
      subscription('ironwood', 1, 'Membership', '39.00', [[-5, 25]]),
      backend.seedCharge({ label: locker.label, amount: locker.amount, ...payer }),
      backend.seedInvoice({ ...training, recipientName: payer.payerName, recipientEmail: payer.payerEmail }),
    ]);
    const items = [...membership];
    if (cap)
      items.push({
        id: `ironwood-2-${run}`, kind: 'charge', label: locker.label, paypalId: cap.captureId, amount: locker.amount, cadence: 'year',
        charges: [{ ...cap, amount: locker.amount, description: locker.label, period: locker.period }],
      });
    if (invoice) items.push({ id: `ironwood-3-${run}`, kind: 'invoice', label: training.label, paypalId: invoice.invoiceId, amount: training.amount, charges: [] });
    return items;
  }

  const [lumen, ironwood, harborlight] = await Promise.all([
    subscription('lumen', 1, 'Family plan', '17.99', [[-22, 8], [8, 38]]),
    ironwoodItems(),
    subscription('harborlight', 1, 'Monthly gift', '25.00', [[-25, 5], [5, 35]]),
  ]);
  for (const [slug, items] of Object.entries({ lumen, ironwood, harborlight }) as [MerchantSlug, RecordItem[]][]) {
    const records = store.records.get(slug) ?? [];
    records.push({ customerId: `${slug}-customer-${run}`, fullName: payer.payerName, email: payer.payerEmail, items });
    // A near match the agent must leave alone: same family name, another person.
    if (slug === 'ironwood' && !records.some((r) => r.email === 'daniela.reyes@example.com'))
      records.push({ customerId: 'ironwood-customer-decoy', fullName: 'Daniela Reyes', email: 'daniela.reyes@example.com', items: [] });
    store.records.set(slug, records);
  }

  const diedOn = new Date(died).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const c: Case = {
    id: randomBytes(9).toString('base64url'),
    createdAt: new Date().toISOString(),
    demo: true,
    tier: 'filed',
    status: 'notice',
    running: null,
    paused: false,
    representative: { name: 'Maria Reyes', relation: 'daughter', email: `maria.reyes.${run}@example.com` },
    deceased: { fullName: payer.payerName, emails: [payer.payerEmail], dateOfDeath: at(0) },
    wishes:
      "Mom still watches Lumen on the family plan, please keep it for her. Dad cared about the food bank; I'd like to continue his monthly gift in my name. Close everything else.",
    language: 'en',
    document: {
      text: `NOTICE OF DEATH (sample for demonstration)\nDaniel A. Reyes of Portland, aged 71, died peacefully on ${diedOn}. He is survived by his wife Elena and his daughter Maria.\nIssued by Alder & Finch Funeral Home, reference AF-${run.toUpperCase()}.`,
      mismatches: [],
    },
    items: [],
    notes: [],
    events: [],
  };
  store.cases.set(c.id, c);
  return c;
}

/** Tries each seeding primitive once, with small amounts, on this merchant's backend: 'ok' or why it failed. */
export async function probe(slug: MerchantSlug): Promise<Record<string, string>> {
  const backend = backendFor(slug);
  const who = { payerName: 'Probe Tester', payerEmail: `probe.${randomBytes(3).toString('hex')}@example.com` };
  const out: Record<string, string> = {};
  const attempt = async (name: string, what: Primitive, run: () => Promise<unknown>) => {
    try {
      out[name] = (await run()) ? 'ok' : (seedFailure(slug, what) ?? 'not available');
    } catch (e) {
      out[name] = (e as Error).message;
    }
  };
  await attempt('invoice', 'invoice', () => backend.seedInvoice({ label: 'Probe invoice', amount: '1.00', recipientName: who.payerName, recipientEmail: who.payerEmail }));
  await attempt('card order', 'charge', () => backend.seedCharge({ label: 'Probe charge', amount: '1.00', ...who }));
  await attempt('card subscription', 'subscription', () => backend.seedSubscription({ label: 'Probe plan', price: '1.00', ...who }));
  return out;
}
