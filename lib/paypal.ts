import { randomUUID } from 'node:crypto';
import type { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { fakeBackend } from './paypal-fake';
import { isFake } from './shops';
import type { Backend, OrderView } from './types';

const BASE = 'https://api-m.sandbox.paypal.com'; // sandbox only: this project never calls live PayPal
const TIMEOUT_MS = 20_000; // a payment step that PayPal does not answer is reported as failed, not waited on for ever

/** fetch that gives up after TIMEOUT_MS, with a message a person can read. */
async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error((e as Error).name === 'TimeoutError' ? `PayPal did not answer within ${TIMEOUT_MS / 1000} seconds.` : `PayPal could not be reached: ${(e as Error).message}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any; // PayPal JSON, read field by field

/** PayPal's error body as one sentence, in the same form the toolkit uses: "<message>: <details>". */
function paypalError(j: Json, status: number): Error {
  const details = (Array.isArray(j?.details) ? j.details : []).map((d: Json) => d?.description || d?.issue).filter(Boolean).join('; ');
  return new Error(`${j?.message || j?.error_description || j?.name || `PayPal answered HTTP ${status}`}${details ? `: ${details}` : ''}`);
}

/** The toolkit never throws: a PayPal failure comes back as JSON `{ok:false, message}` or `{error:{message}}`. Turn that into a throw. */
function toolkitResult(content: unknown): Json {
  let data: Json;
  try {
    data = JSON.parse(String(content));
  } catch {
    throw new Error(`PayPal returned something unreadable: ${String(content).slice(0, 200)}`);
  }
  if (!data || typeof data !== 'object') throw new Error('PayPal returned an empty answer');
  if (data.ok === false || data.error) throw new Error(String(data.message ?? data.error?.message ?? data.error));
  return data;
}

/** Ids go into request paths, and the toolkit does not encode them, so anything that is not a plain id stops here. */
function plain(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Not a PayPal id: ${String(id).slice(0, 40)}`);
  return id;
}

/** The parts of PayPal's order that the pricing rules read. An order that is only approved has no `payments` yet. */
function view(o: Json): OrderView {
  const unit = o.purchase_units?.[0];
  const authorization = unit?.payments?.authorizations?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: o.status,
    amount: unit?.amount?.value,
    // PayPal marks `payer` as deprecated and reports the same details under payment_source.paypal, so that is read first.
    payerId: o.payment_source?.paypal?.account_id ?? o.payer?.payer_id,
    payerCountry: o.payment_source?.paypal?.address?.country_code ?? o.payer?.address?.country_code,
    authorizationId: authorization?.id,
    authorizationStatus: authorization?.status,
    captureId: capture?.id,
    captureStatus: capture?.status,
    capturedAmount: capture?.amount?.value,
  };
}

function realBackend(clientId: string, clientSecret: string): Backend {
  // Loaded on first use: the toolkit takes about two seconds to load, which development and tests on the fake never need.
  async function newToolkit(request_id?: string): Promise<PayPalAgentToolkit> {
    const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/openai');
    return new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: { actions: { orders: { get: true }, payments: { createRefund: true } }, context: { sandbox: true, request_id } },
    });
  }
  let token = '';
  let expires = 0;
  let toolkit: PayPalAgentToolkit | undefined;

  async function auth(): Promise<string> {
    if (Date.now() < expires) return token;
    const r = await call(`${BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const j: Json = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`PayPal sign-in failed: ${j.error_description || j.error || `HTTP ${r.status}`}`);
    token = j.access_token;
    expires = Date.now() + (Number(j.expires_in) - 60) * 1000;
    toolkit = undefined; // the toolkit fetches its own token once and never renews it, so it is replaced along with ours
    return token;
  }

  async function post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Json> {
    const r = await call(BASE + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let j: Json = {};
    try {
      if (text) j = JSON.parse(text);
    } catch {
      /* a non-JSON body is treated as empty; the status decides */
    }
    if (!r.ok) throw paypalError(j, r.status);
    return j;
  }

  async function tool(name: 'get_order' | 'create_refund', args: Record<string, unknown>, requestId?: string): Promise<Json> {
    await auth(); // drops the shared toolkit when its token is about to expire
    // ponytail: the toolkit takes PayPal-Request-Id only at construction, so a call with one builds its own toolkit,
    // which costs one extra token request. Fine for the occasional refund.
    const tk = requestId ? await newToolkit(requestId) : (toolkit ??= await newToolkit());
    // The toolkit has no time limit of its own.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`PayPal did not answer within ${TIMEOUT_MS / 1000} seconds.`)), TIMEOUT_MS)));
    try {
      const reply = await Promise.race([tk.handleToolCall({ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }), late]);
      return toolkitResult(reply.content);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createOrder({ amount, description, reference, returnUrl, cancelUrl }) {
      const o = await post(
        '/v2/checkout/orders',
        {
          intent: 'AUTHORIZE',
          purchase_units: [{ amount: { currency_code: 'USD', value: amount }, description, custom_id: reference }],
          payment_source: {
            paypal: {
              experience_context: {
                return_url: returnUrl,
                cancel_url: cancelUrl,
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
                brand_name: 'Have You Eaten?',
              },
            },
          },
        },
        { 'PayPal-Request-Id': randomUUID(), Prefer: 'return=representation' },
      );
      const link = (rel: string) => o.links?.find((l: Json) => l?.rel === rel)?.href;
      const approveUrl = link('payer-action') ?? link('approve');
      if (!o.id || !approveUrl) throw new Error('PayPal created the order without an approval link.');
      return { orderId: o.id, approveUrl };
    },

    async getOrder(orderId) {
      const o = await tool('get_order', { id: plain(orderId) });
      // The probe turns this on to show where PayPal puts the payer's country.
      if (process.env.PAYPAL_TRACE === '1') console.log(JSON.stringify(o, null, 2));
      return view(o);
    },

    async authorizeOrder(orderId) {
      // The fixed request id makes a repeat answer with the first authorization instead of failing.
      const o = await post(`/v2/checkout/orders/${plain(orderId)}/authorize`, undefined, {
        'PayPal-Request-Id': `authorize-${orderId}`,
        Prefer: 'return=representation',
      });
      const authorization = o.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!authorization?.id) throw new Error(`PayPal answered for order ${orderId} without an authorization.`);
      return { authorizationId: authorization.id, status: authorization.status };
    },

    async captureAuthorization(authorizationId, requestId, amount) {
      // final_capture tells PayPal nothing more will be taken from this hold, so whatever is left of it is released.
      const body = { final_capture: true, ...(amount ? { amount: { currency_code: 'USD', value: amount } } : {}) };
      const c = await post(`/v2/payments/authorizations/${plain(authorizationId)}/capture`, body, { 'PayPal-Request-Id': requestId });
      if (!c.id) throw new Error(`PayPal answered the capture of ${authorizationId} without a capture id.`);
      return { captureId: c.id, status: String(c.status) };
    },

    async voidAuthorization(authorizationId) {
      await post(`/v2/payments/authorizations/${plain(authorizationId)}/void`); // 204, no body
    },

    async refundCapture(captureId, requestId, amount) {
      // Without an amount PayPal refunds the full capture.
      const r = await tool('create_refund', { capture_id: plain(captureId), ...(amount ? { amount: { currency_code: 'USD', value: amount } } : {}) }, requestId);
      if (!r.id) throw new Error(`PayPal answered the refund of ${captureId} without a refund id.`);
      return { refundId: r.id, status: String(r.status) };
    },

    async payout({ email, amount, note, reference }) {
      // The reference doubles as the batch id, so a repeat of the same payout is refused by PayPal instead of paid twice.
      const p = await post('/v1/payments/payouts', {
        sender_batch_header: { sender_batch_id: reference, email_subject: 'A treat was served at your shop', email_message: note },
        items: [{ recipient_type: 'EMAIL', receiver: email, amount: { currency: 'USD', value: amount }, note, sender_item_id: reference }],
      });
      const id = p.batch_header?.payout_batch_id;
      if (!id) throw new Error('PayPal answered the payout without a batch id.');
      return { payoutId: id, status: String(p.batch_header?.batch_status ?? 'PENDING') };
    },
  };
}

const g = globalThis as { __fairHourPaypal?: Backend };

/** The fake when PAYPAL_FAKE=1, otherwise the real sandbox backend for the seller's app. */
export function backend(): Backend {
  if (isFake()) return fakeBackend;
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET)
    throw new Error('PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (or PAYPAL_FAKE=1 in development).');
  return (g.__fairHourPaypal ??= realBackend(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET));
}
