import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Backend } from './types';

// The fake backend must be chosen before any project module loads, so those are imported in `before`.
process.env.PAYPAL_FAKE = '1';
let pp: Backend;
let fake: typeof import('./paypal-fake');
before(async () => {
  pp = (await import('./paypal')).backend();
  fake = await import('./paypal-fake');
});

const RETURN = 'https://shop.example/api/treats/p1/return';
const CANCEL = 'https://shop.example/purchase/p1?cancelled=1';
const create = (returnUrl = RETURN) => pp.createOrder({ amount: '7.25', description: 'Hand lettering basics', reference: 'p1', returnUrl, cancelUrl: CANCEL });
/** An order approved by the wallet registered in this country. */
async function approved(country = 'CA') {
  const { orderId } = await create();
  fake.approve(orderId, fake.WALLETS.find((w) => w.country === country)!.id);
  return orderId;
}
async function authorized() {
  const orderId = await approved();
  return { orderId, ...(await pp.authorizeOrder(orderId)) };
}

test('the demo wallets a sender can approve as', () => {
  assert.deepEqual(fake.WALLETS.map((w) => `${w.name}/${w.country}`), ['Ji-woo/CA', 'Tunde/DE', 'Sofía/US', 'Min-jun/KR']);
  assert.equal(new Set(fake.WALLETS.map((w) => w.id)).size, fake.WALLETS.length);
});

test('happy path: create, approve as a wallet, authorize, capture', async () => {
  const { orderId, approveUrl } = await create();
  assert.equal(approveUrl, `/api/dev/paypal?order=${orderId}`);
  assert.deepEqual(await pp.getOrder(orderId), { status: 'PAYER_ACTION_REQUIRED', amount: '7.25' });

  fake.approve(orderId, 'FAKEPAYERDE01');
  assert.deepEqual(await pp.getOrder(orderId), { status: 'APPROVED', amount: '7.25', payerId: 'FAKEPAYERDE01', payerCountry: 'DE' });

  const auth = await pp.authorizeOrder(orderId);
  assert.equal(auth.status, 'CREATED');
  const held = await pp.getOrder(orderId);
  assert.equal(held.status, 'COMPLETED');
  assert.equal(held.authorizationId, auth.authorizationId);
  assert.equal(held.authorizationStatus, 'CREATED');
  assert.equal(held.captureId, undefined);

  const cap = await pp.captureAuthorization(auth.authorizationId, 'capture-p1');
  assert.equal(cap.status, 'COMPLETED');
  const done = await pp.getOrder(orderId);
  assert.equal(done.authorizationStatus, 'CAPTURED');
  assert.equal(done.captureId, cap.captureId);
  assert.equal(done.captureStatus, 'COMPLETED');
  assert.equal(done.payerCountry, 'DE');
  assert.equal(held.authorizationStatus, 'CREATED', 'an earlier answer does not change afterwards');
});

test('void path: nothing is captured', async () => {
  const { orderId, authorizationId } = await authorized();
  await pp.voidAuthorization(authorizationId);
  const o = await pp.getOrder(orderId);
  assert.equal(o.authorizationStatus, 'VOIDED');
  assert.equal(o.captureId, undefined);
});

test('refund after capture', async () => {
  const { orderId, authorizationId } = await authorized();
  const { captureId } = await pp.captureAuthorization(authorizationId, 'capture-p1');
  const refund = await pp.refundCapture(captureId, 'refund-p1');
  assert.equal(refund.status, 'COMPLETED');
  assert.ok(refund.refundId);
  assert.equal((await pp.getOrder(orderId)).captureStatus, 'REFUNDED');
});

test('approve returns the return URL with token and PayerID', async () => {
  const { orderId } = await create();
  assert.equal(fake.cancelUrlOf(orderId), CANCEL);
  const next = new URL(fake.approve(orderId, 'FAKEPAYERCA01'));
  assert.equal(next.origin + next.pathname, RETURN);
  assert.equal(next.searchParams.get('token'), orderId);
  assert.equal(next.searchParams.get('PayerID'), 'FAKEPAYERCA01');

  // In development the app passes paths, and a return URL may already carry a query.
  const a = (await create('/api/treats/p1/return')).orderId;
  assert.equal(fake.approve(a, 'FAKEPAYERKR01'), `/api/treats/p1/return?token=${a}&PayerID=FAKEPAYERKR01`);
  const b = (await create('/back?from=paypal')).orderId;
  assert.equal(fake.approve(b, 'FAKEPAYERKR01'), `/back?from=paypal&token=${b}&PayerID=FAKEPAYERKR01`);
});

test('approve refuses an unknown order, an unknown wallet and an order that is not awaiting approval', async () => {
  const { orderId } = await create();
  assert.throws(() => fake.approve('NOSUCHORDER', 'FAKEPAYERCA01'), /does not exist/);
  assert.throws(() => fake.approve(orderId, 'FAKEPAYERXX99'), /Unknown development wallet/);
  assert.equal((await pp.getOrder(orderId)).status, 'PAYER_ACTION_REQUIRED');
  fake.approve(orderId, 'FAKEPAYERCA01');
  assert.throws(() => fake.approve(orderId, 'FAKEPAYERDE01'), /not awaiting approval/);
  assert.equal((await pp.getOrder(orderId)).payerCountry, 'CA', 'the first wallet stays');
  assert.equal(fake.cancelUrlOf('NOSUCHORDER'), undefined);
});

test('an unapproved order cannot be authorized', async () => {
  const { orderId } = await create();
  await assert.rejects(pp.authorizeOrder(orderId), /Payer has not yet approved/);
  assert.equal((await pp.getOrder(orderId)).authorizationId, undefined);
});

test('authorizing again answers with the same authorization', async () => {
  const { orderId, authorizationId } = await authorized();
  assert.equal((await pp.authorizeOrder(orderId)).authorizationId, authorizationId);
});

test('a voided authorization cannot be captured or voided again', async () => {
  const { orderId, authorizationId } = await authorized();
  await pp.voidAuthorization(authorizationId);
  await assert.rejects(pp.captureAuthorization(authorizationId, 'capture-p1'), /voided authorization cannot be captured/);
  await assert.rejects(pp.voidAuthorization(authorizationId), /previously voided/);
  assert.equal((await pp.getOrder(orderId)).captureId, undefined);
});

test('a captured authorization cannot be captured again or voided', async () => {
  const { orderId, authorizationId } = await authorized();
  const { captureId } = await pp.captureAuthorization(authorizationId, 'capture-p1');
  await assert.rejects(pp.captureAuthorization(authorizationId, 'capture-p1-again'), /already been captured/);
  await assert.rejects(pp.voidAuthorization(authorizationId), /previously captured/);
  const o = await pp.getOrder(orderId);
  assert.equal(o.captureId, captureId);
  assert.equal(o.authorizationStatus, 'CAPTURED');
});

test('a capture cannot be refunded twice', async () => {
  const { authorizationId } = await authorized();
  const { captureId } = await pp.captureAuthorization(authorizationId, 'capture-p1');
  await pp.refundCapture(captureId, 'refund-p1');
  await assert.rejects(pp.refundCapture(captureId, 'refund-p1-again'), /already been refunded/);
});

test('a refund can give back part of a capture, and never more than was captured', async () => {
  const { orderId, authorizationId } = await authorized();
  const { captureId } = await pp.captureAuthorization(authorizationId, 'capture-p1');
  const captured = (await pp.getOrder(orderId)).amount!;
  await assert.rejects(pp.refundCapture(captureId, 'refund-too-much', (Number(captured) + 1).toFixed(2)), /less than or equal/);
  await pp.refundCapture(captureId, 'refund-part', '1.00');
  assert.equal((await pp.getOrder(orderId)).captureStatus, 'PARTIALLY_REFUNDED');
});

test('unknown ids are refused the way PayPal refuses them', async () => {
  await assert.rejects(pp.getOrder('NOSUCHORDER'), /does not exist/);
  await assert.rejects(pp.authorizeOrder('NOSUCHORDER'), /does not exist/);
  await assert.rejects(pp.captureAuthorization('NOSUCHAUTH', 'r'), /does not exist/);
  await assert.rejects(pp.voidAuthorization('NOSUCHAUTH'), /does not exist/);
  await assert.rejects(pp.refundCapture('NOSUCHCAPTURE', 'r'), /does not exist/);
});

test('failNext makes the next call of that method fail once, and changes nothing', async () => {
  const { orderId, authorizationId } = await authorized();
  fake.failNext('captureAuthorization', 'PayPal is having a bad day');
  await pp.getOrder(orderId); // other methods are not affected
  await assert.rejects(pp.captureAuthorization(authorizationId, 'capture-p1'), { message: 'PayPal is having a bad day' });
  assert.equal((await pp.getOrder(orderId)).authorizationStatus, 'CREATED');
  assert.equal((await pp.captureAuthorization(authorizationId, 'capture-p1')).status, 'COMPLETED');

  for (const method of ['createOrder', 'getOrder', 'authorizeOrder', 'voidAuthorization', 'refundCapture'] as const) fake.failNext(method, `no ${method}`);
  await assert.rejects(create(), { message: 'no createOrder' });
  await assert.rejects(pp.getOrder(orderId), { message: 'no getOrder' });
  await assert.rejects(pp.authorizeOrder(orderId), { message: 'no authorizeOrder' });
  await assert.rejects(pp.voidAuthorization(authorizationId), { message: 'no voidAuthorization' });
  await assert.rejects(pp.refundCapture('anything', 'r'), { message: 'no refundCapture' });
});

test('part of a hold can be taken, which releases the rest; more than the hold cannot', async () => {
  const { orderId, authorizationId } = await authorized();
  await assert.rejects(pp.captureAuthorization(authorizationId, 'capture-too-much', '99.00'), /exceeds/);
  const { captureId, status } = await pp.captureAuthorization(authorizationId, 'capture-part', '3.10');
  assert.equal(status, 'COMPLETED');
  const o = await pp.getOrder(orderId);
  assert.equal(o.captureId, captureId);
  assert.equal(o.capturedAmount, '3.10');
  assert.equal(o.amount, '7.25');
  assert.equal(o.authorizationStatus, 'CAPTURED', 'nothing more can be taken from this hold');
  await assert.rejects(pp.captureAuthorization(authorizationId, 'capture-again', '1.00'), /already been captured/);
});

test('a payout is recorded once per reference', async () => {
  const before = fake.payouts.length;
  const r = await pp.payout({ email: 'shop@example.test', amount: '3.10', note: 'test', reference: 'treat-x1' });
  assert.equal(r.status, 'SUCCESS');
  await assert.rejects(pp.payout({ email: 'shop@example.test', amount: '3.10', note: 'test', reference: 'treat-x1' }), /already exists/);
  assert.equal(fake.payouts.length, before + 1);
});
