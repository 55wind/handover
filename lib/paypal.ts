import { randomUUID } from 'node:crypto';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai';
import { MERCHANTS, credentialSlot, credentials, isFake } from './merchants';
import { fakeBackend } from './paypal-fake';
import type { Backend, MerchantSlug } from './types';

const BASE = 'https://api-m.sandbox.paypal.com'; // sandbox only: this project never calls live PayPal

// Keys as the toolkit declares them per tool (tools[].actions); with these, getTools() lists exactly the ten tools the desks use.
const ACTIONS = {
  subscriptions: { create: true, show: true, cancel: true },
  payments: { createRefund: true, getRefunds: true },
  orders: { get: true },
  invoices: { get: true, cancel: true, cancelReminders: true, generateQRC: true },
};

const newToolkit = (clientId: string, clientSecret: string, request_id?: string) =>
  new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: ACTIONS, context: { sandbox: true, request_id } } });

/** The toolkit's own tool definitions. Placeholder credentials are enough: nothing is sent until a tool is called. */
export const toolkitTools = () => newToolkit('-', '-').getTools().map((t) => t.function);

export type Primitive = 'invoice' | 'charge' | 'subscription';
const failures = new Map<string, string>(); // "slot:primitive" -> why PayPal refused to seed it
/** Why the last attempt to seed this primitive failed for this merchant's sandbox app, if it did. */
export const seedFailure = (slug: MerchantSlug, what: Primitive) => failures.get(`${credentialSlot(slug)}:${what}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any; // PayPal JSON, read field by field

/** PayPal's error body as one sentence, in the same form the toolkit uses: "<message>: <details>". */
function paypalError(j: Json, status: number): Error {
  const details = (Array.isArray(j?.details) ? j.details : []).map((d: Json) => d?.description || d?.issue).filter(Boolean).join('; ');
  return new Error(`${j?.message || j?.error_description || j?.name || `PayPal answered HTTP ${status}`}${details ? `: ${details}` : ''}`);
}

/** The toolkit never throws: a PayPal failure comes back as JSON `{ok:false, message}` or `{error:{message}}`. Turn that into a throw. */
function toolkitResult(content: unknown): unknown {
  let data: Json;
  try {
    data = JSON.parse(String(content));
  } catch {
    throw new Error(`PayPal returned something unreadable: ${String(content).slice(0, 200)}`);
  }
  if (data && typeof data === 'object' && (data.ok === false || data.error))
    throw new Error(String(data.message ?? data.error?.message ?? data.error ?? 'PayPal reported an error'));
  return data; // "" after a 204, e.g. cancel_subscription
}

/** "Maria Elena Reyes" -> given name "Maria Elena", surname "Reyes": split on the last space. */
export const names = (fullName: string) => {
  const name = fullName.trim();
  const cut = name.lastIndexOf(' ');
  return cut < 0 ? { given_name: name } : { given_name: name.slice(0, cut).trim(), surname: name.slice(cut + 1) };
};
/** PayPal's sandbox test Visa. */
const card = (name: string) => ({
  number: '4111111111111111',
  expiry: `${new Date().getUTCFullYear() + 3}-12`,
  security_code: '123',
  name,
  billing_address: { address_line_1: '123 Alder Street', admin_area_2: 'Portland', admin_area_1: 'OR', postal_code: '97204', country_code: 'US' },
});

function realBackend(slot: number, clientId: string, clientSecret: string): Backend {
  let token = '';
  let expires = 0;
  let toolkit = newToolkit(clientId, clientSecret);
  const plans = new Map<string, string>(); // "label|price" -> plan id

  async function auth(): Promise<string> {
    if (Date.now() < expires) return token;
    const r = await fetch(`${BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const j: Json = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`PayPal sign-in failed for credential slot ${slot}: ${j.error_description || j.error || `HTTP ${r.status}`}`);
    token = j.access_token;
    expires = Date.now() + (Number(j.expires_in) - 60) * 1000;
    toolkit = newToolkit(clientId, clientSecret); // the toolkit fetches its own token once and never renews it, so it is replaced along with ours
    return token;
  }

  async function api(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Json> {
    const r = await fetch(BASE + path, {
      method,
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

  /** One seeding step. A refusal from PayPal means "this sandbox cannot do it": null, with the reason logged once and kept for the probe. */
  async function seed<T>(what: Primitive, run: () => Promise<T>): Promise<T | null> {
    await auth(); // a sign-in failure is a configuration error, so it is thrown rather than turned into null
    try {
      return await run();
    } catch (e) {
      const key = `${slot}:${what}`;
      const reason = (e as Error).message;
      if (!failures.has(key)) console.warn(`[paypal slot ${slot}] cannot seed a ${what}: ${reason}`);
      failures.set(key, reason);
      return null;
    }
  }

  async function planFor(label: string, price: string): Promise<string> {
    const key = `${label}|${price}`;
    if (!plans.has(key)) {
      const product = await api('POST', '/v1/catalogs/products', { name: label, type: 'SERVICE' });
      const plan = await api('POST', '/v1/billing/plans', {
        product_id: product.id,
        name: label,
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: price, currency_code: 'USD' } },
          },
        ],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
      });
      plans.set(key, plan.id);
    }
    return plans.get(key)!;
  }

  return {
    async exec(tool, args, requestId) {
      if (tool === 'suspend_subscription' || tool === 'activate_subscription') {
        const id = String(args.subscription_id);
        await api(
          'POST',
          `/v1/billing/subscriptions/${encodeURIComponent(id)}/${tool === 'suspend_subscription' ? 'suspend' : 'activate'}`,
          { reason: String(args.reason || 'Requested by the family') },
          requestId ? { 'PayPal-Request-Id': requestId } : {},
        );
        return { success: true, subscription_id: id }; // PayPal answers 204 with no body
      }
      // handleToolCall would run any of the toolkit's 46 methods; only the ones enabled above may pass.
      if (!toolkit.getTools().some((t) => t.function.name === tool)) throw new Error(`Unknown tool: ${tool}`);
      await auth(); // replaces the shared toolkit when its token is about to expire
      // ponytail: the toolkit takes PayPal-Request-Id only at construction, so a call with one builds its own toolkit,
      // which costs one extra token request. Fine for a handful of irreversible calls per case.
      const tk = requestId ? newToolkit(clientId, clientSecret, requestId) : toolkit;
      const reply = await tk.handleToolCall({ id: randomUUID(), type: 'function', function: { name: tool, arguments: JSON.stringify(args) } });
      return toolkitResult(reply.content);
    },

    seedSubscription: ({ label, price, payerName, payerEmail }) =>
      seed('subscription', async () => {
        const planId = await planFor(label, price);
        const sub = await api(
          'POST',
          '/v1/billing/subscriptions',
          { plan_id: planId, subscriber: { name: names(payerName), email_address: payerEmail, payment_source: { card: card(payerName) } } },
          { 'PayPal-Request-Id': randomUUID() },
        );
        if (sub.status !== 'ACTIVE' && sub.status !== 'APPROVED') throw new Error(`the card-funded subscription came back ${sub.status}, not ACTIVE`);
        return { paypalId: sub.id as string, planId };
      }),

    seedCharge: ({ label, amount, payerName }) =>
      seed('charge', async () => {
        const order = await api(
          'POST',
          '/v2/checkout/orders',
          {
            intent: 'CAPTURE',
            purchase_units: [{ description: label.slice(0, 127), amount: { currency_code: 'USD', value: amount } }],
            payment_source: { card: card(payerName) },
          },
          // PayPal requires a request id when an order carries its payment source; the full body comes back only on request.
          { 'PayPal-Request-Id': randomUUID(), Prefer: 'return=representation' },
        );
        const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
        if (order.status !== 'COMPLETED' || capture?.status !== 'COMPLETED')
          throw new Error(`the card order came back ${order.status} with capture ${capture?.status ?? 'missing'}`);
        return { captureId: capture.id as string, orderId: order.id as string };
      }),

    seedInvoice: ({ label, amount, recipientName, recipientEmail }) =>
      seed('invoice', async () => {
        const draft = await api(
          'POST',
          '/v2/invoicing/invoices',
          {
            detail: { currency_code: 'USD' },
            primary_recipients: [{ billing_info: { name: names(recipientName), email_address: recipientEmail } }],
            items: [{ name: label, quantity: '1', unit_amount: { currency_code: 'USD', value: amount } }],
            configuration: { auto_populate_invoicer: true }, // invoicer details come from the merchant's PayPal profile
          },
          { Prefer: 'return=representation' },
        );
        // Without the Prefer header PayPal answers with a link to the invoice instead of the invoice.
        const invoiceId = String(draft.id ?? draft.href ?? '').split('/').pop();
        if (!invoiceId) throw new Error('PayPal did not return an invoice id');
        await api('POST', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, { send_to_invoicer: false });
        return { invoiceId };
      }),
  };
}

const g = globalThis as { __handoverPaypal?: Map<number, Backend> };
const backends = (g.__handoverPaypal ??= new Map());

/** The fake when PAYPAL_FAKE=1, otherwise the real sandbox backend for this merchant's credential slot. */
export function backendFor(slug: MerchantSlug): Backend {
  if (isFake()) return fakeBackend;
  const cred = credentials(slug);
  if (!cred) throw new Error(`PayPal is not configured for ${MERCHANTS[slug].name}: set PAYPAL_1_CLIENT_ID and PAYPAL_1_CLIENT_SECRET.`);
  let backend = backends.get(cred.slot);
  if (!backend) backends.set(cred.slot, (backend = realBackend(cred.slot, cred.clientId, cred.clientSecret)));
  return backend;
}
