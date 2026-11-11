// Development and tests only (PAYPAL_FAKE=1). Nothing in this file talks to PayPal or moves money.
import { randomBytes } from 'node:crypto';
import { fromCents, toCents } from './guard';
import type { Backend } from './types';

type Args = Record<string, unknown>;
interface Sub {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'APPROVAL_PENDING';
  plan_id: string;
  subscriber: unknown;
  links?: { href: string; rel: string; method: string }[];
}
interface Capture { id: string; orderId: string; cents: number; refunded: number }
interface Invoice {
  id: string;
  status: 'SENT' | 'CANCELLED';
  detail: { currency_code: string; metadata: { recipient_view_url: string } };
  amount: { currency_code: string; value: string };
  primary_recipients: unknown[];
}
interface State {
  subs: Map<string, Sub>;
  captures: Map<string, Capture>;
  refunds: Map<string, unknown>;
  invoices: Map<string, Invoice>;
  fail: Map<string, string>;
}

// On globalThis so the objects survive Next.js hot reloads.
const g = globalThis as { __handoverFake?: State };
const s: State = (g.__handoverFake ??= { subs: new Map(), captures: new Map(), refunds: new Map(), invoices: new Map(), fail: new Map() });

const rid = (n: number) => Array.from(randomBytes(n), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const usd = (cents: number) => ({ currency_code: 'USD', value: fromCents(cents) });
const person = (fullName: string, email: string) => ({ email_address: email, name: { full_name: fullName } });

// Messages read the way the real backend reports PayPal errors: "<message>: <detail>".
const notFound = () => new Error('The specified resource does not exist.: Requested resource ID was not found.');
const refused = (detail: string) =>
  new Error(`The requested action could not be performed, semantically incorrect, or failed business validation.: ${detail}`);
function need<T>(v: T | undefined): T {
  if (!v) throw notFound();
  return v;
}

/** The path of the page PayPal would return the buyer to. */
function backPath(args: Args): string {
  try {
    return new URL(String((args.application_context as { return_url?: string } | undefined)?.return_url)).pathname;
  } catch {
    return '/';
  }
}

const captureStatus = (c: Capture) => (c.refunded === 0 ? 'COMPLETED' : c.refunded < c.cents ? 'PARTIALLY_REFUNDED' : 'REFUNDED');

/** Stands in for the buyer approving a new subscription at PayPal. False when there is nothing to approve. */
export function approveSubscription(id: string): boolean {
  const sub = s.subs.get(id);
  if (sub?.status !== 'APPROVAL_PENDING') return false;
  sub.status = 'ACTIVE';
  return true;
}

/** Test hook: the next `exec` of this tool throws this message, as if PayPal had refused. */
export function failNext(tool: string, message: string): void {
  s.fail.set(tool, message);
}

export const fakeBackend: Backend = {
  async exec(tool: string, args: Args) {
    const planned = s.fail.get(tool);
    if (planned) {
      s.fail.delete(tool);
      throw new Error(planned);
    }
    const sub = () => need(s.subs.get(String(args.subscription_id)));
    const invoice = () => need(s.invoices.get(String(args.invoice_id)));
    const move = (from: Sub['status'][], to: Sub['status'], verb: string) => {
      const x = sub();
      if (!from.includes(x.status))
        throw refused(`Invalid subscription status for ${verb} action; subscription status should be ${from.join(' or ').toLowerCase()}.`);
      x.status = to;
      return tool === 'cancel_subscription' ? '' : { success: true, subscription_id: x.id }; // PayPal answers 204 with no body
    };

    switch (tool) {
      case 'show_subscription_details':
        return { ...sub() }; // copies, so an earlier answer does not change when the object does
      case 'suspend_subscription':
        return move(['ACTIVE'], 'SUSPENDED', 'suspend');
      case 'activate_subscription':
        return move(['SUSPENDED'], 'ACTIVE', 'activate');
      case 'cancel_subscription':
        return move(['ACTIVE', 'SUSPENDED'], 'CANCELLED', 'cancel');
      case 'create_subscription': {
        const id = `I-${rid(12)}`;
        const created: Sub = {
          id,
          status: 'APPROVAL_PENDING',
          plan_id: String(args.plan_id),
          subscriber: args.subscriber,
          // A local page plays PayPal's approval screen and sends the browser back, the way PayPal does.
          links: [{ href: `/api/dev/approve?id=${id}&back=${encodeURIComponent(backPath(args))}`, rel: 'approve', method: 'GET' }],
        };
        s.subs.set(id, created);
        return { ...created };
      }
      case 'get_order': {
        const cap = need([...s.captures.values()].find((c) => c.orderId === args.id));
        return {
          id: cap.orderId,
          status: 'COMPLETED',
          purchase_units: [{ payments: { captures: [{ id: cap.id, status: captureStatus(cap), amount: usd(cap.cents) }] } }],
        };
      }
      case 'create_refund': {
        const cap = need(s.captures.get(String(args.capture_id)));
        const left = cap.cents - cap.refunded;
        const value = (args.amount as { value?: string } | undefined)?.value;
        const cents = value === undefined ? left : toCents(value);
        if (left <= 0) throw refused('The capture has already been fully refunded.');
        if (!(cents > 0 && cents <= left))
          throw refused('The refund amount must be less than or equal to the capture amount that has not yet been refunded.');
        cap.refunded += cents;
        const refund = { id: rid(17), status: 'COMPLETED', amount: usd(cents) };
        s.refunds.set(refund.id, refund);
        return refund;
      }
      case 'get_refund':
        return need(s.refunds.get(String(args.refund_id)));
      case 'get_invoice':
        return { ...invoice() };
      case 'cancel_invoice_auto_reminder':
        return { success: true, invoice_id: invoice().id };
      case 'cancel_sent_invoice': {
        const inv = invoice();
        if (inv.status !== 'SENT') throw refused('Invoice is already cancelled.');
        inv.status = 'CANCELLED';
        return { success: true, invoice_id: inv.id };
      }
      case 'generate_invoice_qr_code':
        invoice();
        return 'FAKE-QR-CODE'; // PayPal returns the PNG as text
      default:
        throw new Error(`Invalid method: ${tool}`);
    }
  },

  async seedSubscription({ payerName, payerEmail }) {
    const sub: Sub = { id: `I-${rid(12)}`, status: 'ACTIVE', plan_id: `P-${rid(24)}`, subscriber: person(payerName, payerEmail) };
    s.subs.set(sub.id, sub);
    return { paypalId: sub.id, planId: sub.plan_id };
  },

  async seedCharge({ amount }) {
    const cap: Capture = { id: rid(17), orderId: rid(17), cents: toCents(amount), refunded: 0 };
    s.captures.set(cap.id, cap);
    return { captureId: cap.id, orderId: cap.orderId };
  },

  async seedInvoice({ amount, recipientName, recipientEmail }) {
    const id = `INV2-${rid(4)}-${rid(4)}-${rid(4)}-${rid(4)}`;
    s.invoices.set(id, {
      id,
      status: 'SENT',
      detail: { currency_code: 'USD', metadata: { recipient_view_url: `https://example.com/fake-paypal/invoice/${id}` } },
      amount: { currency_code: 'USD', value: amount },
      primary_recipients: [{ billing_info: person(recipientName, recipientEmail) }],
    });
    return { invoiceId: id };
  },
};
