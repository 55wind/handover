// What a buyer or the seller can do, shared by the web routes and the MCP endpoint.
// Functions that can fail for a reason the caller should show return that reason as a string.
import { randomBytes } from 'node:crypto';
import { backend } from './paypal';
import { amountDue, fromCents, priceFor, toCents } from './pricing';
import { PRODUCTS, RULES, appUrl, isFake, productById } from './seller';
import { store } from './store';
import type { Purchase, Quote } from './types';

const id = (n: number) => randomBytes(n).toString('base64url');
const QUOTE_MINUTES = 30;
/** How long a purchase may sit before the buyer pays. After this its price and any help promised to it lapse. */
const LIVE_MINUTES = 60;
const BUSY = 'The shop is very busy right now. Please try again in a few minutes.';

const waiting = (p: Purchase) => Date.now() - Date.parse(p.createdAt) <= LIVE_MINUTES * 60_000;

export function makeQuote(productId: unknown, country: unknown): Quote | string {
  const product = productById(String(productId));
  if (!product) return 'There is no such product.';
  const price = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? priceFor(product, RULES, country.toUpperCase()) : null;
  if (!price) return 'There is no income figure for that country, so a fair price cannot be worked out.';
  if (!store.makeRoom()) return BUSY;
  const now = Date.now();
  const quote: Quote = { id: id(9), productId: product.id, price, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + QUOTE_MINUTES * 60_000).toISOString() };
  store.quotes.set(quote.id, quote);
  return quote;
}

/** A gift is a small fixed top-up; anything else is treated as none. */
const cleanGift = (gift: unknown) => {
  const cents = typeof gift === 'string' && /^\d{1,2}(\.\d{1,2})?$/.test(gift) ? toCents(gift) : 0;
  return fromCents(cents >= 0 && cents <= 2000 ? cents : 0);
};

export function openPurchase(o: { quoteId: unknown; language?: unknown; gift?: unknown; viaAgent?: boolean }): Purchase | string {
  const quote = store.quotes.get(String(o.quoteId));
  if (!quote) return 'That price is no longer on file. Please ask for it again.';
  if (quote.expiresAt < new Date().toISOString()) return 'That price has expired. Please ask for it again.';
  if (!store.makeRoom()) return BUSY;
  const gift = cleanGift(o.gift);
  const p: Purchase = {
    id: id(9),
    ref: id(6),
    createdAt: new Date().toISOString(),
    productId: quote.productId,
    quote,
    buyer: { language: typeof o.language === 'string' ? o.language.slice(0, 20) : 'en', viaAgent: !!o.viaAgent },
    gift,
    amount: amountDue(quote.price.fair, undefined, gift),
    status: 'open',
    running: false,
    paypal: {},
    messages: [],
    events: [],
  };
  store.purchases.set(p.id, p);
  store.emit(p.id, {
    actor: 'buyer',
    type: 'status',
    summary: `${p.buyer.viaAgent ? 'An AI shopping agent' : 'A buyer'} asked for the ${quote.price.countryName} price: $${quote.price.fair} against a list price of $${quote.price.list}.`,
  });
  return p;
}

export function setGift(p: Purchase, gift: unknown): string | null {
  if (p.status !== 'open') return 'The payment has already started.';
  p.gift = cleanGift(gift);
  p.amount = amountDue(p.quote.price.fair, p.help?.amount, p.gift);
  return null;
}

/**
 * Help promised to purchases that have not settled yet counts against the pool, so it cannot be promised twice.
 * A promise lapses with its purchase: a buyer who walks away does not hold the pool's money for ever.
 */
// ponytail: promises are free to ask for, so many idle purchases can hold the pool for up to an hour.
// Fine at demo scale; tie promises to a signed-in buyer if that is ever abused.
export function poolAvailableCents(except?: Purchase): number {
  let promised = 0;
  for (const p of store.purchases.values()) {
    if (p === except || !p.help) continue;
    if (p.status === 'settling' || ((p.status === 'open' || p.status === 'approving') && waiting(p))) promised += toCents(p.help.amount);
  }
  return Math.max(0, toCents(store.pool.balance) - promised);
}

/** Help actually paid out this month. Reversals by refund are not counted as grants. */
export function grantsThisMonth(): number {
  const month = new Date().toISOString().slice(0, 7);
  return store.pool.entries.filter((e) => e.kind === 'help' && toCents(e.amount) > 0 && e.ts.startsWith(month)).length;
}

export async function startCheckout(p: Purchase): Promise<{ approveUrl: string } | string> {
  if (p.status !== 'open') return 'The payment has already started.';
  if (p.running) return 'Please wait for the clerk to finish.';
  if (!waiting(p)) return 'This price has expired. Please ask for it again.';
  if (!store.takeRun('checkout')) return "Today's allowance of payments for this demo is used up. Please come back tomorrow.";
  const product = productById(p.productId)!;
  // Development runs on any port, so the stand-in for PayPal is given paths. Real PayPal needs full addresses.
  const base = isFake() ? '' : appUrl();
  p.status = 'approving';
  try {
    const order = await backend().createOrder({
      amount: p.amount,
      description: `${product.title}. Fair Hour price for ${p.quote.price.countryName}.`.slice(0, 127),
      purchaseId: p.ref, // PayPal keeps this on the order; the buyer's own id stays with the buyer
      returnUrl: `${base}/api/purchases/${p.id}/return`,
      cancelUrl: `${base}/purchase/${p.id}?cancelled=1`,
    });
    p.paypal.orderId = order.orderId;
    p.paypal.approveUrl = order.approveUrl;
    store.emit(p.id, { actor: 'desk', type: 'tool', summary: `Asked PayPal to hold $${p.amount} once the buyer approves. Order ${order.orderId}.` });
    return { approveUrl: order.approveUrl };
  } catch (e) {
    p.status = 'open';
    store.emit(p.id, { actor: 'system', type: 'error', summary: `PayPal could not start the payment: ${(e as Error).message}` });
    return `PayPal could not start the payment: ${(e as Error).message}`;
  }
}

export interface Sale {
  id: string; // the ledger reference, not the buyer's purchase id
  ts: string;
  productTitle: string;
  quotedCountry: string;
  quotedCountryName: string;
  walletCountry?: string;
  walletCountryName?: string;
  list: string;
  fair: string;
  help?: string;
  gift: string;
  amount: string;
  refundable: string; // what a refund sends back: the amount paid, less the gift, which stays in the pool
  hoursAtList: number;
  hoursAtFair: number;
  status: Purchase['status'];
  viaAgent: boolean;
  reason?: string;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string; refundId?: string };
}

const nameOf = (country?: string) => (country ? (priceFor(PRODUCTS[0], RULES, country)?.countryName ?? country) : undefined);
const refundableCents = (p: Purchase) => toCents(p.amount) - toCents(p.gift);

export function saleOf(p: Purchase): Sale {
  const { orderId, authorizationId, captureId, refundId, walletCountry } = p.paypal;
  return {
    id: p.ref,
    ts: p.createdAt,
    productTitle: productById(p.productId)?.title ?? p.productId,
    quotedCountry: p.quote.price.country,
    quotedCountryName: p.quote.price.countryName,
    walletCountry,
    walletCountryName: nameOf(walletCountry),
    list: p.quote.price.list,
    fair: p.quote.price.fair,
    help: p.help?.amount,
    gift: p.gift,
    amount: p.amount,
    refundable: fromCents(refundableCents(p)),
    hoursAtList: p.quote.price.hoursAtList,
    hoursAtFair: p.quote.price.hoursAtFair,
    status: p.status,
    viaAgent: p.buyer.viaAgent,
    reason: p.status === 'voided' ? p.outcome?.text : undefined,
    paypal: { orderId, authorizationId, captureId, refundId },
  };
}

/** Every purchase that reached PayPal, newest first. */
export const sales = (): Sale[] =>
  [...store.purchases.values()]
    .filter((p) => p.paypal.orderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(saleOf);

/**
 * The seller gives back what the buyer paid for the product. A gift that came with the sale stays in the pool: it
 * was given to other buyers and may already have been spent. Help the pool paid towards this sale goes back to the pool.
 */
// ponytail: the seller's console has no sign-in in this demo, so anyone who opens it can refund a sandbox sale once.
// Put the console behind the seller's login before real money is involved.
export async function refundSale(ref: unknown): Promise<Sale | string> {
  const p = typeof ref === 'string' && ref ? [...store.purchases.values()].find((x) => x.ref === ref) : undefined;
  if (!p) return 'This sale is no longer on file.';
  if (p.status !== 'captured' || !p.paypal.captureId) return 'Only a captured payment can be refunded.';
  if (p.running) return 'Please try again in a moment.';
  p.running = true;
  try {
    const back = fromCents(refundableCents(p));
    // Without an amount PayPal refunds the whole capture, which is right when there was no gift.
    const r = await backend().refundCapture(p.paypal.captureId, `refund-${p.ref}`, toCents(p.gift) > 0 ? back : undefined);
    p.paypal.refundId = r.refundId;
    p.status = 'refunded';
    const help = toCents(p.help?.amount ?? '0');
    if (help > 0) {
      store.pool.balance = fromCents(toCents(store.pool.balance) + help);
      store.pool.entries.push({ ts: new Date().toISOString(), ref: p.ref, kind: 'help', amount: fromCents(-help), country: p.quote.price.country });
    }
    store.bought.delete(`${p.paypal.payerId}:${p.productId}`);
    store.emit(p.id, {
      actor: 'desk',
      type: 'outcome',
      summary: `Refunded $${back} to the wallet that paid. Refund ${r.refundId}.${toCents(p.gift) > 0 ? ` The $${p.gift} gift stays in the pool.` : ''}${help > 0 ? ` $${fromCents(help)} of help went back to the pool.` : ''}`,
    });
    return saleOf(p);
  } catch (e) {
    store.emit(p.id, { actor: 'system', type: 'error', summary: `PayPal could not refund: ${(e as Error).message}` });
    return `PayPal could not refund: ${(e as Error).message}`;
  } finally {
    p.running = false;
  }
}
