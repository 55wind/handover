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

export function makeQuote(productId: unknown, country: unknown): Quote | string {
  const product = productById(String(productId));
  if (!product) return 'There is no such product.';
  const price = typeof country === 'string' && /^[A-Za-z]{2}$/.test(country) ? priceFor(product, RULES, country.toUpperCase()) : null;
  if (!price) return 'There is no income figure for that country, so a fair price cannot be worked out.';
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
  const gift = cleanGift(o.gift);
  const p: Purchase = {
    id: id(9),
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

/** Help promised to purchases that have not settled yet counts against the pool, so it cannot be promised twice. */
export function poolAvailableCents(except?: Purchase): number {
  let promised = 0;
  for (const p of store.purchases.values()) {
    if (p !== except && p.help && (p.status === 'open' || p.status === 'approving' || p.status === 'settling')) promised += toCents(p.help.amount);
  }
  return Math.max(0, toCents(store.pool.balance) - promised);
}

export function grantsThisMonth(): number {
  const month = new Date().toISOString().slice(0, 7);
  return store.pool.entries.filter((e) => e.kind === 'help' && e.ts.startsWith(month)).length;
}

export async function startCheckout(p: Purchase): Promise<{ approveUrl: string } | string> {
  if (p.status !== 'open') return 'The payment has already started.';
  if (p.running) return 'Please wait for the clerk to finish.';
  const product = productById(p.productId)!;
  // Development runs on any port, so the stand-in for PayPal is given paths. Real PayPal needs full addresses.
  const base = isFake() ? '' : appUrl();
  p.status = 'approving';
  try {
    const order = await backend().createOrder({
      amount: p.amount,
      description: `${product.title}. Fair Hour price for ${p.quote.price.countryName}.`.slice(0, 127),
      purchaseId: p.id,
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
  id: string;
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
  hoursAtList: number;
  hoursAtFair: number;
  status: Purchase['status'];
  viaAgent: boolean;
  reason?: string;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string; refundId?: string };
}

const nameOf = (country?: string) => (country ? (priceFor(PRODUCTS[0], RULES, country)?.countryName ?? country) : undefined);

export function saleOf(p: Purchase): Sale {
  const { orderId, authorizationId, captureId, refundId, walletCountry } = p.paypal;
  return {
    id: p.id,
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

/** The seller gives the money back. A gift that came with the sale leaves the pool again, as far as the pool still holds it. */
export async function refundSale(purchaseId: unknown): Promise<Sale | string> {
  const p = store.purchases.get(String(purchaseId));
  if (!p) return 'This purchase is no longer available.';
  if (p.status !== 'captured' || !p.paypal.captureId) return 'Only a captured payment can be refunded.';
  if (p.running) return 'Please try again in a moment.';
  p.running = true;
  try {
    const r = await backend().refundCapture(p.paypal.captureId, `refund-${p.id}`);
    p.paypal.refundId = r.refundId;
    p.status = 'refunded';
    const gift = Math.min(toCents(p.gift), toCents(store.pool.balance));
    if (gift > 0) {
      store.pool.balance = fromCents(toCents(store.pool.balance) - gift);
      store.pool.entries.push({ ts: new Date().toISOString(), purchaseId: p.id, kind: 'gift', amount: fromCents(-gift) });
    }
    // Help that came out of the pool for this sale goes back into it.
    const help = toCents(p.help?.amount ?? '0');
    if (help > 0) {
      store.pool.balance = fromCents(toCents(store.pool.balance) + help);
      store.pool.entries.push({ ts: new Date().toISOString(), purchaseId: p.id, kind: 'help', amount: fromCents(-help) });
    }
    store.bought.delete(`${p.paypal.payerId}:${p.productId}`);
    store.emit(p.id, { actor: 'desk', type: 'outcome', summary: `Refunded $${p.amount} to the wallet that paid. Refund ${r.refundId}.` });
    return saleOf(p);
  } catch (e) {
    store.emit(p.id, { actor: 'system', type: 'error', summary: `PayPal could not refund: ${(e as Error).message}` });
    return `PayPal could not refund: ${(e as Error).message}`;
  } finally {
    p.running = false;
  }
}
