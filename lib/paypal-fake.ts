// Development and tests only (PAYPAL_FAKE=1). Nothing in this file talks to PayPal or moves money.
import { randomBytes } from 'node:crypto';
import type { Backend, OrderView } from './types';

/** Demo wallets for the development approval page. `id` is the fake payer id. */
export const WALLETS: { id: string; name: string; country: string }[] = [
  { id: 'FAKEPAYERCA01', name: 'Ji-woo', country: 'CA' },
  { id: 'FAKEPAYERDE01', name: 'Tunde', country: 'DE' },
  { id: 'FAKEPAYERUS01', name: 'Sofía', country: 'US' },
  { id: 'FAKEPAYERKR01', name: 'Min-jun', country: 'KR' },
];

interface Order {
  view: OrderView;
  returnUrl: string;
  cancelUrl: string;
}
interface State {
  orders: Map<string, Order>;
  fail: Map<string, string>;
  lose: Map<string, string>;
}

// On globalThis so orders survive Next.js hot reloads.
const g = globalThis as { __fairHourFake?: State };
const s: State = (g.__fairHourFake ??= { orders: new Map(), fail: new Map(), lose: new Map() });
s.lose ??= new Map(); // state kept from before a hot reload may lack it

const rid = () => Array.from(randomBytes(17), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

// Messages read the way the real backend reports PayPal errors: "<message>: <detail>".
const notFound = () =>
  new Error('The specified resource does not exist.: Specified resource ID does not exist. Please check the resource ID and try again.');
const refused = (detail: string) =>
  new Error(`The requested action could not be performed, semantically incorrect, or failed business validation.: ${detail}`);

function order(orderId: string): Order {
  const o = s.orders.get(orderId);
  if (!o) throw notFound();
  return o;
}
/** The order that holds this authorization or capture. */
function holding(key: 'authorizationId' | 'captureId', id: string): OrderView {
  for (const o of s.orders.values()) if (o.view[key] === id) return o.view;
  throw notFound();
}
function trip(method: keyof Backend, from: Map<string, string> = s.fail): void {
  const message = from.get(method);
  if (message === undefined) return;
  from.delete(method);
  throw new Error(message);
}

/** Test hook: the next call of this method throws this message, as if PayPal had refused. */
export function failNext(method: keyof Backend, message: string): void {
  s.fail.set(method, message);
}

/** Test hook: the next capture goes through at PayPal, but the caller gets this error instead of the answer. */
export function loseNextAnswer(method: 'captureAuthorization', message: string): void {
  s.lose.set(method, message);
}

/** Stands in for the buyer approving at PayPal with this wallet. Returns where PayPal would send the browser next. */
export function approve(orderId: string, walletId: string): string {
  const o = order(orderId);
  const wallet = WALLETS.find((w) => w.id === walletId);
  if (!wallet) throw new Error(`Unknown development wallet: ${walletId}`);
  if (o.view.status !== 'PAYER_ACTION_REQUIRED') throw new Error(`Order ${orderId} is not awaiting approval: it is ${o.view.status}.`);
  Object.assign(o.view, { status: 'APPROVED', payerId: wallet.id, payerCountry: wallet.country });
  // Plain string handling: in development the return URL is a path, which `new URL` cannot parse without a base.
  return `${o.returnUrl}${o.returnUrl.includes('?') ? '&' : '?'}token=${orderId}&PayerID=${walletId}`;
}

/** Test hook: payouts made, in order. */
export const payouts: { email: string; amount: string; reference: string }[] = [];

/** Test hook: what was refunded for a capture. */
const refunds = new Map<string, string>();
export const refundedAmount = (captureId: string): string | undefined => refunds.get(captureId);

export const cancelUrlOf = (orderId: string): string | undefined => s.orders.get(orderId)?.cancelUrl;

// ponytail: request ids are ignored, so a repeated capture or refund throws where PayPal would replay its first answer.
// Enough for one settlement per purchase; remember the ids here if retries are ever tested against the fake.
export const fakeBackend: Backend = {
  async createOrder({ amount, returnUrl, cancelUrl }) {
    trip('createOrder');
    const orderId = rid();
    s.orders.set(orderId, { view: { status: 'PAYER_ACTION_REQUIRED', amount }, returnUrl, cancelUrl });
    // A local page plays PayPal's approval screen. A path, so it works on whatever port the app runs on.
    return { orderId, approveUrl: `/api/dev/paypal?order=${orderId}` };
  },

  async getOrder(orderId) {
    trip('getOrder');
    return { ...order(orderId).view }; // a copy, so an earlier answer does not change when the order does
  },

  async authorizeOrder(orderId) {
    trip('authorizeOrder');
    const v = order(orderId).view;
    if (v.status === 'PAYER_ACTION_REQUIRED') throw refused('Payer has not yet approved the Order for payment.');
    // A repeat answers with the same authorization, as PayPal does for the fixed request id "authorize-<orderId>".
    if (v.status === 'APPROVED') Object.assign(v, { status: 'COMPLETED', authorizationId: rid(), authorizationStatus: 'CREATED' });
    return { authorizationId: v.authorizationId!, status: v.authorizationStatus! };
  },

  async captureAuthorization(authorizationId, _requestId, amount) {
    trip('captureAuthorization');
    const v = holding('authorizationId', authorizationId);
    if (v.authorizationStatus === 'VOIDED') throw refused('A voided authorization cannot be captured or reauthorized.');
    if (v.authorizationStatus === 'CAPTURED') throw refused('Authorization has already been captured.');
    if (amount && Number(amount) > Number(v.amount)) throw refused('Capture amount exceeds the authorized amount.');
    // A final capture of part of the hold releases the rest, as PayPal does.
    Object.assign(v, { authorizationStatus: 'CAPTURED', captureId: rid(), captureStatus: 'COMPLETED', capturedAmount: amount ?? v.amount });
    trip('captureAuthorization', s.lose);
    return { captureId: v.captureId!, status: v.captureStatus! };
  },

  async voidAuthorization(authorizationId) {
    trip('voidAuthorization');
    const v = holding('authorizationId', authorizationId);
    if (v.authorizationStatus === 'VOIDED') throw refused('Authorization has been previously voided and hence cannot be voided again.');
    if (v.authorizationStatus === 'CAPTURED') throw refused('Authorization has been previously captured and hence cannot be voided.');
    v.authorizationStatus = 'VOIDED';
  },

  async refundCapture(captureId, _requestId, amount) {
    trip('refundCapture');
    const v = holding('captureId', captureId);
    if (v.captureStatus === 'REFUNDED' || v.captureStatus === 'PARTIALLY_REFUNDED') throw refused('The capture has already been refunded.');
    if (amount && Number(amount) > Number(v.amount)) throw refused('The refund amount must be less than or equal to the capture amount.');
    v.captureStatus = amount && Number(amount) < Number(v.amount) ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
    refunds.set(captureId, amount ?? v.amount ?? '');
    return { refundId: rid(), status: 'COMPLETED' };
  },

  async payout({ email, amount, reference }) {
    trip('payout');
    if (payouts.some((p) => p.reference === reference)) throw refused('Batch with given sender_batch_id already exists.');
    payouts.push({ email, amount, reference });
    return { payoutId: rid(), status: 'SUCCESS' };
  },

  async payoutStatus() {
    trip('payoutStatus');
    return 'SUCCESS';
  },
};
