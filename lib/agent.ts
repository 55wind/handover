import OpenAI from 'openai';
import { backend } from './paypal';
import { amountDue, captureDecision, fromCents, helpLimitCents, priceFor, toCents } from './pricing';
import { RULES, SELLER, isScripted, productById } from './seller';
import { grantsThisMonth, makeQuote, poolAvailableCents } from './shop';
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
  | { role: 'system' | 'user'; content: string }
  | ({ role: 'assistant' } & LlmReply)
  | { role: 'tool'; tool_call_id: string; content: string };
export type Llm = (messages: LlmMessage[], tools: LlmTool[]) => Promise<LlmReply>;

let client: OpenAI | undefined;
let standIn: Llm | undefined;
const defaultLlm: Llm = async (messages, tools) => {
  if (isScripted()) {
    standIn ??= (await import('./llm-scripted')).scripted();
    return standIn(messages, tools);
  }
  if (!process.env.OPENAI_API_KEY || !process.env.LLM_MODEL) {
    throw new Error('No language model is configured. Set OPENAI_API_KEY and LLM_MODEL.');
  }
  client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: messages as never,
    ...(tools.length ? { tools } : {}),
  });
  const m = res.choices[0].message;
  return { content: m.content, tool_calls: m.tool_calls as LlmCall[] | undefined };
};

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): LlmTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

type Handlers = Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>;
const ok = (data: unknown): ToolResult => ({ ok: true, data });
const refuse = (p: Purchase, error: string): ToolResult => {
  store.emit(p.id, { actor: 'rules', type: 'refused', summary: `Refused: ${error}` });
  return { ok: false, refused: true, error };
};

/** Runs the model with tools until `done()` or it stops calling tools. Returns the last text it wrote. */
async function loop(p: Purchase, actor: 'clerk' | 'agent', system: string, user: unknown, tools: LlmTool[], handlers: Handlers, llm: Llm, done: () => boolean, maxTurns: number): Promise<string> {
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(user) },
  ];
  let last = '';
  for (let turn = 0; turn < maxTurns && !done(); turn++) {
    const reply = await llm(messages, tools);
    const calls = reply.tool_calls ?? [];
    const text = reply.content?.trim() ?? '';
    // A reply with neither text nor tool calls is not sent back: providers reject an empty assistant message.
    if (calls.length || text) messages.push({ role: 'assistant', content: reply.content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (text) {
      last = text;
      if (actor === 'agent') store.emit(p.id, { actor, type: 'note', summary: text });
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

const STYLE = `Write to the buyer in the language they use (their language code is given; if they write in another language, answer in that one). Short, plain sentences. No sales talk, no flattery, no emoji.`;

// ---- the clerk: talks to a buyer before they pay ----

const CLERK = `You are the clerk at ${SELLER.shop}, a small seller of digital goods in ${SELLER.place}. The shop prices in hours of average income instead of dollars: a buyer is quoted the amount that costs them a comparable share of local income, inside the seller's limits. Figures come from the World Bank (income per person, divided by 2,000 working hours); they are averages, not wages.

How it works, which you may explain:
- The price depends on the country the buyer's PayPal wallet is registered in. PayPal reports that country when the buyer approves the payment. If it matches the quote the payment is taken; if not, nothing is taken and the buyer is shown the price for their wallet's country.
- You cannot change which country a price is for, and you cannot change a price yourself.
- Some buyers' circumstances do not match their wallet's country: a student abroad, someone supporting family elsewhere, someone who has lost their income. For them you may give help from a pool that other buyers paid into. Use help_limit to see how much is possible, then grant_help with an amount and a one-sentence reason. Give help only when the buyer has told you such a circumstance. You do not need proof; the limits are small on purpose. If the pool is empty, say so plainly.
- Never promise an amount before a tool has confirmed it.

${STYLE} Answer in at most four sentences.`;

/** One turn of conversation. The reply is appended to the purchase's messages. */
export async function runClerk(purchaseId: string, text: string, llm: Llm = defaultLlm): Promise<string | null> {
  const p = store.purchases.get(purchaseId);
  if (!p) return 'This purchase is no longer available.';
  if (p.status !== 'open') return 'The payment has already started.';
  if (p.running) return 'The clerk is still answering.';
  const product = productById(p.productId)!;
  p.running = true;
  p.messages.push({ from: 'buyer', text, ts: new Date().toISOString() });
  const limit = () => helpLimitCents(product, RULES, p.quote.price.fair, poolAvailableCents(p), grantsThisMonth());
  const handlers: Handlers = {
    price_for_country: async (a) => {
      const price = priceFor(product, RULES, String(a.country ?? '').toUpperCase());
      return price ? ok(price) : { ok: false, refused: false, error: 'There is no income figure for that country.' };
    },
    help_limit: async () => {
      const l = limit();
      return ok({ most_you_can_give: fromCents(l.maxCents), why: l.why, already_given_to_this_buyer: p.help?.amount ?? '0.00' });
    },
    grant_help: async (a) => {
      const cents = toCents(String(a.amount ?? ''));
      const l = limit();
      if (!(cents > 0)) return refuse(p, 'Help needs an amount above 0.00.');
      if (cents > l.maxCents) return refuse(p, `At most $${fromCents(l.maxCents)} can be given. ${l.why}`);
      p.help = { amount: fromCents(cents), reason: String(a.reason ?? '').slice(0, 300) };
      p.amount = amountDue(p.quote.price.fair, p.help.amount, p.gift);
      store.emit(p.id, { actor: 'clerk', type: 'tool', summary: `The clerk took $${p.help.amount} off from the pool. ${p.help.reason}` });
      return ok({ help: p.help.amount, buyer_now_pays: p.amount });
    },
  };
  try {
    const reply = await loop(
      p,
      'clerk',
      CLERK,
      {
        product: { title: product.title, list_price: product.listPrice },
        quote: p.quote.price,
        gift_added_by_buyer: p.gift,
        help_already_given: p.help ?? null,
        buyer_language: p.buyer.language,
        conversation: p.messages,
      },
      [
        fn('price_for_country', 'Look up the price of this product for another country, for explaining or comparing.', { country: { type: 'string', description: 'Two-letter country code, e.g. VN' } }, ['country']),
        fn('help_limit', 'See how much help could be given to this buyer right now, and why that is the limit.'),
        fn('grant_help', 'Take an amount off this buyer\'s price, paid from the pool. Only after the buyer has told you why their circumstances differ from their wallet\'s country.', { amount: { type: 'string', description: 'USD, e.g. "4.00"' }, reason: { type: 'string', description: 'One sentence, in English, for the seller\'s ledger' } }, ['amount', 'reason']),
      ],
      handlers,
      llm,
      () => false,
      6,
    );
    p.messages.push({ from: 'clerk', text: reply || 'I could not answer that just now. The price shown is still valid.', ts: new Date().toISOString() });
    return null;
  } catch (e) {
    p.messages.push({ from: 'clerk', text: 'The clerk is not available right now. The price shown is still valid and you can pay without talking to the clerk.', ts: new Date().toISOString() });
    store.emit(p.id, { actor: 'system', type: 'error', summary: `The clerk stopped: ${(e as Error).message}` });
    return null;
  } finally {
    p.running = false;
  }
}

// ---- settlement: after the buyer approved at PayPal ----

const SETTLE = `You settle one payment for ${SELLER.shop}. The buyer was quoted a price for one country and has approved a payment at PayPal. The rule: the payment is taken only if PayPal reports that the wallet is registered in the quoted country. The desk enforces this in code and will refuse anything else.

Steps:
1. Call read_order to see what PayPal reports: the order status and the wallet's country.
2. If the wallet's country matches the quoted country: call hold_payment, then take_payment.
3. If it does not match, or PayPal reports no country: call release_payment. Nothing is taken.
4. If a step is refused, read the reason. Do not repeat a refused step; release_payment is always safe.
5. Call finish with a message for the buyer: what PayPal reported, and what happened to their money. If the payment was released because of the country, say that nothing was taken and that they can buy at the price for their wallet's country. Do not state amounts other than those in the tool results.

Before each step, write one short sentence saying what you are about to do. ${STYLE}`;

const SETTLE_TOOLS = [
  fn('read_order', 'Ask PayPal about this order: its status and the country the paying wallet is registered in.'),
  fn('hold_payment', 'Have PayPal place the hold the buyer approved (authorise). Nothing is taken yet.'),
  fn('take_payment', 'Capture the held payment. Refused unless the wallet country matches the quote.'),
  fn('release_payment', 'Release the hold, or abandon the order if no hold was placed. Nothing is taken.'),
  fn('finish', 'End with the message the buyer will read.', { message: { type: 'string' } }, ['message']),
];

/** Decides and carries out one payment after the buyer approved it. Errors are reported on the purchase, not thrown. */
export async function runSettlement(purchaseId: string, llm: Llm = defaultLlm): Promise<void> {
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
  let finished = false;
  let refusal = ''; // why the rules refused to take the payment, if they did

  /** PayPal is asked afresh every time: the decision never rests on something the model remembered. */
  const read = async (): Promise<OrderView> => {
    const order = await pp.getOrder(orderId);
    // PayPal reports mainland China as C2 in some places; the income table and quotes use CN.
    if (order.payerCountry) order.payerCountry = order.payerCountry.toUpperCase() === 'C2' ? 'CN' : order.payerCountry.toUpperCase();
    if (order.payerCountry) p.paypal.walletCountry = order.payerCountry;
    if (order.payerId) p.paypal.payerId = order.payerId;
    if (order.authorizationId) p.paypal.authorizationId = order.authorizationId;
    return order;
  };
  const alreadyBought = () => !!p.paypal.payerId && store.bought.has(`${p.paypal.payerId}:${p.productId}`);

  const release = async (): Promise<string> => {
    if (status() === 'captured') return 'The payment was already taken.';
    const order = await read();
    if (order.authorizationId && order.authorizationStatus !== 'VOIDED' && order.authorizationStatus !== 'CAPTURED') {
      await pp.voidAuthorization(order.authorizationId);
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: `Released the hold at PayPal (authorisation ${order.authorizationId}). Nothing was taken.` });
    } else {
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: 'No hold had been placed. The order is left unpaid and nothing was taken.' });
    }
    p.status = 'voided';
    return 'Released. Nothing was taken.';
  };

  const handlers: Handlers = {
    read_order: async () => {
      const order = await read();
      store.emit(p.id, {
        actor: 'desk',
        type: 'tool',
        summary: `PayPal: order ${orderId} is ${order.status}. The wallet is registered in ${order.payerCountry ? (priceFor(product, RULES, order.payerCountry)?.countryName ?? order.payerCountry) : 'a country PayPal did not report'}.`,
        detail: { result: order },
      });
      return ok({ status: order.status, wallet_country: order.payerCountry ?? null, quoted_country: p.quote.price.country, amount: order.amount, hold_placed: !!order.authorizationId });
    },
    hold_payment: async () => {
      const before = await read();
      if (before.authorizationId) return ok({ hold: before.authorizationId });
      if (before.status !== 'APPROVED') return refuse(p, `The buyer has not approved this order at PayPal (status ${before.status}).`);
      // The country is known before any hold is placed, so a mismatch never ties up the buyer's money.
      if (before.payerCountry && before.payerCountry.toUpperCase() !== p.quote.price.country) {
        refusal = `PayPal reports this wallet is in ${priceFor(product, RULES, before.payerCountry)?.countryName ?? before.payerCountry}. The price was quoted for ${p.quote.price.countryName}.`;
        return refuse(p, `${refusal} No hold is placed.`);
      }
      const a = await pp.authorizeOrder(orderId);
      p.paypal.authorizationId = a.authorizationId;
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: `PayPal is holding $${p.amount} (authorisation ${a.authorizationId}). Nothing is taken yet.` });
      return ok({ hold: a.authorizationId });
    },
    take_payment: async () => {
      if (status() === 'captured') return refuse(p, 'This payment was already taken.');
      const order = await read();
      const decision = captureDecision({ purchase: p, order, alreadyBought: alreadyBought() });
      if (!decision.capture) {
        refusal = decision.reason;
        return refuse(p, decision.reason);
      }
      const c = await pp.captureAuthorization(order.authorizationId!, `capture-${p.id}`);
      p.paypal.captureId = c.captureId;
      p.status = 'captured';
      store.bought.add(`${p.paypal.payerId}:${p.productId}`);
      const move = (kind: 'gift' | 'help', cents: number) => {
        if (!cents) return;
        store.pool.balance = fromCents(Math.max(0, toCents(store.pool.balance) + (kind === 'gift' ? cents : -cents)));
        store.pool.entries.push({ ts: new Date().toISOString(), purchaseId: p.id, kind, amount: fromCents(cents) });
      };
      move('gift', toCents(p.gift));
      move('help', toCents(p.help?.amount ?? '0'));
      store.emit(p.id, { actor: 'desk', type: 'tool', summary: `PayPal took $${p.amount} (capture ${c.captureId}). The wallet country matched the quote.` });
      return ok({ captured: c.captureId, amount: p.amount });
    },
    release_payment: async () => ok({ result: await release() }),
    finish: async (a) => {
      message = String(a.message ?? '').slice(0, 1200);
      finished = true;
      return ok({ done: true });
    },
  };

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
    store.emit(p.id, { actor: 'system', type: 'error', summary: `The agent stopped: ${(e as Error).message}` });
  }

  // Whatever the agent did or did not do, the purchase must end either taken and confirmed, or released.
  // Code never takes a payment here: anything still open is released.
  try {
    if (status() !== 'captured' && status() !== 'voided') {
      store.emit(p.id, { actor: 'system', type: 'status', summary: 'The agent left this payment open, so it is being released.' });
      await release();
    }
    const order = await read();
    const captured = status() === 'captured';
    const verified = captured ? order.captureStatus === 'COMPLETED' : order.captureStatus === undefined;
    const mismatch = !captured && !!p.paypal.walletCountry && p.paypal.walletCountry !== p.quote.price.country;
    const offer = mismatch ? makeQuote(p.productId, p.paypal.walletCountry) : null;
    const fallback = captured
      ? `Paid. PayPal confirmed the wallet is registered in ${p.quote.price.countryName}.`
      : `Nothing was taken. ${refusal || 'The payment could not be confirmed, so it was released.'}`;
    p.outcome = { captured, verified, text: message || fallback, ...(offer && typeof offer !== 'string' ? { offer } : {}) };
    store.emit(p.id, {
      actor: 'system',
      type: 'outcome',
      summary: captured ? `Paid $${p.amount}${verified ? ', confirmed with PayPal' : ''}.` : `Released. ${refusal || 'Nothing was taken.'}`,
    });
  } catch (e) {
    p.outcome = { captured: status() === 'captured', verified: false, text: 'PayPal could not be reached to confirm the result. This shop will not take the payment; a hold that is still open at PayPal expires on its own.' };
    store.emit(p.id, { actor: 'system', type: 'error', summary: `PayPal could not be reached to confirm the result: ${(e as Error).message}` });
    if (status() === 'settling') p.status = 'voided';
  } finally {
    p.running = false;
    store.emit(p.id, { actor: 'system', type: 'status', summary: 'Done.' });
  }
}
