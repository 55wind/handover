import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItems, fromCents, guard, matchCustomers, refundableCents, toCents, validatePlan } from './guard';
import type { GuardInput, PlanRow } from './guard';
import type { Action, Case, Charge, CustomerRecord, Item, Merchant, MerchantSlug, Policy } from './types';

// ---- fixtures -------------------------------------------------------------

const DOD = '2026-09-13'; // 110 days before 2027-01-01

const merchant = (slug: MerchantSlug, p: Partial<Policy>): Merchant => ({
  slug,
  name: slug,
  blurb: '',
  policy: { prorataCurrentPeriod: false, waiveUndeliveredInvoices: false, allowTakeOver: false, summary: '', ...p },
});
const MERCHANTS: Record<MerchantSlug, Merchant> = {
  lumen: merchant('lumen', { allowTakeOver: true }),
  ironwood: merchant('ironwood', { prorataCurrentPeriod: true, waiveUndeliveredInvoices: true }),
  harborlight: merchant('harborlight', { allowTakeOver: true }),
};
const PRORATA = MERCHANTS.ironwood.policy;
const WHOLE_PERIODS = MERCHANTS.lumen.policy;

const charge = (captureId: string, amount: string, start: string, end: string): Charge => ({
  captureId,
  amount,
  description: '',
  period: { start, end },
});

const atLumen = (): CustomerRecord => ({
  customerId: 'l-1',
  fullName: 'Daniel Reyes',
  email: ' Daniel.Reyes@Example.com ',
  items: [
    {
      id: 'lumen-1', kind: 'subscription', label: 'Family plan', paypalId: 'I-LUM1', planId: 'P-LUM', amount: '17.99', cadence: 'month',
      charges: [charge('CAP-A', '17.99', '2026-09-01', '2026-10-01'), charge('CAP-B', '17.99', '2026-10-01', '2026-11-01')],
    },
  ],
});
const atIronwood = (): CustomerRecord => ({
  customerId: 'i-1',
  fullName: 'Daniel Reyes',
  email: 'daniel.reyes@example.com',
  items: [
    {
      id: 'iron-1', kind: 'subscription', label: 'Membership', paypalId: 'I-SUB1', planId: 'P-IRON', amount: '39.00', cadence: 'month',
      charges: [charge('CAP-M1', '39.00', '2026-09-01', '2026-10-01'), charge('CAP-M2', '39.00', '2026-10-01', '2026-11-01')],
    },
    { id: 'iron-2', kind: 'charge', label: 'Annual locker', paypalId: 'CAP-L1', amount: '120.00', charges: [charge('CAP-L1', '120.00', '2026-01-01', '2027-01-01')] },
    { id: 'iron-3', kind: 'invoice', label: 'Training sessions', paypalId: 'INV2-1', amount: '90.00', charges: [] },
  ],
});
const decoy: CustomerRecord = { customerId: 'i-2', fullName: 'Daniela Reyes', email: 'daniela.reyes@example.com', items: [] };
const stranger: CustomerRecord = { customerId: 'i-3', fullName: 'Tom Baker', email: 'tom.baker@example.com', items: [] };

const deceased: Case['deceased'] = { fullName: 'Daniel Reyes', emails: ['daniel.reyes@example.com'], dateOfDeath: DOD };

const items = (): Item[] => [
  ...buildItems(MERCHANTS.lumen, [atLumen()], DOD, new Map()),
  ...buildItems(MERCHANTS.ironwood, [atIronwood()], DOD, new Map()),
];

const rows = (): PlanRow[] => [
  { item_id: 'lumen-1', action: 'take_over', refund_capture_ids: ['CAP-B'], reason: 'the family keeps watching' },
  { item_id: 'iron-1', action: 'close', refund_capture_ids: ['CAP-M1', 'CAP-M2'], reason: 'close everything else' },
  { item_id: 'iron-2', action: 'refund', refund_capture_ids: ['CAP-L1'], reason: 'unused part of the year' },
  { item_id: 'iron-3', action: 'waive', refund_capture_ids: [], reason: 'sessions not taken' },
];
const withRow = (id: string, patch: Partial<PlanRow>): PlanRow[] => rows().map((r) => (r.item_id === id ? { ...r, ...patch } : r));

/** The estate with the plan above approved, keyed by item id. */
function approved(): Record<string, Item> {
  const list = items();
  const { decisions } = validatePlan(rows(), list, MERCHANTS);
  for (const it of list) it.decided = decisions.get(it.id);
  return Object.fromEntries(list.map((it) => [it.id, it]));
}

const makeCase = (over: Partial<Case> = {}): Case => ({
  id: 'case-1',
  createdAt: '2026-09-22T00:00:00.000Z',
  demo: true,
  tier: 'verified',
  status: 'executing',
  running: 'execute',
  paused: false,
  representative: { name: 'Maria Reyes', relation: 'daughter', email: 'maria.reyes@example.com' },
  deceased,
  wishes: '',
  language: 'en',
  document: { mismatches: [] },
  items: [],
  notes: [],
  approvedAt: '2026-09-22T00:05:00.000Z',
  events: [],
  ...over,
});

const call = (tool: string, targetId: string, item: Item | undefined, over: Partial<GuardInput> = {}): GuardInput => ({
  tool,
  targetId,
  item,
  c: makeCase(),
  merchant: item ? MERCHANTS[item.merchant] : MERCHANTS.ironwood,
  done: new Set(),
  ...over,
});
const allows = (i: GuardInput) => assert.deepEqual(guard(i), { allow: true });
const denies = (i: GuardInput, reason: RegExp) => {
  const r = guard(i);
  assert.equal(r.allow, false, `${i.tool} on ${i.targetId} should be denied`);
  if (!r.allow) assert.match(r.reason, reason);
};

const READS = ['show_subscription_details', 'get_invoice', 'get_order', 'get_refund'];
const ANY_TIER = ['suspend_subscription', 'activate_subscription', 'cancel_invoice_auto_reminder', 'generate_invoice_qr_code'];
const FILED = { c: makeCase({ tier: 'filed', approvedAt: undefined }) };

// ---- money ----------------------------------------------------------------

test('toCents and fromCents convert without float drift', () => {
  assert.equal(toCents('17.99'), 1799);
  assert.equal(toCents('120.00'), 12000);
  assert.equal(toCents('120'), 12000);
  assert.equal(toCents('0.07'), 7);
  assert.equal(fromCents(3616), '36.16');
  assert.equal(fromCents(1005), '10.05');
  assert.equal(fromCents(5), '0.05');
  assert.equal(fromCents(0), '0.00');
});

// ---- refund math ----------------------------------------------------------

test('a period that starts after the date of death is refunded in full', () => {
  assert.equal(refundableCents(charge('C', '17.99', '2026-10-01', '2026-11-01'), DOD, WHOLE_PERIODS, 0), 1799);
});

test('date of death equal to the period start is refunded in full', () => {
  assert.equal(refundableCents(charge('C', '17.99', DOD, '2026-10-13'), DOD, WHOLE_PERIODS, 0), 1799);
  assert.equal(refundableCents(charge('C', '17.99', DOD, '2026-10-13'), DOD, PRORATA, 0), 1799);
});

test('date of death equal to the period end, or after it, refunds nothing', () => {
  assert.equal(refundableCents(charge('C', '39.00', '2026-08-13', DOD), DOD, PRORATA, 0), 0);
  assert.equal(refundableCents(charge('C', '39.00', '2026-07-01', '2026-08-01'), DOD, PRORATA, 0), 0);
});

test('pro-rata: 120.00 over 365 days with 110 days left is 36.16', () => {
  assert.equal(refundableCents(charge('C', '120.00', '2026-01-01', '2027-01-01'), DOD, PRORATA, 0), 3616);
});

test('pro-rata counts whole UTC days, also across a clock change, and rounds down', () => {
  // 31 days, 24 left
  assert.equal(refundableCents(charge('C', '31.00', '2026-03-01', '2026-04-01'), '2026-03-08', PRORATA, 0), 2400);
  // 30 days, 29 left: 3900 * 29 / 30 = 3770
  assert.equal(refundableCents(charge('C', '39.00', '2026-11-01', '2026-12-01'), '2026-11-02', PRORATA, 0), 3770);
  // last day of the period: 1 of 30 days, 0.10 * 1 / 30 rounds down to 0
  assert.equal(refundableCents(charge('C', '0.10', '2026-11-01', '2026-12-01'), '2026-11-30', PRORATA, 0), 0);
});

test('pro-rata is off when the policy flag is false', () => {
  assert.equal(refundableCents(charge('C', '120.00', '2026-01-01', '2027-01-01'), DOD, WHOLE_PERIODS, 0), 0);
});

test('what was already refunded is subtracted, never below zero', () => {
  const later = charge('C', '17.99', '2026-10-01', '2026-11-01');
  assert.equal(refundableCents(later, DOD, WHOLE_PERIODS, 500), 1299);
  assert.equal(refundableCents(later, DOD, WHOLE_PERIODS, 1799), 0);
  assert.equal(refundableCents(later, DOD, WHOLE_PERIODS, 5000), 0);
  assert.equal(refundableCents(charge('C', '120.00', '2026-01-01', '2027-01-01'), DOD, PRORATA, 3000), 616);
});

// ---- matching -------------------------------------------------------------

test('the decoy is a near match and is not owned', () => {
  const { owned, nearMatches } = matchCustomers([atIronwood(), decoy, stranger], deceased);
  assert.deepEqual(owned.map((r) => r.customerId), ['i-1']);
  assert.deepEqual(nearMatches.map((n) => n.record.customerId), ['i-2']);
  assert.match(nearMatches[0].reason, /Daniela Reyes/);
  assert.match(nearMatches[0].reason, /email/);
});

test('ownership is the email, trimmed and lowercased, not the name', () => {
  const renamed: CustomerRecord = { customerId: 'x', fullName: 'D. Reyes', email: 'daniel.reyes@example.com', items: [] };
  const sameName: CustomerRecord = { customerId: 'y', fullName: 'daniel reyes', email: 'other@example.com', items: [] };
  const { owned, nearMatches } = matchCustomers([atLumen(), renamed, sameName], { ...deceased, emails: [' DANIEL.reyes@example.com'] });
  assert.deepEqual(owned.map((r) => r.customerId), ['l-1', 'x']);
  assert.deepEqual(nearMatches.map((n) => n.record.customerId), ['y']);
  assert.match(nearMatches[0].reason, /email/);
});

// ---- buildItems -----------------------------------------------------------

test('buildItems copies the records and adds code-computed refundable amounts', () => {
  const record = atIronwood();
  const [membership, locker, invoice] = buildItems(MERCHANTS.ironwood, [record], DOD, new Map([['CAP-M2', 1000]]));

  assert.equal(membership.id, 'iron-1');
  assert.equal(membership.merchant, 'ironwood');
  assert.equal(membership.liveStatus, 'unknown');
  assert.deepEqual(membership.refs, {});
  assert.equal(membership.planId, 'P-IRON');
  assert.equal(membership.cadence, 'month');
  // 18 of 30 days left: 3900 * 18 / 30 = 2340; the later period is full minus the 10.00 already refunded
  assert.deepEqual(membership.charges.map((c) => c.refundable), ['23.40', '29.00']);

  assert.deepEqual(locker.charges, [{ ...record.items[1].charges[0], refundable: '36.16' }]);
  assert.equal(locker.paypalId, 'CAP-L1');
  assert.deepEqual(invoice.charges, []);
  assert.deepEqual(invoice.refs, {});
  assert.equal(invoice.decided, undefined);

  assert.equal('refundable' in record.items[0].charges[0], false, 'the merchant record is not changed');
  assert.deepEqual(buildItems(MERCHANTS.lumen, [atLumen()], DOD, new Map())[0].charges.map((c) => c.refundable), ['0.00', '17.99']);
  assert.deepEqual(buildItems(MERCHANTS.ironwood, [], DOD, new Map()), []);
});

// ---- validatePlan ---------------------------------------------------------

test('a valid plan gives one decision per item with code-computed refund amounts', () => {
  const { decisions, errors } = validatePlan(rows(), items(), MERCHANTS);
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.fromEntries(decisions), {
    'lumen-1': { action: 'take_over', refunds: [{ captureId: 'CAP-B', amount: '17.99' }] },
    'iron-1': { action: 'close', refunds: [{ captureId: 'CAP-M1', amount: '23.40' }, { captureId: 'CAP-M2', amount: '39.00' }] },
    'iron-2': { action: 'refund', refunds: [{ captureId: 'CAP-L1', amount: '36.16' }] },
    'iron-3': { action: 'waive', refunds: [] },
  });
});

test('validatePlan replaces an amount supplied by the model', () => {
  const fromModel = { item_id: 'iron-2', action: 'refund', refund_capture_ids: ['CAP-L1', 'CAP-L1'], reason: '', amount: '120.00', refunds: [{ captureId: 'CAP-L1', amount: '120.00' }] } as PlanRow;
  const { decisions, errors } = validatePlan(rows().map((r) => (r.item_id === 'iron-2' ? fromModel : r)), items(), MERCHANTS);
  assert.deepEqual(errors, []);
  assert.deepEqual(decisions.get('iron-2'), { action: 'refund', refunds: [{ captureId: 'CAP-L1', amount: '36.16' }] });
});

/** One changed row must give exactly one error that names the item, and no decision for it. */
function rejects(plan: PlanRow[], itemId: string, message: RegExp, list = items()) {
  const { decisions, errors } = validatePlan(plan, list, MERCHANTS);
  assert.equal(errors.length, 1, errors.join(' | '));
  assert.ok(errors[0].includes(itemId), errors[0]);
  assert.match(errors[0], message);
  assert.equal(decisions.has(itemId), false);
}

test('validatePlan rejects an unknown item id', () => {
  rejects([...rows(), { item_id: 'ghost-9', action: 'close', refund_capture_ids: [], reason: '' }], 'ghost-9', /no item/i);
});

test('validatePlan rejects an action that does not fit the kind of item', () => {
  rejects(withRow('iron-3', { action: 'close' }), 'iron-3', /pay_from_estate/);
  rejects(withRow('iron-2', { action: 'pause', refund_capture_ids: [] }), 'iron-2', /leave/);
  rejects(withRow('iron-3', { action: 'cancel' as Action }), 'iron-3', /cancel/);
});

test('validatePlan rejects take-over where the merchant does not allow it', () => {
  rejects(withRow('iron-1', { action: 'take_over' }), 'iron-1', /take.over/i);
});

test('validatePlan rejects a waiver where the merchant does not waive', () => {
  const invoice: CustomerRecord = { ...atLumen(), items: [{ id: 'lumen-9', kind: 'invoice', label: 'Rental', paypalId: 'INV2-9', amount: '5.00', charges: [] }] };
  const list = buildItems(MERCHANTS.lumen, [invoice], DOD, new Map());
  rejects([{ item_id: 'lumen-9', action: 'waive', refund_capture_ids: [], reason: '' }], 'lumen-9', /waive/i, list);
  assert.deepEqual(validatePlan([{ item_id: 'lumen-9', action: 'pay_from_estate', refund_capture_ids: [], reason: '' }], list, MERCHANTS).errors, []);
});

test('validatePlan rejects a capture that is not on the item', () => {
  rejects(withRow('iron-2', { refund_capture_ids: ['CAP-B'] }), 'iron-2', /CAP-B/);
});

test('validatePlan rejects a capture with nothing refundable', () => {
  rejects(withRow('lumen-1', { refund_capture_ids: ['CAP-A'] }), 'lumen-1', /CAP-A/);
});

test('validatePlan rejects a refund action without captures, and accepts leave without any', () => {
  rejects(withRow('iron-2', { refund_capture_ids: [] }), 'iron-2', /refund_capture_ids/);
  assert.deepEqual(validatePlan(withRow('iron-2', { action: 'leave', refund_capture_ids: [] }), items(), MERCHANTS).errors, []);
});

test('validatePlan allows refunds only alongside close, take_over and refund', () => {
  rejects(withRow('iron-2', { action: 'leave' }), 'iron-2', /refund/);
  rejects(withRow('iron-1', { action: 'pause' }), 'iron-1', /refund/);
  assert.deepEqual(validatePlan(withRow('iron-1', { action: 'pause', refund_capture_ids: [] }), items(), MERCHANTS).errors, []);
});

test('validatePlan rejects an item without a row', () => {
  rejects(rows().slice(1), 'lumen-1', /no row/i);
});

test('validatePlan rejects two rows for one item', () => {
  rejects([...rows(), { item_id: 'lumen-1', action: 'close', refund_capture_ids: [], reason: '' }], 'lumen-1', /one row/i);
});

// ---- guard ----------------------------------------------------------------

test('guard denies any target that is not in this case, read tools included', () => {
  for (const tool of [...READS, ...ANY_TIER, 'cancel_subscription', 'create_subscription', 'cancel_sent_invoice']) {
    denies(call(tool, 'I-DECOY', undefined), /not this customer's/);
  }
  denies(call('create_refund', 'CAP-DECOY', undefined, { amountCents: 1 }), /not this customer's/);
});

test("guard denies an item that belongs to another merchant's desk", () => {
  denies(call('suspend_subscription', 'I-LUM1', approved()['lumen-1'], { merchant: MERCHANTS.ironwood }), /not this customer's/);
});

test('guard denies a tool it does not know', () => {
  denies(call('delete_subscription', 'I-SUB1', approved()['iron-1']), /delete_subscription/);
});

test('guard allows read tools and reversible writes in the filed tier', () => {
  const it = approved();
  for (const tool of ['show_subscription_details', 'suspend_subscription', 'activate_subscription']) allows(call(tool, 'I-SUB1', it['iron-1'], FILED));
  for (const tool of ['get_invoice', 'cancel_invoice_auto_reminder', 'generate_invoice_qr_code']) allows(call(tool, 'INV2-1', it['iron-3'], FILED));
  allows(call('get_order', 'ORDER-1', it['iron-2'], FILED));
  allows(call('get_refund', 'REFUND-1', it['iron-2'], FILED));
});

test('guard denies irreversible writes until the notice is verified', () => {
  const it = approved();
  const c = makeCase({ tier: 'filed' }); // approved but not verified
  denies(call('cancel_subscription', 'I-SUB1', it['iron-1'], { c }), /verified/);
  denies(call('create_subscription', 'P-LUM', it['lumen-1'], { c }), /verified/);
  denies(call('cancel_sent_invoice', 'INV2-1', it['iron-3'], { c }), /verified/);
  denies(call('create_refund', 'CAP-L1', it['iron-2'], { c, amountCents: 3616 }), /verified/);
});

test('guard denies irreversible writes until the plan is approved', () => {
  const it = approved();
  const c = makeCase({ approvedAt: undefined });
  denies(call('cancel_subscription', 'I-SUB1', it['iron-1'], { c }), /approve/);
  denies(call('create_subscription', 'P-LUM', it['lumen-1'], { c }), /approve/);
  denies(call('cancel_sent_invoice', 'INV2-1', it['iron-3'], { c }), /approve/);
  denies(call('create_refund', 'CAP-L1', it['iron-2'], { c, amountCents: 3616 }), /approve/);
});

test('guard: cancel_subscription needs an approved close', () => {
  const it = approved();
  allows(call('cancel_subscription', 'I-SUB1', it['iron-1']));
  denies(call('cancel_subscription', 'I-LUM1', it['lumen-1']), /close/);
  denies(call('cancel_subscription', 'I-SUB1', { ...it['iron-1'], decided: undefined }), /close/);
});

test('guard: create_subscription needs an approved take_over', () => {
  const it = approved();
  allows(call('create_subscription', 'P-LUM', it['lumen-1']));
  denies(call('create_subscription', 'P-IRON', it['iron-1']), /take_over/);
});

test('guard: cancel_sent_invoice needs an approved waive', () => {
  const it = approved();
  allows(call('cancel_sent_invoice', 'INV2-1', it['iron-3']));
  denies(call('cancel_sent_invoice', 'INV2-1', { ...it['iron-3'], decided: { action: 'pay_from_estate', refunds: [] } }), /waive/);
});

test('guard: create_refund needs an approved line for that capture', () => {
  const it = approved();
  denies(call('create_refund', 'CAP-A', it['lumen-1'], { amountCents: 1 }), /CAP-A/); // on the item, not in the plan
  denies(call('create_refund', 'CAP-M1', it['iron-2'], { amountCents: 1 }), /CAP-M1/); // another item's capture
  denies(call('create_refund', 'CAP-L1', { ...it['iron-2'], decided: { action: 'leave', refunds: [] } }, { amountCents: 1 }), /CAP-L1/);
  denies(call('create_refund', 'CAP-L1', { ...it['iron-2'], decided: undefined }, { amountCents: 1 }), /CAP-L1/);
});

test('guard: create_refund never goes above the approved amount', () => {
  const locker = approved()['iron-2'];
  allows(call('create_refund', 'CAP-L1', locker, { amountCents: 3616 }));
  allows(call('create_refund', 'CAP-L1', locker, { amountCents: 100 }));
  denies(call('create_refund', 'CAP-L1', locker, { amountCents: 3617 }), /36\.16/);
  denies(call('create_refund', 'CAP-L1', locker, { amountCents: 12000 }), /36\.16/);
  denies(call('create_refund', 'CAP-L1', locker), /36\.16/); // no amount would mean a full refund at PayPal
  denies(call('create_refund', 'CAP-L1', locker, { amountCents: NaN }), /36\.16/);
  denies(call('create_refund', 'CAP-L1', locker, { amountCents: 0 }), /36\.16/);
  denies(call('create_refund', 'CAP-L1', locker, { amountCents: -5 }), /36\.16/);
});

test('guard denies a second identical irreversible call', () => {
  const it = approved();
  const done = new Set<string>();
  const refund = call('create_refund', 'CAP-L1', it['iron-2'], { amountCents: 3616, done });
  allows(refund);
  done.add('create_refund:CAP-L1'); // the desk records a call that went through
  denies(refund, /already done/);
  denies(call('create_refund', 'CAP-L1', it['iron-2'], { amountCents: 1, done }), /already done/);
  allows(call('create_refund', 'CAP-M1', it['iron-1'], { amountCents: 2340, done })); // another capture is unaffected

  denies(call('cancel_subscription', 'I-SUB1', it['iron-1'], { done: new Set(['cancel_subscription:I-SUB1']) }), /already done/);
  denies(call('create_subscription', 'P-LUM', it['lumen-1'], { done: new Set(['create_subscription:P-LUM']) }), /already done/);
  denies(call('cancel_sent_invoice', 'INV2-1', it['iron-3'], { done: new Set(['cancel_sent_invoice:INV2-1']) }), /already done/);
});

test('guard lets a reversible write repeat, so pause, resume, pause works', () => {
  const sub = approved()['iron-1'];
  const done = new Set(['suspend_subscription:I-SUB1', 'activate_subscription:I-SUB1']);
  allows(call('suspend_subscription', 'I-SUB1', sub, { ...FILED, done }));
  allows(call('activate_subscription', 'I-SUB1', sub, { ...FILED, done }));
});
