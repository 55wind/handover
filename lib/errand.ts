// The errand agent: turns one sentence from the sender into a treat at a shop near the recipient, with a card in
// the recipient's language. It looks things up and proposes; every amount comes from code.
import { PLAIN, defaultLlm, fn, loop, ok, refuse, str, type Handlers, type Llm } from './agent';
import { fromCents, localLabel, usdCents } from './rules';
import { CITIES, HOLD_DAYS, MAX_TREAT_CENTS, PLATFORM, citiesIn, cityOf, itemOf, shopById, shopsNear } from './shops';
import { store } from './store';
import { setProposal } from './treats';

const PROMPT = `You run errands of care for ${PLATFORM.name}. Someone far from a person they care about tells you, in their own words, who that person is, where they are and what is going on. You turn that into one treat: a dish or a drink at a neighbourhood shop near the recipient, with a card in the recipient's language. PayPal only holds the sender's money. It is taken when the recipient eats, and only the price of what they ate. A treat that is not used within ${HOLD_DAYS} days costs the sender nothing.

How to work:
- You need to know who it is for (what the sender calls them is enough: "Mom" is a name here), where they are (a city or neighbourhood) and what the situation is. If the place is missing, ask for it. Ask at most one question, and none if you can act.
- If shops_near_recipient is given with the conversation, those are the shops where the recipient is: use them and do not call find_shops. Otherwise call find_shops with the place. If no shop takes part there, say so plainly and name the cities that do.
- Read the menus the tool returns and choose one dish that suits the situation: a cold calls for something warm and light, a birthday for cake, an early shift for breakfast. Respect what the sender says about diet, allergies and taste. Prefer a shop in the neighbourhood the sender named.
- Write the card: at most two sentences in the sender's voice, warm but not sugary, built from what the sender actually said. Write it twice: in the recipient's language (the language of their neighbourhood, unless the sender says otherwise) and in the sender's language.
- Call propose_treat. Code works out the price and the amount PayPal will hold. If the sender named a budget, pass it. A treat can be at most $${fromCents(MAX_TREAT_CENTS)}.
- Then tell the sender what you chose and where, why in one sentence, what the card says, the price and what PayPal will hold. End by saying they can place the hold with the button, or tell you what to change.
- If the sender asks for a change (another dish, another shop, other words, another budget), call propose_treat again with everything, changed as asked.

You cannot hold or take money; the sender does that with PayPal. Never invent a shop, a dish or a price, and never state an amount that did not come from a tool result. ${PLAIN} Reply in the language the sender writes in. At most five sentences.`;

const TOOLS = [
  fn('find_shops', 'Neighbourhood shops near a place, with their menus. Prices are given as the shop writes them and in USD.', { place: { type: 'string', description: 'City or neighbourhood the recipient is in, as the sender said it' } }, ['place']),
  fn(
    'propose_treat',
    'Record the treat to send. Returns the price and the amount PayPal will be asked to hold.',
    {
      shop_id: { type: 'string' },
      item_id: { type: 'string' },
      recipient_name: { type: 'string', description: 'What the sender calls them, e.g. "Mom"' },
      recipient_place: { type: 'string', description: 'City or neighbourhood, as the sender said it' },
      recipient_language: { type: 'string', description: 'Language code of the card for the recipient, e.g. "ko". Leave out to use the language of the neighbourhood.' },
      card_for_recipient: { type: 'string', description: "The card in the recipient's language" },
      card_for_sender: { type: 'string', description: "The same words in the sender's language" },
      reason: { type: 'string', description: "One sentence in the sender's language: why this dish at this shop" },
      budget_usd: { type: 'string', description: 'Only if the sender named the most they want to spend, e.g. "15.00"' },
      sender_name: { type: 'string', description: 'Only if the sender said how to sign the card' },
    },
    ['shop_id', 'item_id', 'recipient_name', 'recipient_place', 'card_for_recipient', 'card_for_sender', 'reason'],
  ),
];

/** The shops near a place with their menus, as the agent is given them. */
function shopList(place: string) {
  const shops = shopsNear(place);
  if (!shops.length) return { city: null, note: 'No shop takes part there yet.', cities_taking_part: CITIES };
  return {
    city: cityOf(place),
    shops: shops.map((s) => ({
      shop_id: s.id,
      name: s.name,
      local_name: s.localName,
      kind: s.kind,
      neighbourhood: s.area,
      in_the_neighbourhood_named: place.toLowerCase().includes(s.area.toLowerCase()),
      hours: s.hours,
      language: s.language,
      menu: s.menu.map((m) => ({ item_id: m.id, name: m.name, local_name: m.localName, about: m.about, tags: m.tags, local_price: localLabel(s, m), usd: fromCents(usdCents(s, m)) })),
    })),
  };
}

/** One turn with the sender. The reply is appended to the treat's errand conversation. Returns an error sentence or null. */
export async function runErrand(treatId: string, text: string, llm: Llm = defaultLlm): Promise<string | null> {
  const t = store.treats.get(treatId);
  if (!t) return 'This treat is no longer available.';
  if (t.status !== 'draft') return 'The payment has already started.';
  if (t.running) return 'The agent is still answering.';
  if (!text.trim()) return 'Please write something for the agent.';
  t.running = true;
  t.errand.push({ from: 'person', text: text.trim(), ts: new Date().toISOString() });
  store.touch(t);

  const handlers: Handlers = {
    find_shops: async (a) => ok(shopList(str(a.place, 80))),
    propose_treat: async (a) => {
      const error = setProposal(t, {
        shopId: a.shop_id,
        itemId: a.item_id,
        toName: a.recipient_name,
        toPlace: a.recipient_place,
        toLanguage: a.recipient_language,
        cardForRecipient: a.card_for_recipient,
        cardForSender: a.card_for_sender,
        reason: a.reason,
        budget: a.budget_usd,
        fromName: a.sender_name,
      });
      if (error) return refuse(t, error);
      const shop = shopById(t.shopId)!;
      const item = itemOf(shop, t.itemId)!;
      return ok({ shop: shop.name, dish: item.name, local_price: localLabel(shop, item), price_usd: t.price, paypal_will_hold_usd: t.ceiling, good_for_days: HOLD_DAYS });
    },
  };

  const shop = shopById(t.shopId);
  const item = itemOf(shop, t.itemId);
  // When the sender named exactly one city, code already knows where to look: the shops go in with the conversation
  // and the agent is spared a lookup, which is one model call fewer for most treats.
  const said = t.errand.filter((m) => m.from === 'person').map((m) => m.text).join(' ');
  const named = citiesIn(said);
  try {
    const reply = await loop({
      treat: t,
      actor: 'errand',
      system: PROMPT,
      user: {
        sender_name: t.from.name,
        sender_browser_language: t.from.language,
        ...(named.length === 1 ? { shops_near_recipient: shopList(said) } : {}),
        treat_so_far: shop && item ? { shop_id: shop.id, shop: shop.name, item_id: item.id, dish: item.name, recipient: t.to, card: t.card, price_usd: t.price, paypal_will_hold_usd: t.ceiling } : null,
        conversation: t.errand,
      },
      tools: TOOLS,
      handlers,
      llm,
      maxTurns: 7,
    });
    t.errand.push({ from: 'agent', text: reply || 'I could not work that out just now. Please tell me again who it is for and where they are.', ts: new Date().toISOString() });
    return null;
  } catch (e) {
    t.errand.push({ from: 'agent', text: 'The agent is not available right now. Please try again in a moment.', ts: new Date().toISOString() });
    store.emit(t.id, { actor: 'system', type: 'error', summary: `The errand agent stopped: ${(e as Error).message}` });
    return null;
  } finally {
    t.running = false;
    store.touch(t);
  }
}
