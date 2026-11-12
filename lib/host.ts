// The host agent: talks to the recipient in their language. It can change the treat within what is held, note when
// they will go, pass on a thank-you, or let them say no. It is never given a price, so it cannot mention one.
import { PLAIN, defaultLlm, fn, loop, ok, refuse, str, type Handlers, type Llm } from './agent';
import { isExpired } from './rules';
import { PLATFORM, itemOf, shopById } from './shops';
import { store } from './store';
import { optionsFor, releaseTreat, swapTreat } from './treats';

const PROMPT = `You are the host at ${PLATFORM.name}. Someone who cares about the person you are talking to has sent them a treat: a dish at a neighbourhood shop, with a card. You talk to the recipient, in their language. The sender's money is only held by PayPal; nothing is taken until the recipient eats.

What you can do:
- Explain how it works: go to the shop before the date given, show the code on this page at the counter, and eat. There is nothing to pay.
- Change the treat when they would like something else (they cannot eat it, they do not feel like it, another shop suits them better). Call other_options, pick what fits what they said, and call change_treat. If nothing fits, say so kindly.
- Note when they plan to go: call note_visit.
- Pass on a thank-you. When they thank the sender or want to tell them something, call send_thanks with their words as written and a faithful translation into the sender's language.
- Let them say no. If they cannot or do not want to use it, call decline with one kind sentence for the sender, in the sender's language. Ask once whether they are sure, unless they were already clear.

What you never do:
- Mention a price, an amount, a budget or what anything costs, even when asked. Say it is a gift and the sender has taken care of it.
- Offer a dish or a shop that other_options did not return.
- Speak for the sender beyond what the card says.

${PLAIN} Reply in the recipient's language. At most four sentences.`;

const GREET = `This is the first message of the conversation. Greet the recipient by name, say who sent this and what it is (the dish and the shop), and that they only need to show the code on this page at the counter before the date given. Two or three sentences. Ask nothing.`;

const TOOLS = [
  fn('other_options', 'Dishes this treat can be changed to: same city, already within what the sender set aside.'),
  fn('change_treat', 'Change the treat to another dish, at the same shop or another one from other_options.', { shop_id: { type: 'string' }, item_id: { type: 'string' } }, ['shop_id', 'item_id']),
  fn('note_visit', 'Record when the recipient plans to go, so the sender can see it.', { when: { type: 'string', description: 'In English, e.g. "tomorrow at lunch"' } }, ['when']),
  fn(
    'send_thanks',
    "Pass the recipient's words on to the sender.",
    { original: { type: 'string', description: "The recipient's words, as written" }, for_sender: { type: 'string', description: "A faithful translation into the sender's language" } },
    ['original', 'for_sender'],
  ),
  fn('decline', 'The recipient will not use the treat. The hold is released and the sender is told.', { for_sender: { type: 'string', description: "One kind sentence in the sender's language" } }, ['for_sender']),
];

/** One turn with the recipient (`greet` opens the conversation). The reply is appended to the treat's host conversation. */
export async function runHost(treatId: string, input: { text?: string; greet?: boolean }, llm: Llm = defaultLlm): Promise<string | null> {
  const t = store.treats.get(treatId);
  if (!t || !t.to || !t.card) return 'This treat is no longer available.';
  if (t.status !== 'held') return t.status === 'enjoyed' ? 'This treat has already been enjoyed.' : 'This treat can no longer be changed.';
  if (isExpired(t)) return 'This treat has run out.';
  if (t.running) return 'The host is still answering.';
  const text = input.text?.trim() ?? '';
  if (!input.greet && !text) return 'Please write something for the host.';
  if (input.greet && t.host.length) return null;
  t.running = true;
  if (!input.greet) t.host.push({ from: 'person', text, ts: new Date().toISOString() });
  store.touch(t);
  let declineWith = '';

  const handlers: Handlers = {
    other_options: async () =>
      ok({
        options: optionsFor(t).map(({ shop, item }) => ({
          shop_id: shop.id,
          shop: shop.name,
          shop_local_name: shop.localName,
          kind: shop.kind,
          neighbourhood: shop.area,
          hours: shop.hours,
          item_id: item.id,
          dish: item.name,
          dish_local_name: item.localName,
          about: item.about,
          tags: item.tags,
        })),
      }),
    change_treat: async (a) => {
      const error = swapTreat(t, a.shop_id, a.item_id);
      if (error) return refuse(t, error);
      const shop = shopById(t.shopId)!;
      const item = itemOf(shop, t.itemId)!;
      return ok({ now: { dish: item.name, dish_local_name: item.localName, shop: shop.name, shop_local_name: shop.localName, neighbourhood: shop.area, hours: shop.hours } });
    },
    note_visit: async (a) => {
      t.visit = str(a.when, 80);
      store.emit(t.id, { actor: 'host', type: 'tool', summary: `${t.to!.name} plans to go: ${t.visit}.` });
      return ok({ noted: t.visit });
    },
    send_thanks: async (a) => {
      const original = str(a.original, 500);
      const forSender = str(a.for_sender, 500);
      if (!original || !forSender) return refuse(t, 'A thank-you needs the words and their translation.');
      t.thanks = { original, forSender };
      store.emit(t.id, { actor: 'host', type: 'tool', summary: `${t.to!.name} says: ${forSender}` });
      return ok({ passed_on: true });
    },
    decline: async (a) => {
      declineWith = str(a.for_sender, 300) || `${t.to!.name} cannot use the treat this time.`;
      return ok({ the_hold_will_be_released: true });
    },
  };

  const shop = shopById(t.shopId)!;
  const item = itemOf(shop, t.itemId)!;
  try {
    const reply = await loop({
      treat: t,
      actor: 'host',
      system: input.greet ? `${PROMPT}\n\n${GREET}` : PROMPT,
      user: {
        start: !!input.greet,
        sender: { name: t.from.name, language: t.from.language },
        recipient: { name: t.to.name, language: t.to.language },
        card: t.card.forRecipient,
        treat: { dish: item.name, dish_local_name: item.localName, about: item.about, shop: shop.name, shop_local_name: shop.localName, kind: shop.kind, neighbourhood: shop.area, city: shop.city, hours: shop.hours, shopkeeper: shop.keeper },
        good_until: t.expiresAt?.slice(0, 10),
        planned_visit: t.visit ?? null,
        conversation: t.host,
      },
      tools: input.greet ? [] : TOOLS,
      handlers,
      llm,
      maxTurns: 6,
    });
    t.host.push({ from: 'agent', text: reply || 'I could not answer that just now. The treat is still yours: show the code at the counter.', ts: new Date().toISOString() });
  } catch (e) {
    t.host.push({ from: 'agent', text: 'The host is not available right now. The treat is still yours: show the code at the counter.', ts: new Date().toISOString() });
    store.emit(t.id, { actor: 'system', type: 'error', summary: `The host agent stopped: ${(e as Error).message}` });
  } finally {
    t.running = false;
    store.touch(t);
  }
  if (declineWith) {
    t.declined = { forSender: declineWith };
    await releaseTreat(t, `${declineWith} PayPal released the hold. Nothing was taken.`, 'host');
  }
  return null;
}
