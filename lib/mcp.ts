// The treat desk for AI assistants, over MCP (Streamable HTTP, stateless, plain JSON responses).
// An assistant can look up shops near a person, send a treat for its user and follow what became of it.
// It cannot hold or take money: its user approves the hold at PayPal, and money is taken only at a shop's counter.
import { runHost } from './host';
import { fromCents, localLabel, usdCents } from './rules';
import { CITIES, HOLD_DAYS, PLATFORM, appUrl, cityOf, isConfigured, itemOf, shopById, shopsNear } from './shops';
import { store } from './store';
import { newTreat, placeHold, setProposal, startCheckout } from './treats';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `This is the treat desk of ${PLATFORM.name}. It lets your user buy someone far away a dish or a drink at a neighbourhood shop near that person.
Call find_treats with the place the recipient is in, choose one dish that suits the occasion, and call send_treat with a short card written in the recipient's language. send_treat returns a PayPal link your user must open to approve a hold; nothing is taken then. After the approval, treat_status gives the link to pass to the recipient. The recipient shows a code at the shop's counter; only then is the price of the dish taken and the rest of the hold released. A treat not used within ${HOLD_DAYS} days costs nothing.`;

type Args = Record<string, unknown>;
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required });
const absolute = (url: string) => (url.startsWith('/') ? appUrl() + url : url);

const TOOLS: { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: Args) => Promise<unknown> }[] = [
  {
    name: 'find_treats',
    description: 'Neighbourhood shops near a place, with their menus. Prices are given as the shop writes them and in USD.',
    inputSchema: schema({ place: { type: 'string', description: 'City or neighbourhood the recipient is in' } }, ['place']),
    run: async (a) => {
      const place = String(a.place ?? '');
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
          hours: s.hours,
          language: s.language,
          menu: s.menu.map((m) => ({ item_id: m.id, name: m.name, local_name: m.localName, about: m.about, tags: m.tags, local_price: localLabel(s, m), usd: fromCents(usdCents(s, m)) })),
        })),
      };
    },
  },
  {
    name: 'send_treat',
    description: 'Send one dish to someone. Returns a PayPal link the sender must open to approve a hold. Nothing is taken until the recipient eats.',
    inputSchema: schema(
      {
        shop_id: { type: 'string' },
        item_id: { type: 'string' },
        recipient_name: { type: 'string' },
        recipient_place: { type: 'string', description: 'City or neighbourhood the recipient is in' },
        card_for_recipient: { type: 'string', description: "At most two sentences, in the recipient's language" },
        card_for_sender: { type: 'string', description: "The same words in the sender's language" },
        sender_name: { type: 'string' },
        budget_usd: { type: 'string', description: 'The most the sender wants held, e.g. "15.00". Leave out to hold the price plus a quarter.' },
      },
      ['shop_id', 'item_id', 'recipient_name', 'recipient_place', 'card_for_recipient'],
    ),
    run: async (a) => {
      if (!isConfigured()) throw new Error('The PayPal sandbox is not configured on this server.');
      const t = newTreat({ name: a.sender_name, viaAgent: true });
      if (typeof t === 'string') throw new Error(t);
      const error = setProposal(t, {
        shopId: a.shop_id,
        itemId: a.item_id,
        toName: a.recipient_name,
        toPlace: a.recipient_place,
        cardForRecipient: a.card_for_recipient,
        cardForSender: a.card_for_sender ?? a.card_for_recipient,
        reason: 'Chosen by the sender\'s AI assistant.',
        budget: a.budget_usd,
      });
      const r = error ?? (await startCheckout(t));
      if (typeof r === 'string') {
        store.treats.delete(t.id);
        store.codes.delete(t.code);
        throw new Error(r);
      }
      return {
        treat_id: t.id,
        price_usd: t.price,
        paypal_will_hold_usd: t.ceiling,
        approve_url: absolute(r.approveUrl),
        sender_page: `${appUrl()}/treat/${t.id}`,
        next: 'Ask the sender to open approve_url and approve the hold. Then call treat_status for the link to pass to the recipient.',
      };
    },
  },
  {
    name: 'treat_status',
    description: 'What became of a treat: waiting for the hold, ready to use (with the link for the recipient), enjoyed, or released.',
    inputSchema: schema({ treat_id: { type: 'string' } }, ['treat_id']),
    run: async (a) => {
      const t = store.treats.get(String(a.treat_id));
      if (!t) throw new Error('This treat is no longer available.');
      // The sender may have approved without their browser coming back; PayPal is asked before anything is placed.
      if (t.status === 'approving' && (await placeHold(t.id))) void runHost(t.id, { greet: true }).catch(() => {});
      const shop = shopById(t.shopId);
      const live = t.status !== 'draft' && t.status !== 'approving';
      return {
        status: t.status,
        for: t.to?.name,
        dish: itemOf(shop, t.itemId)?.name,
        shop: shop?.name,
        link_for_the_recipient: live ? `${appUrl()}/t/${t.code}` : null,
        good_until: t.expiresAt ?? null,
        approve_url: t.status === 'approving' && t.paypal.approveUrl ? absolute(t.paypal.approveUrl) : null,
        planned_visit: t.visit ?? null,
        thanks: t.thanks?.forSender ?? null,
        message: t.outcome?.forSender ?? t.declined?.forSender ?? null,
        held_usd: t.ceiling,
        charged_usd: t.outcome?.charged ?? null,
        released_usd: t.outcome?.released ?? null,
        confirmed_with_paypal: t.outcome?.verified ?? false,
      };
    },
  },
];

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: unknown;
  params?: { protocolVersion?: string; name?: string; arguments?: Args };
}

/** Answers one JSON-RPC message. Returns null for a notification, which gets no reply. */
export async function handleRpc(msg: Rpc): Promise<Record<string, unknown> | null> {
  const id = msg?.id;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (typeof msg?.method !== 'string') return fail(-32600, 'Invalid request');
  if (id === undefined) return null;
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOLS.includes(msg.params?.protocolVersion ?? '') ? msg.params!.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'have-you-eaten', title: 'Have You Eaten? treat desk', version: '0.1.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${String(msg.params?.name)}`);
      try {
        return reply({ content: [{ type: 'text', text: JSON.stringify(await tool.run(msg.params?.arguments ?? {}), null, 2) }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
