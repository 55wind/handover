import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Case, Item, ItemKind, MerchantSlug, ToolResult } from './types';

// The fake backend must be chosen before any project module loads, so those are imported in `before`.
process.env.PAYPAL_FAKE = '1';
let desk: typeof import('./desk');
let seed: typeof import('./seed');
let fake: typeof import('./paypal-fake');
let store: typeof import('./store').store;
before(async () => {
  desk = await import('./desk');
  seed = await import('./seed');
  fake = await import('./paypal-fake');
  store = (await import('./store')).store;
});

// ---- helpers --------------------------------------------------------------

async function demo(): Promise<Case> {
  const c = await seed.seedDemoCase();
  c.items = desk.inventory(c).items;
  return c;
}
function approve(c: Case) {
  c.tier = 'verified';
  c.approvedAt = new Date().toISOString();
}
const pick = (c: Case, merchant: MerchantSlug, kind: ItemKind): Item => c.items.find((i) => i.merchant === merchant && i.kind === kind)!;
const call = (c: Case, slug: MerchantSlug, tool: string, args: Record<string, unknown>) => desk.deskFor(slug).callTool(tool, args, c.id);
const data = (r: ToolResult) => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return r.data as any;
};
const denied = (r: ToolResult, pattern?: RegExp) => {
  assert.ok(!r.ok && r.denied, `expected a denial, got ${JSON.stringify(r)}`);
  if (pattern) assert.match(r.error, pattern);
};
const refundables = (i: Item) => i.charges.map((ch) => ch.refundable);

// ---- seeding and inventory ------------------------------------------------

test('the seeded estate is five items at three merchants, with refundable amounts worked out by code', async () => {
  const c = await demo();
  assert.equal(c.items.length, 5);
  assert.deepEqual(new Set(c.items.map((i) => i.merchant)), new Set(['lumen', 'ironwood', 'harborlight']));
  assert.deepEqual(refundables(pick(c, 'lumen', 'subscription')), ['0.00', '17.99']);
  assert.deepEqual(refundables(pick(c, 'ironwood', 'subscription')), ['32.50']);
  assert.deepEqual(refundables(pick(c, 'ironwood', 'charge')), ['36.16']);
  assert.deepEqual(refundables(pick(c, 'ironwood', 'invoice')), []);
  assert.deepEqual(refundables(pick(c, 'harborlight', 'subscription')), ['0.00', '25.00']);

  assert.equal(c.tier, 'filed');
  assert.equal(c.demo, true);
  assert.equal(store.cases.get(c.id), c);
  assert.match(c.id, /^[\w-]{12}$/);
  assert.match(c.document.text!, /^NOTICE OF DEATH \(sample for demonstration\)\nDaniel A\. Reyes of Portland, aged 71, died peacefully on [A-Z][a-z]+ \d{1,2}, \d{4}\./);
  for (const i of c.items) assert.equal(await desk.readLiveStatus(i), i.kind === 'subscription' ? 'ACTIVE' : i.kind === 'invoice' ? 'SENT' : 'COMPLETED');
});

test('the decoy is a near match, is added once, and nothing resolves to it', async () => {
  await demo();
  const c = await demo();
  const { nearMatches } = desk.inventory(c);
  assert.deepEqual(nearMatches.map((n) => [n.merchant, n.fullName, n.email]), [['ironwood', 'Daniela Reyes', 'daniela.reyes@example.com']]);
  assert.equal(store.records.get('ironwood')!.filter((r) => r.fullName === 'Daniela Reyes').length, 1);

  const decoy = store.records.get('ironwood')!.find((r) => r.fullName === 'Daniela Reyes')!;
  for (const id of [decoy.customerId, decoy.email, decoy.fullName, '']) assert.equal(desk.findItem(c, id), undefined);

  const found = data(await call(c, 'ironwood', 'find_customer_records', {}));
  assert.deepEqual(found.customers.map((x: { full_name: string }) => x.full_name), ['Daniel Reyes']);
  assert.equal(found.customers[0].items.length, 3);
  assert.equal(found.customers[0].items.find((i: { kind: string }) => i.kind === 'charge').charges[0].refundable, '36.16');
  assert.deepEqual(found.near_matches.map((n: { full_name: string }) => n.full_name), ['Daniela Reyes']);
  // Each desk shows only its own merchant.
  assert.equal(data(await call(c, 'lumen', 'find_customer_records', {})).customers[0].items.length, 1);
  assert.match(data(await call(c, 'lumen', 'get_policy', {})).summary, /take over/);
});

test('findItem resolves a subscription, plan, capture and order id to the item', async () => {
  const c = await demo();
  const sub = pick(c, 'lumen', 'subscription');
  for (const id of [sub.paypalId, sub.planId!, sub.charges[1].captureId, sub.charges[1].orderId!]) assert.equal(desk.findItem(c, id), sub);
});

// ---- tool lists -----------------------------------------------------------

test('each phase lists its own tools, with the toolkit schemas', () => {
  const names = (phase: Parameters<ReturnType<typeof desk.deskFor>['listTools']>[0]) => desk.deskFor('lumen').listTools(phase).map((t) => t.name);
  const read = ['find_customer_records', 'get_policy', 'show_subscription_details', 'get_invoice', 'get_order', 'get_refund'];
  assert.deepEqual(names('intake'), []);
  assert.deepEqual(names('plan'), read);
  assert.deepEqual(names('pause'), [...read, 'suspend_subscription']);
  assert.deepEqual(names('resume'), [...read, 'activate_subscription']);
  assert.deepEqual(names('execute'), [...read, 'suspend_subscription', 'cancel_subscription', 'create_refund', 'cancel_invoice_auto_reminder', 'cancel_sent_invoice', 'create_subscription', 'generate_invoice_qr_code']);

  const tools = desk.deskFor('lumen').listTools('execute');
  for (const t of tools) {
    assert.equal(t.write, !read.includes(t.name), t.name);
    assert.ok(t.description, t.name);
    assert.equal(t.parameters.type, 'object', t.name);
    assert.doesNotMatch(JSON.stringify(t.parameters), /"\$(schema|ref)"/, t.name);
  }
  const props = (name: string) => Object.keys(tools.find((t) => t.name === name)!.parameters.properties as object);
  assert.deepEqual(props('create_subscription'), ['plan_id']);
  assert.deepEqual(props('create_refund'), ['capture_id', 'amount', 'invoice_id', 'note_to_payer']);
  assert.deepEqual(props('get_order'), ['id']);
  assert.deepEqual(props('find_customer_records'), []);
});

test('targetOf names the PayPal id each tool acts on', () => {
  assert.deepEqual(desk.targetOf('show_subscription_details', { subscription_id: 'I-1' }), { targetId: 'I-1' });
  assert.deepEqual(desk.targetOf('get_order', { id: 'O1' }), { targetId: 'O1' });
  assert.deepEqual(desk.targetOf('get_refund', { refund_id: 'R1' }), { targetId: 'R1' });
  assert.deepEqual(desk.targetOf('create_subscription', { plan_id: 'P-1' }), { targetId: 'P-1' });
  assert.deepEqual(desk.targetOf('cancel_sent_invoice', { invoice_id: 'INV2-1' }), { targetId: 'INV2-1' });
  assert.deepEqual(desk.targetOf('create_refund', { capture_id: 'C1', invoice_id: 'X', amount: { currency_code: 'USD', value: '36.16' } }), { targetId: 'C1', amountCents: 3616 });
  assert.deepEqual(desk.targetOf('create_refund', { capture_id: 'C1' }), { targetId: 'C1' });
  assert.equal(desk.targetOf('find_customer_records', {}), null);
  assert.equal(desk.targetOf('nonsense', { id: 'x' }), null);
});

// ---- the guard in front of PayPal -----------------------------------------

test('an unknown case, an unknown tool, and a tool outside the running phase are refused', async () => {
  const c = await demo();
  const sub = pick(c, 'lumen', 'subscription');
  denied(await desk.deskFor('lumen').callTool('get_policy', {}, 'no-such-case'));
  denied(await call(c, 'lumen', 'delete_invoice', { invoice_id: 'INV2-1' }));
  c.running = 'plan';
  denied(await call(c, 'lumen', 'suspend_subscription', { subscription_id: sub.paypalId, reason: 'x' }));
  assert.equal(await desk.readLiveStatus(sub), 'ACTIVE');
  c.running = null;
  const missing = await call(c, 'lumen', 'show_subscription_details', {});
  assert.ok(!missing.ok && !missing.denied);
});

test('reading an id this case does not own is denied', async () => {
  const other = await demo();
  const c = await demo();
  const theirs = pick(other, 'lumen', 'subscription');
  denied(await call(c, 'lumen', 'show_subscription_details', { subscription_id: theirs.paypalId }), /not this customer's/);
  denied(await call(c, 'lumen', 'get_order', { id: theirs.charges[0].orderId }), /not this customer's/);
  // The case's own item, but at another merchant's desk.
  denied(await call(c, 'ironwood', 'show_subscription_details', { subscription_id: pick(c, 'lumen', 'subscription').paypalId }), /not this customer's/);

  const last = c.events.at(-1)!;
  assert.equal(last.actor, 'guard');
  assert.equal(last.type, 'denied');
  assert.ok(store.ledger.get('lumen')!.some((e) => e.caseId === c.id && e.denied && e.target === theirs.paypalId));

  const own = pick(c, 'lumen', 'subscription');
  assert.equal(data(await call(c, 'lumen', 'show_subscription_details', { subscription_id: own.paypalId })).status, 'ACTIVE');
  assert.equal(c.events.at(-1)!.summary, `Lumen Stream: read subscription ${own.paypalId}, status ACTIVE.`);
});

test('a filed notice can pause and resume, and nothing else', async () => {
  const c = await demo();
  const sub = pick(c, 'ironwood', 'subscription');
  const invoice = pick(c, 'ironwood', 'invoice');
  sub.decided = { action: 'close', refunds: [] };
  invoice.decided = { action: 'waive', refunds: [] };
  denied(await call(c, 'ironwood', 'cancel_subscription', { subscription_id: sub.paypalId, payload: { reason: 'x' } }), /verified/);
  denied(await call(c, 'ironwood', 'cancel_sent_invoice', { invoice_id: invoice.paypalId }), /verified/);
  denied(await call(c, 'ironwood', 'create_refund', { capture_id: sub.charges[0].captureId }), /verified/);
  c.tier = 'verified'; // verified but not yet approved
  denied(await call(c, 'ironwood', 'cancel_subscription', { subscription_id: sub.paypalId, payload: { reason: 'x' } }), /approved/);
  c.tier = 'filed';
  assert.equal(await desk.readLiveStatus(sub), 'ACTIVE');

  data(await call(c, 'ironwood', 'suspend_subscription', { subscription_id: sub.paypalId, reason: 'Notice of death filed' }));
  assert.equal(await desk.verifyOutcome(sub, 'SUSPENDED'), true);
  assert.equal(sub.liveStatus, 'SUSPENDED');
  assert.equal(await desk.verifyOutcome(sub, 'ACTIVE'), false);

  data(await call(c, 'ironwood', 'activate_subscription', { subscription_id: sub.paypalId, reason: 'Pause lifted' }));
  assert.equal(await desk.verifyOutcome(sub, 'ACTIVE'), true);
  // Pause, resume, pause again must work.
  data(await call(c, 'ironwood', 'suspend_subscription', { subscription_id: sub.paypalId, reason: 'Paused again' }));
  assert.equal(await desk.readLiveStatus(sub), 'SUSPENDED');
  assert.ok(store.doneFor(c.id).has(`suspend_subscription:${sub.paypalId}`));
});

// ---- carrying out an approved plan ----------------------------------------

test('a refund sends the approved amount whatever the model asks for, is verified, and runs once', async () => {
  const c = await demo();
  const locker = pick(c, 'ironwood', 'charge');
  const captureId = locker.paypalId;
  locker.decided = { action: 'refund', refunds: [{ captureId, amount: '36.16' }] };
  approve(c);
  assert.equal(await desk.verifyOutcome(locker), false); // approved, not yet done

  const refund = data(await call(c, 'ironwood', 'create_refund', { capture_id: captureId, amount: { currency_code: 'USD', value: '120.00' } }));
  assert.equal(refund.amount.value, '36.16');
  assert.equal(refund.status, 'COMPLETED');
  assert.equal(locker.refs[`refund:${captureId}`], refund.id);
  assert.equal(store.refunded.get(captureId), 3616);
  assert.equal(desk.findItem(c, refund.id), locker);
  assert.equal(c.events.at(-1)!.summary, `Ironwood Gym: refunded $36.16 on capture ${captureId} to the payment method that paid, refund ${refund.id}.`);
  assert.deepEqual((c.events.at(-1)!.detail as { args: unknown }).args, { capture_id: captureId, amount: { currency_code: 'USD', value: '36.16' } });

  assert.equal(await desk.verifyOutcome(locker), true);
  assert.equal(locker.liveStatus, 'PARTIALLY_REFUNDED');
  assert.equal(data(await call(c, 'ironwood', 'get_refund', { refund_id: refund.id })).status, 'COMPLETED');

  denied(await call(c, 'ironwood', 'create_refund', { capture_id: captureId }), /already done/);
  assert.equal(store.refunded.get(captureId), 3616);
  const entries = store.ledger.get('ironwood')!.filter((e) => e.caseId === c.id && e.tool === 'create_refund');
  assert.deepEqual(entries.map((e) => [e.ok, e.denied]), [[true, false], [false, true]]);
  // What is left on file for the capture is now nothing.
  assert.equal(pick({ ...c, items: desk.inventory(c).items }, 'ironwood', 'charge').charges[0].refundable, '0.00');
});

test('two identical refund calls made at the same moment refund once', async () => {
  const c = await demo();
  const locker = pick(c, 'ironwood', 'charge');
  locker.decided = { action: 'refund', refunds: [{ captureId: locker.paypalId, amount: '36.16' }] };
  approve(c);
  const both = await Promise.all([1, 2].map(() => call(c, 'ironwood', 'create_refund', { capture_id: locker.paypalId })));
  assert.deepEqual(both.map((r) => r.ok), [true, false]);
  denied(both[1], /already done/);
  assert.equal(store.refunded.get(locker.paypalId), 3616);
  assert.equal(await desk.verifyOutcome(locker), true);
});

test('a refund the plan does not contain is denied and never reaches PayPal', async () => {
  const c = await demo();
  const sub = pick(c, 'lumen', 'subscription');
  const [current, later] = sub.charges;
  sub.decided = { action: 'take_over', refunds: [{ captureId: later.captureId, amount: later.refundable }] };
  approve(c);
  denied(await call(c, 'lumen', 'create_refund', { capture_id: current.captureId, amount: { currency_code: 'USD', value: '17.99' } }), /no refund for capture/);
  assert.equal(store.refunded.has(current.captureId), false);
  const order = data(await call(c, 'lumen', 'get_order', { id: current.orderId }));
  assert.equal(order.purchase_units[0].payments.captures[0].status, 'COMPLETED');
});

test('a failure at PayPal comes back as an error, not a denial, and other calls go on', async () => {
  const c = await demo();
  const sub = pick(c, 'ironwood', 'subscription');
  const captureId = sub.charges[0].captureId;
  sub.decided = { action: 'close', refunds: [{ captureId, amount: '32.50' }] };
  approve(c);

  fake.failNext('create_refund', 'The capture has already been fully refunded.');
  const failed = await call(c, 'ironwood', 'create_refund', { capture_id: captureId });
  assert.deepEqual(failed, { ok: false, denied: false, error: 'The capture has already been fully refunded.' });
  assert.match(c.events.at(-1)!.summary, /^Ironwood Gym: create_refund on \S+ failed\. PayPal said: The capture has already been fully refunded\.$/);
  assert.ok(store.ledger.get('ironwood')!.some((e) => e.caseId === c.id && e.tool === 'create_refund' && !e.ok && !e.denied));
  assert.equal(store.refunded.has(captureId), false);
  assert.equal(sub.refs[`refund:${captureId}`], undefined);

  // The cancellation still goes through, and the item is not verified because the refund is missing.
  assert.equal(data(await call(c, 'ironwood', 'cancel_subscription', { subscription_id: sub.paypalId, payload: { reason: 'Deceased' } })), '');
  assert.equal(await desk.verifyOutcome(sub), false);
  assert.equal(sub.liveStatus, 'CANCELLED');
  // A failed call is not "done": the refund can be tried again, the cancellation cannot.
  assert.equal(data(await call(c, 'ironwood', 'create_refund', { capture_id: captureId })).amount.value, '32.50');
  assert.equal(await desk.verifyOutcome(sub), true);
  denied(await call(c, 'ironwood', 'cancel_subscription', { subscription_id: sub.paypalId, payload: { reason: 'Deceased' } }), /already done/);
});

test('a take-over creates the replacement for the representative on the same plan', async () => {
  const c = await demo();
  const sub = pick(c, 'harborlight', 'subscription');
  sub.decided = { action: 'take_over', refunds: [] };
  approve(c);
  // Ironwood does not hold this plan; and a membership that is to be closed cannot be taken over.
  denied(await call(c, 'ironwood', 'create_subscription', { plan_id: sub.planId }), /not this customer's/);
  const membership = pick(c, 'ironwood', 'subscription');
  membership.decided = { action: 'close', refunds: [] };
  denied(await call(c, 'ironwood', 'create_subscription', { plan_id: membership.planId }), /take_over/);

  const created = data(await call(c, 'harborlight', 'create_subscription', { plan_id: sub.planId, subscriber: { email_address: 'someone.else@example.com' } }));
  assert.equal(created.status, 'APPROVAL_PENDING');
  assert.equal(created.plan_id, sub.planId);
  assert.deepEqual(created.subscriber, { name: { given_name: 'Maria', surname: 'Reyes' }, email_address: c.representative.email });
  assert.equal(sub.refs.newSubscriptionId, created.id);
  assert.equal(sub.refs.approveLink, created.links[0].href);
  const sent = (c.events.at(-1)!.detail as { args: { application_context: Record<string, string> } }).args.application_context;
  assert.deepEqual(sent, { brand_name: 'Harbor Light Food Bank', user_action: 'SUBSCRIBE_NOW', return_url: `http://localhost:3000/case/${c.id}`, cancel_url: `http://localhost:3000/case/${c.id}` });

  assert.equal(await desk.verifyOutcome(sub), false); // the old subscription is still active
  data(await call(c, 'harborlight', 'suspend_subscription', { subscription_id: sub.paypalId, reason: 'Taken over by the family' }));
  assert.equal(await desk.verifyOutcome(sub), true);
  denied(await call(c, 'harborlight', 'create_subscription', { plan_id: sub.paypalId }), /already done/); // same plan under another of the item's ids
});

test('an invoice can be waived, or kept with a link to pay it', async () => {
  const c = await demo();
  const invoice = pick(c, 'ironwood', 'invoice');
  invoice.decided = { action: 'pay_from_estate', refunds: [] };
  approve(c);
  assert.equal(await desk.verifyOutcome(invoice), false);
  denied(await call(c, 'ironwood', 'cancel_sent_invoice', { invoice_id: invoice.paypalId }), /waive/);
  const code = data(await call(c, 'ironwood', 'generate_invoice_qr_code', { invoice_id: invoice.paypalId }));
  assert.equal(code.pay_link, invoice.refs.payLink);
  assert.match(invoice.refs.payLink, /^https:\/\//);
  assert.equal(await desk.verifyOutcome(invoice), true);

  invoice.decided = { action: 'waive', refunds: [] };
  assert.equal(await desk.verifyOutcome(invoice), false);
  data(await call(c, 'ironwood', 'cancel_invoice_auto_reminder', { invoice_id: invoice.paypalId }));
  data(await call(c, 'ironwood', 'cancel_sent_invoice', { invoice_id: invoice.paypalId, send_to_recipient: true, additional_recipients: ['x@example.com'] }));
  assert.deepEqual((c.events.at(-1)!.detail as { args: unknown }).args, { invoice_id: invoice.paypalId, send_to_recipient: false });
  assert.equal(await desk.verifyOutcome(invoice), true);
  assert.equal(invoice.liveStatus, 'CANCELLED');
});

test('probe reports each primitive', async () => {
  assert.deepEqual(await seed.probe('lumen'), { invoice: 'ok', 'card order': 'ok', 'card subscription': 'ok' });
});
