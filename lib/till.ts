// The till: what happens when a recipient shows the code at a shop's counter. An agent drives the steps and writes
// to the shop and the sender; code decides what may be taken and reads PayPal back before anything is called paid.
import { PLAIN, defaultLlm, fn, loop, ok, refuse, str, type Handlers, type Llm } from './agent';
import { backend } from './paypal';
import { fromCents, isExpired, redeemDecision, toCents } from './rules';
import { PLATFORM, itemOf, shopById, shopPayoutEmail } from './shops';
import { store } from './store';
import { openHold, releaseTreat } from './treats';
import type { Treat } from './types';

const PROMPT = `You work the till for ${PLATFORM.name}. A recipient is at a shop's counter with the code of a treat. PayPal is holding the sender's money. Your job: take the price of the dish from the hold, which releases the rest, pay the shop, and tell the shop and the sender what happened. The rules are enforced in code and will refuse anything else.

Steps:
1. Call read_order to see what PayPal is holding.
2. Call take_payment. It takes exactly the price of the dish and releases the rest of the hold.
3. If that worked, call pay_shop to send the shop its money.
4. If a step is refused or fails, do not try it more than once more. Nothing is taken unless take_payment succeeded.
5. Call finish with the result ("served" if take_payment succeeded, otherwise "not_served"), one sentence for the shopkeeper in the shop's language (what to serve, to whom, and that PayPal has paid), and one or two warm, plain sentences for the sender in the sender's language (who is eating what, and where). State no amounts other than those in tool results.

Before each step, write one short sentence saying what you are about to do. ${PLAIN}`;

const TOOLS = [
  fn('read_order', 'Ask PayPal what it is holding for this treat.'),
  fn('take_payment', 'Take the price of the dish from the hold. The rest of the hold is released. Refused unless the rules allow it.'),
  fn('pay_shop', 'Send the shop its money. Only after the payment was taken.'),
  fn(
    'finish',
    'End with the result and the words for the shop and for the sender.',
    { result: { type: 'string', enum: ['served', 'not_served'] }, for_shop: { type: 'string', description: "In the shop's language" }, for_sender: { type: 'string', description: "In the sender's language" } },
    ['result', 'for_shop', 'for_sender'],
  ),
];

export interface Served {
  toName: string;
  item: string;
  localName: string;
  charged: string;
  forShop: string;
  verified: boolean;
}

const wrongCodes = new Map<string, { n: number; since: number }>();

/**
 * A code is shown at a counter. Returns what to serve, or a sentence saying why not.
 * With `llm` null the rules settle it without a model (used when the day's model allowance is spent).
 */
export async function redeem(shopId: string, code: unknown, llm: Llm | null = defaultLlm): Promise<{ served: Served } | string> {
  const shop = shopById(shopId);
  if (!shop) return 'There is no such shop.';
  const now = Date.now();
  const tries = wrongCodes.get(shopId);
  if (tries && now - tries.since < 60_000 && tries.n >= 8) return 'Too many wrong codes. Please wait a minute.';
  const t = store.byCode(code);
  if (!t || !t.shopId || !t.to || t.status === 'draft' || t.status === 'approving') {
    wrongCodes.set(shopId, tries && now - tries.since < 60_000 ? { n: tries.n + 1, since: tries.since } : { n: 1, since: now });
    return 'There is no treat with that code. Please check it with the customer.';
  }
  if (t.status === 'enjoyed') return 'This treat has already been served.';
  if (t.status === 'released') return 'This treat is no longer available. Nothing was taken from the sender.';
  if (t.status === 'settling' || t.running) return 'This treat is being dealt with right now. Please try again in a moment.';
  if (t.shopId !== shopId) return `This treat is for ${shopById(t.shopId)?.name ?? 'another shop'}, not for this shop.`;
  if (isExpired(t)) {
    await releaseTreat(t, 'The treat was not used within three days, so PayPal released the hold. Nothing was taken.', 'system');
    return 'This treat has run out. Nothing was taken from the sender.';
  }
  const item = itemOf(shop, t.itemId)!;
  const pp = backend();
  const orderId = t.paypal.orderId!;
  const to = t.to.name;
  t.status = 'settling';
  t.running = true;
  store.emit(t.id, { actor: 'shop', type: 'status', summary: `${to} showed the code at ${shop.name}.` });

  // The tools below change the status; TypeScript cannot see that through the closures, so it is read through this.
  const status = () => t.status as Treat['status'];
  let said: { result: string; forShop: string; forSender: string } | null = null;
  let refusal = '';

  /** Records a capture PayPal has made. Safe to call twice. */
  const markTaken = (captureId: string) => {
    if (!t.paypal.captureId) t.paypal.captureId = captureId;
  };

  const payShop = async (): Promise<Record<string, unknown>> => {
    const email = shopPayoutEmail();
    if (!email) {
      t.paypal.payoutStatus = 'OWED';
      store.emit(t.id, { actor: 'desk', type: 'tool', summary: `No PayPal account is on file for the demo shops, so $${t.price} is recorded as owed to ${shop.name}.` });
      return { paid: false, owed_usd: t.price };
    }
    try {
      const r = await pp.payout({ email, amount: t.price!, note: `${item.name} for ${to}. Treat ${t.ref}.`, reference: `treat-${t.ref}` });
      t.paypal.payoutId = r.payoutId;
      t.paypal.payoutStatus = r.status;
      store.emit(t.id, { actor: 'desk', type: 'tool', summary: `Sent $${t.price} to ${shop.name}'s PayPal account (payout ${r.payoutId}, ${r.status.toLowerCase()}).` });
      return { paid: true, payout: r.payoutId, status: r.status };
    } catch (e) {
      t.paypal.payoutStatus = 'OWED';
      store.emit(t.id, { actor: 'system', type: 'error', summary: `PayPal could not pay the shop yet: ${(e as Error).message} $${t.price} is recorded as owed to ${shop.name}.` });
      return { paid: false, owed_usd: t.price };
    }
  };

  const handlers: Handlers = {
    read_order: async () => {
      const order = await pp.getOrder(orderId);
      store.emit(t.id, { actor: 'desk', type: 'tool', summary: `PayPal: order ${orderId} holds $${order.amount ?? '?'} (authorisation ${order.authorizationStatus?.toLowerCase() ?? 'missing'}).`, detail: { result: order } });
      return ok({ held_usd: order.amount, hold_status: order.authorizationStatus ?? null, already_taken: !!order.captureId, price_of_the_dish_usd: t.price });
    },
    take_payment: async () => {
      if (t.paypal.captureId) return ok({ already_taken: t.paypal.captureId });
      if (status() !== 'settling') return refuse(t, 'This treat is not at the counter.');
      const order = await pp.getOrder(orderId);
      const decision = redeemDecision(t, shopId, order);
      if (!decision.ok) {
        refusal = decision.reason;
        return refuse(t, decision.reason);
      }
      const price = fromCents(decision.cents);
      const c = await pp.captureAuthorization(order.authorizationId!, `capture-${t.ref}`, price);
      if (c.status !== 'COMPLETED' && c.status !== 'PENDING') throw new Error(`PayPal answered the capture with status ${c.status}.`);
      markTaken(c.captureId);
      const rest = fromCents(toCents(t.ceiling) - decision.cents);
      store.emit(t.id, { actor: 'desk', type: 'tool', summary: `PayPal took $${price} of the $${t.ceiling} held (capture ${c.captureId}) and released the other $${rest}.` });
      return ok({ taken_usd: price, released_usd: rest, capture: c.captureId, status: c.status });
    },
    pay_shop: async () => {
      if (!t.paypal.captureId) return refuse(t, 'The shop is paid only after the payment was taken.');
      if (t.paypal.payoutId || t.paypal.payoutStatus === 'OWED') return ok({ already_dealt_with: t.paypal.payoutId ?? 'owed' });
      return ok(await payShop());
    },
    finish: async (a) => {
      said = { result: str(a.result, 20), forShop: str(a.for_shop, 400), forSender: str(a.for_sender, 600) };
      return ok({ done: true });
    },
  };

  /** The same steps, driven by code. Used when no model is available. */
  const settleByRules = async () => {
    store.emit(t.id, { actor: 'system', type: 'status', summary: 'The till agent is not available, so the rules settle this directly.' });
    const taken = await handlers.take_payment({});
    if (taken.ok) await handlers.pay_shop({});
  };

  try {
    if (!llm) await settleByRules();
    else {
      try {
        await loop({
          treat: t,
          actor: 'till',
          system: PROMPT,
          user: {
            shop: { name: shop.name, language: shop.language, shopkeeper: shop.keeper, city: shop.city },
            dish: { name: item.name, local_name: item.localName },
            recipient: to,
            sender: { name: t.from.name, language: t.from.language },
            price_of_the_dish_usd: t.price,
          },
          tools: TOOLS,
          handlers,
          llm,
          done: () => said !== null,
          maxTurns: 8,
          narrate: true,
        });
      } catch (e) {
        // The model itself failed (not a refused step). Someone is standing at a counter: the rules finish the job.
        store.emit(t.id, { actor: 'system', type: 'error', summary: `The till agent stopped: ${(e as Error).message}` });
        if (!t.paypal.captureId) await settleByRules();
      }
    }
  } catch (e) {
    store.emit(t.id, { actor: 'system', type: 'error', summary: `Settlement stopped: ${(e as Error).message}` });
  }

  // Closing check, whatever happened above: PayPal's record decides what this treat is.
  const forShop = `PayPal has paid for ${item.localName} (${item.name}). Please serve ${to}.`;
  const forSender = `${to} is having the ${item.name} at ${shop.name} now.`;
  const agreed = (taken: boolean) => (said && said.result === (taken ? 'served' : 'not_served') && said.forShop && said.forSender ? said : null);
  try {
    const order = await pp.getOrder(orderId);
    if (order.captureId && (order.captureStatus === 'COMPLETED' || order.captureStatus === 'PENDING')) markTaken(order.captureId);
    if (t.paypal.captureId) {
      if (!t.paypal.payoutId && t.paypal.payoutStatus !== 'OWED') await payShop(); // the shop is paid even if the model forgot
      const charged = order.capturedAmount ?? t.price!;
      const words = agreed(true);
      t.status = 'enjoyed';
      t.outcome = {
        enjoyed: true,
        verified: order.captureStatus === 'COMPLETED' && !openHold(order),
        forSender: words?.forSender ?? forSender,
        forShop: words?.forShop ?? forShop,
        charged,
        released: fromCents(Math.max(0, toCents(t.ceiling) - toCents(charged))),
      };
      store.emit(t.id, { actor: 'system', type: 'outcome', summary: `${to} was served. $${charged} taken${t.outcome.verified ? ', confirmed with PayPal' : ', not yet confirmed by PayPal'}; $${t.outcome.released} released.` });
      return { served: { toName: to, item: item.name, localName: item.localName, charged, forShop: t.outcome.forShop!, verified: t.outcome.verified } };
    }
    if (openHold(order)) {
      // Nothing was taken and the money is still held: the treat stays good.
      t.status = 'held';
      store.emit(t.id, { actor: 'system', type: 'error', summary: `The payment was not taken${refusal ? `: ${refusal}` : '.'} The treat is still good.` });
      return refusal || 'PayPal could not take the payment just now. Nothing was taken and the treat is still good: please try again.';
    }
    t.status = 'released';
    t.outcome = { enjoyed: false, verified: !order.captureId, forSender: 'The treat could not be served because PayPal was no longer holding the money. Nothing was taken.', released: t.ceiling };
    store.emit(t.id, { actor: 'system', type: 'outcome', summary: 'Released. PayPal was no longer holding the money. Nothing was taken.' });
    return 'PayPal is no longer holding money for this treat. Nothing was taken from the sender.';
  } catch (e) {
    store.emit(t.id, { actor: 'system', type: 'error', summary: `PayPal could not be reached to confirm the result: ${(e as Error).message}` });
    if (t.paypal.captureId) {
      t.status = 'enjoyed';
      t.outcome = { enjoyed: true, verified: false, forSender, forShop, charged: t.price, released: fromCents(toCents(t.ceiling) - toCents(t.price)) };
      return { served: { toName: to, item: item.name, localName: item.localName, charged: t.price!, forShop, verified: false } };
    }
    t.status = 'held';
    return 'PayPal could not be reached. Nothing was taken and the treat is still good: please try again in a moment.';
  } finally {
    t.running = false;
    store.touch(t);
  }
}

const rechecked = new Map<string, number>();
const SETTLED = ['SUCCESS', 'DENIED', 'CANCELED', 'OWED'];
/**
 * Asks PayPal again about a served treat whose payment was not confirmed yet, or whose payout to the shop was still
 * on its way. Called when someone looks at the treat or the ledger; at most once a minute, for a few days.
 */
export async function recheck(t: Treat, minGapMs = 60_000): Promise<void> {
  if (t.status !== 'enjoyed' || !t.outcome || t.running || !t.paypal.orderId) return;
  const unconfirmed = !t.outcome.verified;
  const payoutOpen = !!t.paypal.payoutId && !SETTLED.includes(t.paypal.payoutStatus ?? '');
  if (!unconfirmed && !payoutOpen) return;
  const now = Date.now();
  if (now - Date.parse(t.createdAt) > 4 * 24 * 3600_000 || now - (rechecked.get(t.id) ?? 0) < minGapMs) return;
  rechecked.set(t.id, now);
  try {
    const pp = backend();
    if (unconfirmed) {
      const order = await pp.getOrder(t.paypal.orderId);
      if (order.captureStatus === 'COMPLETED' && !openHold(order)) {
        t.outcome.verified = true;
        if (order.capturedAmount) t.outcome.charged = order.capturedAmount;
        store.emit(t.id, { actor: 'system', type: 'outcome', summary: `Confirmed with PayPal: $${t.outcome.charged} taken.` });
      }
    }
    if (payoutOpen) {
      const status = await pp.payoutStatus(t.paypal.payoutId!);
      if (status !== t.paypal.payoutStatus) {
        t.paypal.payoutStatus = status;
        store.emit(t.id, { actor: 'desk', type: 'tool', summary: `PayPal reports the payout to the shop as ${status.toLowerCase()}.` });
      }
    }
  } catch {
    /* asked again the next time someone looks */
  }
}
