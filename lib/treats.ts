// What can happen to a treat, shared by the web routes, the agents and the MCP endpoint.
// Functions that can fail for a reason the caller should show return that reason as a string.
import { randomBytes } from 'node:crypto';
import { backend } from './paypal';
import { ceilingCents, expiryFrom, fromCents, isExpired, localLabel, proposalDecision, swapDecision, toCents, usdCents } from './rules';
import { SHOPS, appUrl, cityOf, isFake, itemOf, shopById } from './shops';
import { store } from './store';
import type { Event, LedgerRow, MenuItem, OrderView, RecipientView, Shop, Treat } from './types';

const id = (n: number) => randomBytes(n).toString('base64url');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I: the code is read aloud at a counter
const newCode = () => Array.from(randomBytes(8), (b) => ALPHABET[b % 32]).join('');
const BUSY = 'The service is very busy right now. Please try again in a few minutes.';
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const openHold = (order: OrderView) => !!order.authorizationId && order.authorizationStatus !== 'VOIDED' && order.authorizationStatus !== 'CAPTURED' && order.authorizationStatus !== 'PARTIALLY_CAPTURED';

export function newTreat(o: { name?: unknown; language?: unknown; viaAgent?: boolean }): Treat | string {
  if (!store.makeRoom()) return BUSY;
  let code = newCode();
  while (store.codes.has(code)) code = newCode();
  const t: Treat = {
    id: id(12),
    code,
    ref: id(6),
    createdAt: new Date().toISOString(),
    viaAgent: !!o.viaAgent,
    from: { name: clean(o.name, 40) || 'A friend', language: clean(o.language, 20) || 'en' },
    status: 'draft',
    running: false,
    paypal: {},
    errand: [],
    host: [],
    events: [],
  };
  store.treats.set(t.id, t);
  store.codes.set(t.code, t.id);
  return t;
}

export interface Proposal {
  shopId: unknown;
  itemId: unknown;
  toName: unknown;
  toPlace: unknown;
  toLanguage?: unknown;
  cardForRecipient: unknown;
  cardForSender: unknown;
  reason?: unknown;
  budget?: unknown; // the most the sender wants held, in USD
  fromName?: unknown;
}

/** Records what the sender (through the agent) wants to send. Every amount is worked out here. */
export function setProposal(t: Treat, p: Proposal): string | null {
  if (t.status !== 'draft') return 'The payment has already started, so the treat can no longer be changed by the sender.';
  const shop = shopById(p.shopId);
  const item = itemOf(shop, p.itemId);
  const decision = proposalDecision(shop, item);
  if (!decision.ok) return decision.reason;
  const toName = clean(p.toName, 40);
  const toPlace = clean(p.toPlace, 80);
  if (!toName) return 'The treat needs the name of the person it is for.';
  if (cityOf(toPlace) !== shop!.city) return `The shop has to be where the recipient is. ${shop!.name} is in ${shop!.city}.`;
  const forRecipient = clean(p.cardForRecipient, 500);
  const forSender = clean(p.cardForSender, 500);
  if (!forRecipient || !forSender) return 'The card needs words for the recipient and the same words for the sender.';
  const budget = typeof p.budget === 'string' || typeof p.budget === 'number' ? Math.round(Number(p.budget) * 100) : 0;
  const fromName = clean(p.fromName, 40);
  if (fromName) t.from.name = fromName;
  t.to = { name: toName, place: toPlace, language: clean(p.toLanguage, 20) || shop!.language };
  t.shopId = shop!.id;
  t.itemId = item!.id;
  t.card = { forRecipient, forSender };
  t.reason = clean(p.reason, 300);
  t.price = fromCents(decision.priceCents);
  t.ceiling = fromCents(ceilingCents(decision.priceCents, Number.isFinite(budget) ? budget : 0));
  store.emit(t.id, {
    actor: 'errand',
    type: 'tool',
    summary: `Chose ${item!.name} (${item!.localName}) at ${shop!.name}, ${shop!.area}, ${shop!.city} for ${toName}: ${localLabel(shop!, item!)}, which is $${t.price}. PayPal will be asked to hold $${t.ceiling}.`,
  });
  return null;
}

export async function startCheckout(t: Treat): Promise<{ approveUrl: string } | string> {
  if (t.status !== 'draft') return 'The payment has already started.';
  if (t.running) return 'Please wait for the agent to finish.';
  const shop = shopById(t.shopId);
  const item = itemOf(shop, t.itemId);
  if (!shop || !item || !t.to || !t.card || !t.price || !t.ceiling) return 'There is no treat to pay for yet. Tell the agent who it is for and where they are.';
  if (!store.takeRun('checkout')) return "Today's allowance of treats for this demo is used up. Please come back tomorrow.";
  // Development runs on any port, so the stand-in for PayPal is given paths. Real PayPal needs full addresses.
  const base = isFake() ? '' : appUrl();
  t.status = 'approving';
  try {
    const order = await backend().createOrder({
      amount: t.ceiling,
      description: `${item.name} at ${shop.name}, ${shop.city}. A treat for ${t.to.name}.`.slice(0, 127),
      reference: t.ref,
      returnUrl: `${base}/api/treats/${t.id}/return`,
      cancelUrl: `${base}/treat/${t.id}?cancelled=1`,
    });
    t.paypal.orderId = order.orderId;
    t.paypal.approveUrl = order.approveUrl;
    store.emit(t.id, { actor: 'desk', type: 'tool', summary: `Asked PayPal to hold $${t.ceiling} once the sender approves. Order ${order.orderId}. Nothing is taken at this step.` });
    return { approveUrl: order.approveUrl };
  } catch (e) {
    t.status = 'draft';
    store.emit(t.id, { actor: 'system', type: 'error', summary: `PayPal could not start the hold: ${(e as Error).message}` });
    return `PayPal could not start the hold: ${(e as Error).message}`;
  }
}

/**
 * Called when a browser arrives at the return address. Opening that address proves nothing: the hold is placed only
 * if PayPal itself says the sender approved the order. Returns true when the treat is now held.
 */
export async function placeHold(treatId: string): Promise<boolean> {
  const t = store.treats.get(treatId);
  if (!t || t.status !== 'approving' || t.running || !t.paypal.orderId) return false;
  t.running = true;
  try {
    const pp = backend();
    const order = await pp.getOrder(t.paypal.orderId);
    if (order.status !== 'APPROVED' && !openHold(order)) return false; // not approved yet: the sender's page offers the PayPal link again
    const authorizationId = openHold(order) ? order.authorizationId! : (await pp.authorizeOrder(t.paypal.orderId)).authorizationId;
    t.paypal.authorizationId = authorizationId;
    t.status = 'held';
    t.expiresAt = expiryFrom(Date.now());
    store.emit(t.id, { actor: 'desk', type: 'tool', summary: `PayPal is holding $${t.ceiling} (authorisation ${authorizationId}). Nothing has been taken.` });
    store.emit(t.id, { actor: 'system', type: 'status', summary: `The treat is ready for ${t.to?.name}. It can be used until ${t.expiresAt.slice(0, 10)}.` });
    return true;
  } catch (e) {
    store.emit(t.id, { actor: 'system', type: 'error', summary: `PayPal could not place the hold: ${(e as Error).message}` });
    return false;
  } finally {
    t.running = false;
    store.touch(t);
  }
}

/** Gives the hold back. Used when the recipient says no, the sender cancels, or the three days run out. */
export async function releaseTreat(t: Treat, forSender: string, actor: Event['actor']): Promise<string | null> {
  if (t.status !== 'held' && t.status !== 'approving') return 'This treat can no longer be released.';
  if (t.running) return 'Please try again in a moment.';
  t.running = true;
  try {
    const pp = backend();
    let verified = true;
    let held = false; // whether PayPal was holding money that is now given back
    if (t.paypal.orderId) {
      let order = await pp.getOrder(t.paypal.orderId);
      if (order.captureId) return 'This treat has already been used.';
      if (openHold(order)) {
        held = true;
        await pp.voidAuthorization(order.authorizationId!);
        order = await pp.getOrder(t.paypal.orderId);
      }
      verified = !order.captureId && !openHold(order);
    }
    t.status = 'released';
    // A treat stopped before the sender approved at PayPal never had a hold: say so instead of reporting a release.
    const text = held ? forSender : 'The treat was stopped before PayPal held any money. Nothing was held and nothing was taken.';
    t.outcome = { enjoyed: false, verified, forSender: text, ...(held ? { released: t.ceiling } : {}) };
    store.emit(t.id, { actor, type: 'outcome', summary: held ? `Released. ${text}` : text });
    return null;
  } catch (e) {
    store.emit(t.id, { actor: 'system', type: 'error', summary: `PayPal could not release the hold: ${(e as Error).message}` });
    return `PayPal could not release the hold: ${(e as Error).message}`;
  } finally {
    t.running = false;
    store.touch(t);
  }
}

/** A treat nobody used in time is released the next time anyone looks at it. */
export function expireIfDue(t: Treat): void {
  if (t.status === 'held' && !t.running && isExpired(t)) {
    void releaseTreat(t, 'The treat was not used within three days, so PayPal released the hold. Nothing was taken.', 'system').catch(() => {});
  }
}

/** The recipient asks for something else. Allowed only within what is held, in the same city. */
export function swapTreat(t: Treat, shopId: unknown, itemId: unknown): string | null {
  const to = shopById(shopId);
  const item = itemOf(to, itemId);
  const decision = swapDecision(t, shopById(t.shopId), to, item);
  if (!decision.ok) return decision.reason;
  t.shopId = to!.id;
  t.itemId = item!.id;
  t.price = fromCents(decision.priceCents);
  store.emit(t.id, { actor: 'host', type: 'tool', summary: `${t.to?.name} asked for something else: now ${item!.name} (${item!.localName}) at ${to!.name}. That is $${t.price} of the $${t.ceiling} held.` });
  return null;
}

/** Dishes the recipient could change to: same city, within the hold. Carries no prices. */
export function optionsFor(t: Treat): { shop: Shop; item: MenuItem }[] {
  const from = shopById(t.shopId);
  if (!from) return [];
  const out: { shop: Shop; item: MenuItem }[] = [];
  for (const shop of SHOPS) {
    if (shop.city !== from.city) continue;
    for (const item of shop.menu) if (usdCents(shop, item) <= toCents(t.ceiling) && !(shop.id === t.shopId && item.id === t.itemId)) out.push({ shop, item });
  }
  return out;
}

/** The treat as sent to the sender's browser: without raw PayPal payloads in event details. */
export function senderView(t: Treat): Treat {
  const slim = (detail: unknown) => (detail && typeof detail === 'object' && 'result' in detail ? { ...detail, result: undefined } : detail);
  return { ...t, events: t.events.map((e) => ({ ...e, detail: slim(e.detail) })) };
}

/** The treat as the recipient sees it, once it is live. No amounts. */
export function recipientView(t: Treat): RecipientView | null {
  const shop = shopById(t.shopId);
  const item = itemOf(shop, t.itemId);
  if (!shop || !item || !t.to || !t.card || t.status === 'draft' || t.status === 'approving') return null;
  const { id: shopId, name, localName, kind, city, area, hours, keeper } = shop;
  return {
    code: t.code,
    status: t.status,
    running: t.running,
    fromName: t.from.name,
    toName: t.to.name,
    language: t.to.language,
    card: t.card.forRecipient,
    shop: { id: shopId, name, localName, kind, city, area, hours, keeper },
    item: { id: item.id, name: item.name, localName: item.localName, about: item.about },
    expiresAt: t.expiresAt,
    visit: t.visit,
    thanks: t.thanks?.original,
    enjoyed: t.status === 'enjoyed',
    released: t.status === 'released',
    host: t.host,
  };
}

export function ledgerRow(t: Treat): LedgerRow {
  const shop = shopById(t.shopId);
  const item = itemOf(shop, t.itemId);
  const { orderId, authorizationId, captureId, payoutId, payoutStatus } = t.paypal;
  return {
    ref: t.ref,
    ts: t.createdAt,
    status: t.status,
    shopId: shop?.id,
    shopName: shop?.name,
    city: shop?.city,
    item: item?.name,
    held: t.ceiling,
    charged: t.outcome?.charged,
    released: t.outcome?.released,
    viaAgent: t.viaAgent,
    verified: t.outcome?.verified ?? false,
    paypal: { orderId, authorizationId, captureId, payoutId, payoutStatus },
  };
}

/** Every treat that reached PayPal, newest first, with totals. */
export function ledger(): { rows: LedgerRow[]; totals: { treats: number; enjoyed: number; held: string; charged: string; released: string } } {
  const treats = [...store.treats.values()].filter((t) => t.paypal.orderId && t.status !== 'approving').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = (pick: (t: Treat) => string | undefined) => fromCents(treats.reduce((n, t) => n + toCents(pick(t)), 0));
  return {
    rows: treats.map(ledgerRow),
    totals: {
      treats: treats.length,
      enjoyed: treats.filter((t) => t.status === 'enjoyed').length,
      held: sum((t) => (t.status === 'held' || t.status === 'settling' ? t.ceiling : undefined)),
      charged: sum((t) => t.outcome?.charged),
      released: sum((t) => t.outcome?.released),
    },
  };
}

/** A shop with what each dish costs the sender, for display. */
export function shopCard(shop: Shop) {
  return { ...shop, menu: shop.menu.map((m) => ({ ...m, usd: fromCents(usdCents(shop, m)), local: localLabel(shop, m) })) };
}

export const servedAt = (shopId: string): LedgerRow[] =>
  [...store.treats.values()]
    .filter((t) => t.shopId === shopId && t.status === 'enjoyed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(ledgerRow);
