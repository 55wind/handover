// The clerk: the shop's voice. It greets a buyer in their language, explains the price in hours, listens, reads a
// document if one is shown, and may lower the price from the pool. Every amount and every limit comes from code.
import { STYLE, defaultLlm, fn, loop, ok, refuse, type Handlers, type Llm } from './agent';
import { amountDue, fromCents, helpLimitCents, priceFor, toCents } from './pricing';
import { RULES, SELLER, productById } from './seller';
import { grantsThisMonth, poolAvailableCents, setGift } from './shop';
import { store } from './store';

const PROMPT = `You are the clerk at ${SELLER.shop}, a one-person shop in ${SELLER.place} that sells digital goods to the whole world. Think of a shopkeeper who knows the neighbourhood: you explain the price honestly, you listen, and when someone's situation calls for it you can take a little off. The difference is that your neighbourhood is two hundred countries.

How the shop prices:
- A price is shown in hours of average income, not only dollars. A buyer is quoted the amount that costs them a comparable share of local income, inside the seller's limits. The figures are World Bank income per person divided by 2,000 working hours: averages, not anyone's wage. Say so if it matters.
- The price depends on the country the buyer's PayPal wallet is registered in. PayPal reports that country when the buyer approves the payment. If it matches, the payment is taken. If not, nothing is taken and the buyer is shown the price for their wallet's country. You cannot change which country a price is for.

What you can do:
- Help. Some people's situation is harder than their wallet's country suggests: studying abroad, out of work, supporting family elsewhere, illness, displacement, a small pension. When a buyer tells you such a thing, call help_limit to see what is possible, then grant_help with an amount and a one-sentence reason. The money comes from a pool: the seller opened it with a small sum and other buyers add to it when they cover an hour for someone. Ask at most one clarifying question; do not interrogate. If the pool is empty, say so plainly and kindly.
- Read a document. If the buyer shows one (a student card, an enrolment letter, a benefits letter), say in a few words what it is, and call record_evidence with whether it supports what they told you. A document that supports their word raises the limit. You cannot tell whether a document is genuine; do not claim to.
- Take a gift. If the buyer wants to cover an hour for someone, call set_gift. If the list price costs this buyer less than two hours of average income you may mention this once, in one sentence. Never press, never repeat it.
- Say where the pool went. pool_status tells you what the pool holds and where recent help and gifts came from, by country only. A negative amount is an earlier entry undone by a refund.

What you never do:
- Bargain. If someone only asks for a lower price, say kindly that you do not haggle, and what you can do instead.
- Promise an amount before a tool has confirmed it, or state a figure that did not come from a tool or from the quote.
- Ask for personal details, or lecture.

${STYLE} At most four sentences per reply.`;

const GREET = `This is the start of the conversation. Greet the buyer in their language in one short sentence, then tell them the price for their country and what it costs in hours of average income there, compared with the list price. End by saying they can tell you if their situation is different from what their country suggests.`;

export interface ClerkInput {
  text?: string;
  greet?: boolean;
  documentDataUrl?: string;
}

/** One turn of conversation. The reply is appended to the purchase's messages. Returns an error sentence or null. */
export async function runClerk(purchaseId: string, input: ClerkInput, llm: Llm = defaultLlm): Promise<string | null> {
  const p = store.purchases.get(purchaseId);
  if (!p) return 'This purchase is no longer available.';
  if (p.status !== 'open') return 'The payment has already started.';
  if (p.running) return 'The clerk is still answering.';
  const product = productById(p.productId)!;
  const text = input.text?.trim() ?? '';
  if (!input.greet && !text && !input.documentDataUrl) return 'Please write something for the clerk.';
  p.running = true;
  if (!input.greet) p.messages.push({ from: 'buyer', text: text || 'Here is a document.', ts: new Date().toISOString() });

  const limit = () => helpLimitCents(product, RULES, p.quote.price.fair, poolAvailableCents(p), grantsThisMonth(), p.evidence?.supports === true);
  const handlers: Handlers = {
    price_for_country: async (a) => {
      const price = priceFor(product, RULES, String(a.country ?? '').toUpperCase());
      return price ? ok(price) : { ok: false, refused: false, error: 'There is no income figure for that country.' };
    },
    pool_status: async () =>
      ok({
        available_now: fromCents(poolAvailableCents(p)),
        recent: store.pool.entries.slice(-4).map((e) =>
          e.kind === 'seed'
            ? { kind: 'opening sum from the seller', amount: e.amount }
            : { kind: e.kind, amount: e.amount, buyer_country: (e.country && priceFor(product, RULES, e.country)?.countryName) || 'unknown' },
        ),
      }),
    help_limit: async () => {
      const l = limit();
      return ok({ most_you_can_give: fromCents(l.maxCents), why: l.why, already_given_to_this_buyer: p.help?.amount ?? '0.00', document_on_record: p.evidence ?? null });
    },
    grant_help: async (a) => {
      const cents = toCents(String(a.amount ?? ''));
      const l = limit();
      if (!(cents > 0)) return refuse(p, 'Help needs an amount above 0.00.');
      if (cents > l.maxCents) return refuse(p, `At most $${fromCents(l.maxCents)} can be given. ${l.why}`);
      p.help = { amount: fromCents(cents), reason: String(a.reason ?? '').slice(0, 300) };
      p.amount = amountDue(p.quote.price.fair, p.help.amount, p.gift);
      store.emit(p.id, { actor: 'clerk', type: 'tool', summary: `The clerk took $${p.help.amount} off, from the pool. ${p.help.reason}` });
      return ok({ help: p.help.amount, buyer_now_pays: p.amount });
    },
    set_gift: async (a) => {
      const error = setGift(p, String(a.amount ?? ''));
      if (error) return refuse(p, error);
      store.emit(p.id, { actor: 'clerk', type: 'tool', summary: Number(p.gift) > 0 ? `The buyer adds $${p.gift} to cover an hour for someone.` : 'The buyer adds no gift.' });
      return ok({ gift: p.gift, buyer_now_pays: p.amount });
    },
    record_evidence: async (a) => {
      if (!input.documentDataUrl) return refuse(p, 'No document was shown in this message.');
      p.evidence = { kind: String(a.kind ?? 'document').slice(0, 80), supports: a.supports === true, note: String(a.note ?? '').slice(0, 300) };
      store.emit(p.id, {
        actor: 'clerk',
        type: 'tool',
        summary: `The clerk read a document (${p.evidence.kind}). It ${p.evidence.supports ? 'supports' : 'does not support'} what the buyer said. The image was not kept.`,
      });
      return ok({ recorded: true, limit_now: fromCents(limit().maxCents) });
    },
  };

  const tools = [
    fn('price_for_country', 'Look up the price of this product for another country, for explaining or comparing.', { country: { type: 'string', description: 'Two-letter country code, e.g. VN' } }, ['country']),
    fn('pool_status', 'What the pool holds right now, and where recent gifts and help came from (countries only).'),
    fn('help_limit', 'How much help could be given to this buyer right now, and which limit decides it.'),
    fn(
      'grant_help',
      "Take an amount off this buyer's price, paid from the pool. Only after the buyer has told you why their situation is harder than their wallet's country suggests.",
      { amount: { type: 'string', description: 'USD, e.g. "4.00"' }, reason: { type: 'string', description: "One sentence in English for the seller's ledger" } },
      ['amount', 'reason'],
    ),
    fn('set_gift', 'Record that the buyer wants to add a gift to cover an hour for someone, or to remove it.', { amount: { type: 'string', enum: ['0.00', '2.00', '5.00'] } }, ['amount']),
    ...(input.documentDataUrl
      ? [
          fn(
            'record_evidence',
            'Record what the document in this message is and whether it supports what the buyer told you.',
            { kind: { type: 'string', description: 'e.g. "student card", "enrolment letter"' }, supports: { type: 'boolean' }, note: { type: 'string', description: 'One sentence in English: what it shows' } },
            ['kind', 'supports', 'note'],
          ),
        ]
      : []),
  ];

  try {
    const reply = await loop(
      p,
      'clerk',
      input.greet ? `${PROMPT}\n\n${GREET}` : PROMPT,
      {
        start: !!input.greet,
        product: { title: product.title, list_price: product.listPrice },
        quote: p.quote.price,
        gift_added_by_buyer: p.gift,
        help_already_given: p.help ?? null,
        document_on_record: p.evidence ?? null,
        document_attached_to_this_message: !!input.documentDataUrl,
        buyer_language: p.buyer.language,
        conversation: p.messages,
      },
      tools,
      handlers,
      llm,
      () => false,
      7,
      input.documentDataUrl,
    );
    p.messages.push({ from: 'clerk', text: reply || 'I could not answer that just now. The price shown is still valid.', ts: new Date().toISOString() });
    return null;
  } catch (e) {
    p.messages.push({ from: 'clerk', text: 'The clerk is not available right now. The price shown is still valid, and you can pay without talking to the clerk.', ts: new Date().toISOString() });
    store.emit(p.id, { actor: 'system', type: 'error', summary: `The clerk stopped: ${(e as Error).message}` });
    return null;
  } finally {
    p.running = false;
  }
}
