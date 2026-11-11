// The shop's price desk for AI shopping agents, over MCP (Streamable HTTP, stateless, plain JSON responses).
// An agent can ask for the price for a country and start a checkout. It cannot choose the country that is charged:
// that comes from the PayPal wallet that pays.
import { PRODUCTS, RULES, SELLER, appUrl, isConfigured, productById } from './seller';
import { makeQuote, openPurchase, saleOf, startCheckout } from './shop';
import { store } from './store';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `This is the price desk of ${SELLER.shop}, a seller of digital goods that prices in hours of average local income instead of dollars.
Ask get_price with the country the paying wallet is registered in. start_checkout returns a PayPal link the buyer must approve. The payment is taken only if PayPal reports the wallet is registered in the country the price was quoted for; otherwise nothing is taken and get_purchase shows the price for the wallet's country. Claiming another country does not work.`;

type Args = Record<string, unknown>;
const schema = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: 'object', properties, required });
const absolute = (url: string) => (url.startsWith('/') ? appUrl() + url : url);

const TOOLS: { name: string; description: string; inputSchema: Record<string, unknown>; run: (a: Args) => Promise<unknown> }[] = [
  {
    name: 'list_products',
    description: 'The products on sale, with their list prices in USD.',
    inputSchema: schema(),
    run: async () => ({ seller: SELLER.shop, products: PRODUCTS.map((p) => ({ product_id: p.id, title: p.title, about: p.blurb, list_price: p.listPrice })) }),
  },
  {
    name: 'get_price',
    description:
      'The price of a product for a buyer whose PayPal wallet is registered in the given country. Returns the list price, the fair price, what each costs in hours of average income there, and a quote id valid for 30 minutes.',
    inputSchema: schema({ product_id: { type: 'string' }, country: { type: 'string', description: 'Two-letter country code of the paying wallet, e.g. VN' } }, ['product_id', 'country']),
    run: async (a) => {
      const q = makeQuote(a.product_id, a.country);
      if (typeof q === 'string') throw new Error(q);
      return {
        quote_id: q.id,
        expires_at: q.expiresAt,
        country: q.price.country,
        list_price: q.price.list,
        fair_price: q.price.fair,
        hours_of_average_income_at_list_price: q.price.hoursAtList,
        hours_of_average_income_at_fair_price: q.price.hoursAtFair,
        note: `This price is charged only if PayPal reports the paying wallet is registered in ${q.price.countryName}. Figures: World Bank GNI per capita (${q.price.year}) divided by 2,000 hours; the seller uses a fairness dial of ${RULES.dial} and a floor of ${RULES.floorPercent}% of the list price.`,
      };
    },
  },
  {
    name: 'start_checkout',
    description: 'Start paying for a quote. Returns a PayPal link the buyer has to approve. Nothing is taken unless the wallet is registered in the quoted country.',
    inputSchema: schema({ quote_id: { type: 'string' } }, ['quote_id']),
    run: async (a) => {
      if (!isConfigured()) throw new Error('The PayPal sandbox is not configured on this server.');
      const p = openPurchase({ quoteId: a.quote_id, viaAgent: true });
      if (typeof p === 'string') throw new Error(p);
      const r = await startCheckout(p);
      if (typeof r === 'string') throw new Error(r);
      return { purchase_id: p.id, amount: p.amount, pay_url: absolute(r.approveUrl), page: `${appUrl()}/purchase/${p.id}` };
    },
  },
  {
    name: 'get_purchase',
    description: 'What became of a purchase: waiting for approval, paid, or released because the wallet is in another country (with the price for that country).',
    inputSchema: schema({ purchase_id: { type: 'string' } }, ['purchase_id']),
    run: async (a) => {
      const p = store.purchases.get(String(a.purchase_id));
      if (!p) throw new Error('This purchase is no longer available.');
      const offer = p.outcome?.offer;
      return {
        ...saleOf(p),
        product: productById(p.productId)?.title,
        message: p.outcome?.text,
        confirmed_with_paypal: p.outcome?.verified ?? false,
        price_for_the_wallets_country: offer && { quote_id: offer.id, country: offer.price.country, fair_price: offer.price.fair },
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
        serverInfo: { name: 'fair-hour', title: 'Fair Hour price desk', version: '0.1.0' },
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
