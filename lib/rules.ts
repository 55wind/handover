// Every amount and every yes-or-no about money is decided here, in plain code. No model takes part.
import { FX, HOLD_DAYS, MAX_TREAT_CENTS } from './shops';
import type { MenuItem, OrderView, Shop, Treat } from './types';

export const toCents = (money: string | undefined): number => Math.round(Number(money ?? 0) * 100);
export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/** What an item costs the sender in US cents, from the shop's own price and the fixed table. Rounded up to a cent. */
export function usdCents(shop: Shop, item: MenuItem): number {
  const perUsd = FX.perUsd[shop.currency];
  if (!perUsd) throw new Error(`No rate on file for ${shop.currency}.`);
  return Math.ceil((item.localPrice / perUsd) * 100 - 1e-9);
}

/** The price in the shop's own currency, e.g. "₩14,000" or "MX$95" (never a bare "$", which would read as US dollars). */
export function localLabel(shop: Shop, item: MenuItem): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: shop.currency, currencyDisplay: 'symbol', maximumFractionDigits: item.localPrice % 1 ? 2 : 0 }).format(item.localPrice);
}

/**
 * What PayPal is asked to hold. With a budget from the sender: the budget, never below the item and never above the
 * limit. Without one: the item plus a quarter, rounded up to a dollar, so the recipient has room to choose something else.
 */
export function ceilingCents(priceCents: number, budgetCents?: number): number {
  const wanted = budgetCents && budgetCents > 0 ? budgetCents : Math.ceil((priceCents * 1.25) / 100) * 100;
  return Math.max(priceCents, Math.min(wanted, MAX_TREAT_CENTS));
}

export const expiryFrom = (heldAt: number): string => new Date(heldAt + HOLD_DAYS * 24 * 3600_000).toISOString();
export const isExpired = (t: Treat, now = Date.now()): boolean => !!t.expiresAt && Date.parse(t.expiresAt) <= now;

export type Decision<T = object> = ({ ok: true } & T) | { ok: false; code: string; reason: string };
const no = (code: string, reason: string): Decision<never> => ({ ok: false, code, reason });

/** May this treat be offered at all? The item must exist at the shop and fit under the limit. */
export function proposalDecision(shop: Shop | undefined, item: MenuItem | undefined): Decision<{ priceCents: number }> {
  if (!shop || !item) return no('unknown', 'That shop or dish is not on file.');
  const priceCents = usdCents(shop, item);
  if (priceCents > MAX_TREAT_CENTS) return no('too_much', `A treat can be at most $${fromCents(MAX_TREAT_CENTS)}.`);
  return { ok: true, priceCents };
}

/** May the recipient change the treat to this? Only while the money is held, in the same city, and within what is held. */
export function swapDecision(t: Treat, from: Shop | undefined, to: Shop | undefined, item: MenuItem | undefined, now = Date.now()): Decision<{ priceCents: number }> {
  if (t.status !== 'held') return no('not_held', 'This treat can no longer be changed.');
  if (isExpired(t, now)) return no('expired', 'This treat has run out.');
  if (!from || !to || !item) return no('unknown', 'That shop or dish is not on file.');
  if (to.city !== from.city) return no('other_city', `The treat is for ${from.city}. It can be changed to another shop there, not to another city.`);
  const priceCents = usdCents(to, item);
  if (priceCents > toCents(t.ceiling)) return no('over_ceiling', 'That costs more than was set aside for this treat.');
  return { ok: true, priceCents };
}

/**
 * May the counter take payment? The treat must be the one for this shop, still in time, and PayPal must be holding
 * at least the price. The amount taken is the price of what was chosen, never the whole hold.
 */
export function redeemDecision(t: Treat, shopId: string, order: OrderView, now = Date.now()): Decision<{ cents: number }> {
  if (!t.shopId || !t.itemId || !t.price) return no('no_treat', 'There is no treat on this code.');
  if (t.shopId !== shopId) return no('other_shop', 'This treat is for another shop.');
  if (isExpired(t, now)) return no('expired', 'This treat has run out. Nothing was taken from the sender.');
  if (!order.authorizationId || !['CREATED', 'PENDING'].includes(order.authorizationStatus ?? '')) return no('no_hold', 'PayPal is not holding money for this treat.');
  const cents = toCents(t.price);
  if (order.amount !== undefined && toCents(order.amount) < cents) return no('hold_too_small', `PayPal is holding $${order.amount}, less than the $${t.price} this costs.`);
  if (cents > toCents(t.ceiling)) return no('over_ceiling', 'The price is above what was set aside.');
  return { ok: true, cents };
}
