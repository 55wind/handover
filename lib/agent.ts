import OpenAI from 'openai';
import { backend } from './paypal';
import { captureDecision, fromCents, priceFor, toCents } from './pricing';
import { RULES, SELLER, isScripted, productById } from './seller';
import { makeQuote } from './shop';
import { store } from './store';
import type { OrderView, Purchase, ToolResult } from './types';

// ---- model client (OpenAI-compatible chat completions; injectable for tests) ----

export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LlmCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface LlmReply {
  content: string | null;
  tool_calls?: LlmCall[];
}
export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | unknown[] } // an array when a picture goes with the text
  | ({ role: 'assistant' } & LlmReply)
  | { role: 'tool'; tool_call_id: string; content: string };
export type Llm = (messages: LlmMessage[], tools: LlmTool[]) => Promise<LlmReply>;

let client: OpenAI | undefined;
let standIn: Llm | undefined;
export const defaultLlm: Llm = async (messages, tools) => {
  if (isScripted()) {
    standIn ??= (await import('./llm-scripted')).scripted();
    return standIn(messages, tools);
  }
  if (!process.env.OPENAI_API_KEY || !process.env.LLM_MODEL) {
    throw new Error('No language model is configured. Set OPENAI_API_KEY and LLM_MODEL.');
  }
  // A stalled model call must not leave a payment hanging: one minute, one retry.
  client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined, timeout: 60_000, maxRetries: 1 });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: messages as never,
    ...(tools.length ? { tools } : {}),
  });
  const m = res.choices[0].message;
  return { content: m.content, tool_calls: m.tool_calls as LlmCall[] | undefined };
};

export const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): LlmTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export type Handlers = Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>;
export const ok = (data: unknown): ToolResult => ({ ok: true, data });
export const refuse = (p: Purchase, error: string): ToolResult => {
  store.emit(p.id, { actor: 'rules', type: 'refused', summary: `Refused: ${error}` });
  return { ok: false, refused: true, error };
};

/** Runs the model with tools until `done()` or it stops calling tools. Returns the last text it wrote. */
export async function loop(
  p: Purchase,
  actor: 'clerk' | 'agent',
  system: string,
  user: unknown,
  tools: LlmTool[],
  handlers: Handlers,
  llm: Llm,
  done: () => boolean,
  maxTurns: number,
  image?: string, // a data URL the model should look at together with `user`
): Promise<string> {
  const text = JSON.stringify(user);
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: image ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: image } }] : text },
  ];
  let last = '';
  for (let turn = 0; turn < maxTurns && !done(); turn++) {
    const reply = await llm(messages, tools);
    const calls = reply.tool_calls ?? [];
    const said = reply.content?.trim() ?? '';
    // A reply with neither text nor tool calls is not sent back: providers reject an empty assistant message.
    if (calls.length || said) messages.push({ role: 'assistant', content: reply.content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (said) {
      last = said;
      if (actor === 'agent') store.emit(p.id, { actor, type: 'note', summary: said });
    }
    if (!calls.length) break;
    // One at a time, in the order the model gave: these are steps of one payment, not independent lookups.
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        /* malformed arguments are treated as empty; the tool says what is missing */
      }
      const handler = handlers[call.function.name];
      let result: ToolResult;
      try {
        result = handler ? await handler(args) : { ok: false, refused: true, error: `There is no tool ${call.function.name}.` };
      } catch (e) {
        result = { ok: false, refused: false, error: (e as Error).message };
        store.emit(p.id, { actor: 'desk', type: 'error', summary: `PayPal said: ${(e as Error).message}` });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4000) });
    }
  }
  return last;
}

export const STYLE = `Write to the buyer in the language they use (their language code is given; if they write in another language, answer in that one). Short, plain sentences. No sales talk, no flattery, no emoji.`;

// ---- settlement: after the buyer approved at PayPal ----

const SETTLE = `You settle one payment for ${SELLER.shop}. The buyer was quoted a price for one country and has approved a payment at PayPal. The rule: the payment is taken only if PayPal reports that the wallet is registered in the quoted country. The desk enforces this in code and will refuse anything else.

Steps:
1. Call read_order to see what PayPal reports: the order status and the wallet's country.
2. If the wallet's country matches the quoted country: call hold_payment, then take_payment.
3. If it does not match, or PayPal reports no country: call release_payment. Nothing is taken.
4. If a step is refused, read the reason. Do not repeat a refused step; release_payment is always safe.
5. Call finish with the result ("paid" or "released") and a message for the buyer: what PayPal reported, and what happened to their money. If the payment was released because of the country, say that nothing was taken and that they can buy at the price for their wallet's country. Do not state amounts other than those in the tool results.

Before each step, write one short sentence saying what you are about to do. ${STYLE}`;

const SETTLE_TOOLS = [
  fn('read_order', 'Ask PayPal about this order: its status and the country the paying wallet is registered in.'),
  fn('hold_payment', 'Have PayPal place the hold the buyer approved (authorise). Nothing is taken yet.'),
  fn('take_payment', 'Capture the held payment. Refused unless the wallet country matches the quote.'),
  fn('release_payment', 'Release the hold, or abandon the order if no hold was placed. Nothing is taken.'),
  fn('finish', 'End with the result and the message the buyer will read.', { result: { type: 'string', enum: ['paid', 'released'] }, message: { type: 'string' } }, ['result', 'message']),
];

const openHold = (order: OrderView) => !!order.authorizationId && order.authorizationStatus !== 'VOIDED' && order.authorizationStatus !== 'CAPTURED';
const taken = (order: OrderView) => !!order.captureId || order.authorizationStatus === 'CAPTURED';
const walletKey = (p: Purchase) => `${p.paypal.payerId}:${p.productId}`;
const nameOf = (p: Purchase, country: string) => priceFor(productById(p.productId)!, RULES, country)?.countryName ?? country;

/** PayPal is asked afresh every time: no decision rests on something the model remembered. */
async function readOrder(p: Purchase): Promise<OrderView> {
  const order = await backend().getOrder(p.paypal.orderId!);
  // PayPal reports mainland China as C2 in some places; the income table and quotes use CN.
  if (order.payerCountry) order.payerCountry = order.payerCountry.toUpperCase() === 'C2' ? 'CN' : order.payerCountry.toUpperCase();
  if (order.payerCountry) p.paypal.walletCountry = order.payerCountry;
  if (order.payerId) p.paypal.payerId = order.payerId;
  if (order.authorizationId) p.paypal.authorizationId = order.authorizationId;
  return order;
}

/** Records a capture PayPal has made. Safe to call twice: the pool and the ledger move once. */
function markCaptured(p: Purchase, captureId: string): void {
  if (p.paypal.captureId) return;
  p.paypal.captureId = captureId;
  p.status = 'captured';
  store.bought.add(walletKey(p));
  const move = (kind: 'gift' | 'help', cents: number) => {
    if (!cents) return;
    store.pool.balance = fromCents(toCents(store.pool.balance) + (kind === 'gift' ? cents : -cents));
    store.pool.entries.push({ ts: new Date().toISOString(), ref: p.ref, kind, amount: fromCents(cents), country: p.quote.price.country });
  };
  move('gift', toCents(p.gift));
  move('help', toCents(p.help?.amount ?? '0'));
}

// Sentences written by code when PayPal's record could not be read or is not final. A later check replaces them.
const UNSURE_TAKEN = 'PayPal took the payment, but could not be reached just now to confirm it.';
const UNSURE_RELEASED = 'PayPal could not be reached to confirm the result. This shop will not take the payment; a hold that is still open at PayPal expires on its own.';
const PROCESSING = 'PayPal accepted the payment and is still processing it. Nothing more is needed from you.';
const PROVISIONAL = [UNSURE_TAKEN, UNSURE_RELEASED, PROCESSING];

/**
 * The closing check: PayPal's record decides what a purchase is, whatever the model did or said.
 * A capture PayPal holds is recorded; a hold that is still open is released; nothing is ever taken here.
 * `said` is what the model claimed (or an earlier confirmed message); it is shown only if it agrees with PayPal.
 */
async function confirm(p: Purchase, said: { refusal?: string; result?: string; message?: string } = {}): Promise<void> {
  try {
    let order = await readOrder(p);
    if (order.captureId && (order.captureStatus === 'COMPLETED' || order.captureStatus === 'PENDING')) markCaptured(p, order.captureId);
    else if (openHold(order)) {
      store.emit(p.id, { actor: 'system', type: 'status', summary: 'A hold was still open at PayPal, so it is being released.' });
      await backend().voidAuthorization(order.authorizationId!);
      order = await readOrder(p);
    }
    if (p.status !== 'captured') p.status = 'voided';
    const captured = p.status === 'captured';
    const verified = captured ? order.captureStatus === 'COMPLETED' : !order.captureId && !openHold(order);
    const mismatch = !captured && !!p.paypal.walletCountry && p.paypal.walletCountry !== p.quote.price.country;
    const earlier = p.outcome?.offer;
    const offer = !mismatch ? null : earlier && earlier.price.country === p.paypal.walletCountry && earlier.expiresAt > new Date().toISOString() ? earlier : makeQuote(p.productId, p.paypal.walletCountry);
    const why =
      said.refusal ||
      (mismatch
        ? `PayPal reports this wallet is registered in ${nameOf(p, p.paypal.walletCountry!)}. The price was quoted for ${p.quote.price.countryName}.`
        : p.paypal.walletCountry
          ? 'The payment could not be completed, so it was released.'
          : 'PayPal did not report which country this wallet is registered in.');
    const fallback = !captured ? `Nothing was taken. ${why}` : verified ? `Paid. PayPal confirmed the wallet is registered in ${p.quote.price.countryName}.` : PROCESSING;
    // The model's words are shown only when they agree with what PayPal shows.
    const agrees = !!said.message && said.result === (captured ? 'paid' : 'released');
    p.outcome = { captured, verified, text: agrees ? said.message! : fallback, ...(offer && typeof offer !== 'string' ? { offer } : {}) };
    store.emit(p.id, {
      actor: 'system',
      type: 'outcome',
      summary: captured ? `Paid $${p.amount}${verified ? ', confirmed with PayPal' : ', not yet confirmed by PayPal'}.` : `Released. Nothing was taken. ${why}`,
    });
  } catch (e) {
    const captured = p.status === 'captured';
    if (!captured) p.status = 'voided';
    p.outcome = { captured, verified: false, text: captured ? UNSURE_TAKEN : UNSURE_RELEASED };
    store.emit(p.id, { actor: 'system', type: 'error', summary: `PayPal could not be reached to confirm the result: ${(e as Error).message}` });
  }
}

const rechecked = new Map<string, number>();
/**
 * Asks PayPal again about a settled purchase whose result was not confirmed (PayPal was unreachable, or the capture
 * was still being processed). Called when someone looks at the purchase; at most once a minute, for a day.
 */
export async function recheck(purchaseId: string, minGapMs = 60_000): Promise<void> {
  const p = store.purchases.get(purchaseId);
  if (!p || !p.outcome || p.outcome.verified || p.running || !p.paypal.orderId) return;
  if (p.status !== 'captured' && p.status !== 'voided') return;
  const now = Date.now();
  if (now - Date.parse(p.createdAt) > 24 * 3600_000 || now - (rechecked.get(p.id) ?? 0) < minGapMs) return;
  rechecked.set(p.id, now);
  p.running = true;
  try {
    const { captured, text } = p.outcome;
    await confirm(p, PROVISIONAL.includes(text) ? {} : { result: captured ? 'paid' : 'released', message: text });
  } finally {
    p.running = false;
    if (p.outcome.verified) rechecked.delete(p.id);
  }
}

/**
 * Called when a browser arrives at the return address. Anyone can open that address, so nothing is settled on its
 * word: settlement starts only if PayPal itself says the buyer approved this order. Otherwise the purchase is left as it is.
 */
export async function settleWhenApproved(purchaseId: string): Promise<void> {
  const p = store.purchases.get(purchaseId);
  if (!p || p.status !== 'approving' || p.running || !p.paypal.orderId) return;
  try {
    if ((await backend().getOrder(p.paypal.orderId)).status !== 'APPROVED') return;
  } catch {
    return; // PayPal could not be asked; the buyer's page offers to try again
  }
  // Past the day's allowance of model runs the rules settle it, so an approved payment is never left hanging.
  await runSettlement(purchaseId, store.takeRun('settle') ? defaultLlm : null);
}

/**
 * Decides and carries out one payment after the buyer approved it. Errors are reported on the purchase, not thrown.
 * With `llm` null the rules settle it without a model (used when the day's model allowance is spent).
 */
export async function runSettlement(purchaseId: string, llm: Llm | null = defaultLlm): Promise<void> {
  const p = store.purchases.get(purchaseId);
  if (!p || p.status !== 'approving' || p.running || !p.paypal.orderId) return;
  const product = productById(p.productId)!;
  const pp = backend();
  const orderId = p.paypal.orderId;
  p.status = 'settling';
  p.running = true;
  store.emit(p.id, { actor: 'system', type: 'status', summary: 'The buyer approved at PayPal. Checking the wallet.' });

  // The tools below change the status; TypeScript cannot see that through the closures, so it is read through this.
  const status = () => p.status as Purchase['status'];
  let message = '';
  let claimed = ''; // what the model said happened; believed only if PayPal agrees
  let finished = false;
  let refusal = ''; // why the rules refused to take the payment, if they did

  const release = async (): Promise<string> => {
    const order = await readOrder(p);
    // If PayPal already took the payment (for example the answer to a capture was lost), that is the truth to record.
    if (taken(order)) {
      if (order.captureId) markCaptured(p, order.captureId);
      return 'The payment was already taken at PayPal, so it cannot be released.';
    }
    if (openHold(order)) {
      await pp.voidAuthorization(order.authorizationId!);
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: `Released the hold at PayPal (authorisation ${order.authorizationId}). Nothing was taken.` });
    } else {
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: 'No hold had been placed. The order is left unpaid and nothing was taken.' });
    }
    p.status = 'voided';
    return 'Released. Nothing was taken.';
  };

  const handlers: Handlers = {
    read_order: async () => {
      const order = await readOrder(p);
      store.emit(p.id, {
        actor: 'desk',
        type: 'tool',
        summary: `PayPal: order ${orderId} is ${order.status}. The wallet is registered in ${order.payerCountry ? nameOf(p, order.payerCountry) : 'a country PayPal did not report'}.`,
        detail: { result: order },
      });
      return ok({ status: order.status, wallet_country: order.payerCountry ?? null, quoted_country: p.quote.price.country, amount: order.amount, hold_placed: !!order.authorizationId });
    },
    hold_payment: async () => {
      if (status() !== 'settling') return refuse(p, 'This payment has already been settled. No new hold is placed.');
      const before = await readOrder(p);
      if (before.authorizationId) return ok({ hold: before.authorizationId });
      if (before.status !== 'APPROVED') return refuse(p, `The buyer has not approved this order at PayPal (status ${before.status}).`);
      // The country is known before any hold is placed, so a mismatch never ties up the buyer's money.
      if (before.payerCountry && before.payerCountry !== p.quote.price.country) {
        refusal = `PayPal reports this wallet is registered in ${nameOf(p, before.payerCountry)}. The price was quoted for ${p.quote.price.countryName}.`;
        return refuse(p, `${refusal} No hold is placed.`);
      }
      const a = await pp.authorizeOrder(orderId);
      p.paypal.authorizationId = a.authorizationId;
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: `PayPal is holding $${p.amount} (authorisation ${a.authorizationId}). Nothing is taken yet.` });
      return ok({ hold: a.authorizationId });
    },
    take_payment: async () => {
      if (status() !== 'settling') return refuse(p, status() === 'captured' ? 'This payment was already taken.' : 'This payment was released. It cannot be taken.');
      const order = await readOrder(p);
      const decision = captureDecision({ purchase: p, order, alreadyBought: store.bought.has(walletKey(p)) });
      if (!decision.capture) {
        refusal = decision.reason;
        return refuse(p, decision.reason);
      }
      if (toCents(p.help?.amount ?? '0') > toCents(store.pool.balance)) {
        refusal = 'The pool can no longer cover the help that was promised for this purchase.';
        return refuse(p, refusal);
      }
      // Taken before the call, not after: two purchases from one wallet may be settling at the same moment.
      store.bought.add(walletKey(p));
      let c: { captureId: string; status: string };
      try {
        c = await pp.captureAuthorization(order.authorizationId!, `capture-${p.ref}`);
      } catch (e) {
        store.bought.delete(walletKey(p)); // the closing check asks PayPal whether it went through after all
        throw e;
      }
      if (c.status !== 'COMPLETED' && c.status !== 'PENDING') {
        store.bought.delete(walletKey(p));
        throw new Error(`PayPal answered the capture with status ${c.status}.`);
      }
      markCaptured(p, c.captureId);
      store.emit(p.id, {
        actor: 'desk',
        type: 'tool',
        summary: c.status === 'COMPLETED' ? `PayPal took $${p.amount} (capture ${c.captureId}). The wallet country matched the quote.` : `PayPal accepted the capture of $${p.amount} (${c.captureId}) and is still processing it.`,
      });
      return ok({ captured: c.captureId, amount: p.amount, status: c.status });
    },
    release_payment: async () => {
      if (status() === 'captured') return refuse(p, 'This payment was already taken.');
      return ok({ result: await release() });
    },
    finish: async (a) => {
      message = String(a.message ?? '').slice(0, 1200);
      claimed = String(a.result ?? '');
      finished = true;
      return ok({ done: true });
    },
  };

  /** The same steps the agent is asked to take, driven by code. Used when no model is available. */
  const settleByRules = async () => {
    store.emit(p.id, { actor: 'system', type: 'status', summary: 'The agent is not available, so the rules settle this payment directly.' });
    const held = await handlers.hold_payment({});
    const result = held.ok ? await handlers.take_payment({}) : held;
    if (!result.ok && status() === 'settling') await release();
  };

  try {
    if (!llm) await settleByRules();
    else {
      try {
        await loop(
          p,
          'agent',
          SETTLE,
          { product: product.title, quoted_country: p.quote.price.country, quoted_country_name: p.quote.price.countryName, amount: p.amount, buyer_language: p.buyer.language, buyer_is_an_ai_agent: p.buyer.viaAgent },
          SETTLE_TOOLS,
          handlers,
          llm,
          () => finished,
          10,
        );
      } catch (e) {
        // The model itself failed (not a refused step). A buyer who approved should not lose the sale to an outage.
        store.emit(p.id, { actor: 'system', type: 'error', summary: `The agent stopped: ${(e as Error).message}` });
        if (status() === 'settling') await settleByRules();
      }
    }
  } catch (e) {
    store.emit(p.id, { actor: 'system', type: 'error', summary: `Settlement stopped: ${(e as Error).message}` });
  }

  await confirm(p, { refusal, ...(finished ? { result: claimed, message } : {}) });
  p.running = false;
  store.emit(p.id, { actor: 'system', type: 'status', summary: 'Done.' });
}
