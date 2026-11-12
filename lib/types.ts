/** Money is a decimal string in USD, e.g. "10.20". Arithmetic happens in integer cents. */
export type Money = string;

export interface MenuItem {
  id: string;
  name: string; // in English
  localName: string; // as the shop writes it
  localPrice: number; // in the shop's own currency, as on its menu
  about: string; // one sentence in English
  tags: string[]; // warm, soup, light, vegetarian, sweet, coffee, spicy, seafood, meat, breakfast ...
}

/** A neighbourhood shop that takes part. All shops in this demo are fictional. */
export interface Shop {
  id: string;
  name: string;
  localName: string;
  kind: string; // "porridge shop"
  keeper: string; // who stands at the counter
  city: string;
  area: string;
  country: string; // ISO 3166-1 alpha-2
  language: string; // language of the neighbourhood, e.g. "ko"
  currency: string; // e.g. "KRW"
  hours: string; // "08:00-21:00", local time
  menu: MenuItem[];
}

/**
 * draft: the sender is talking to the agent. approving: the sender is at PayPal. held: PayPal holds the money and the
 * recipient can use the treat. settling: the counter is taking payment. enjoyed: used and paid. released: nothing was taken.
 */
export type TreatStatus = 'draft' | 'approving' | 'held' | 'settling' | 'enjoyed' | 'released';

export interface ChatMessage {
  from: 'person' | 'agent';
  text: string;
  ts: string;
}

export interface Event {
  ts: string;
  actor: 'errand' | 'host' | 'till' | 'desk' | 'rules' | 'sender' | 'recipient' | 'shop' | 'system';
  type: 'note' | 'tool' | 'refused' | 'outcome' | 'status' | 'error';
  summary: string;
  detail?: unknown;
}

export interface Treat {
  id: string; // opens the sender's page; only the sender has it
  code: string; // opens the recipient's page and is shown at the counter
  ref: string; // what the public ledger shows
  createdAt: string;
  expiresAt?: string; // set when PayPal places the hold
  viaAgent: boolean; // sent by someone's AI assistant over MCP
  from: { name: string; language: string };
  to?: { name: string; place: string; language: string };
  shopId?: string;
  itemId?: string;
  /** The sender's words, written for each of them in their own language. */
  card?: { forRecipient: string; forSender: string };
  reason?: string; // why the agent chose this, for the sender
  price?: Money; // the chosen item in USD, worked out by code
  ceiling?: Money; // what PayPal is asked to hold; a swap may not exceed it
  status: TreatStatus;
  running: boolean; // an agent is working on it right now
  visit?: string; // when the recipient said they would go
  thanks?: { original: string; forSender: string };
  declined?: { forSender: string };
  paypal: {
    orderId?: string;
    approveUrl?: string;
    authorizationId?: string;
    captureId?: string;
    payoutId?: string; // the shop's money on its way
    payoutStatus?: string;
  };
  outcome?: {
    enjoyed: boolean;
    verified: boolean; // set by code after reading PayPal back
    forSender: string;
    forShop?: string;
    charged?: Money;
    released?: Money;
  };
  errand: ChatMessage[]; // the sender and the agent
  host: ChatMessage[]; // the recipient and the agent
  events: Event[];
}

/** What the recipient's page gets: no prices, no PayPal ids, nothing of the sender's conversation. */
export interface RecipientView {
  code: string;
  status: TreatStatus;
  running: boolean;
  fromName: string;
  toName: string;
  language: string;
  card: string;
  shop: Pick<Shop, 'id' | 'name' | 'localName' | 'kind' | 'city' | 'area' | 'hours' | 'keeper'>;
  item: Pick<MenuItem, 'id' | 'name' | 'localName' | 'about'>;
  expiresAt?: string;
  visit?: string;
  thanks?: string;
  enjoyed: boolean;
  released: boolean;
  host: ChatMessage[];
}

/** One row of the public ledger. */
export interface LedgerRow {
  ref: string;
  ts: string;
  status: TreatStatus;
  shopId?: string;
  shopName?: string;
  city?: string;
  item?: string;
  held?: Money;
  charged?: Money;
  released?: Money;
  viaAgent: boolean;
  verified: boolean;
  paypal: { orderId?: string; authorizationId?: string; captureId?: string; payoutId?: string; payoutStatus?: string };
}

/** What PayPal says about an order. */
export interface OrderView {
  status: string; // CREATED | PAYER_ACTION_REQUIRED | APPROVED | COMPLETED | VOIDED ...
  amount?: string;
  payerId?: string;
  payerCountry?: string;
  authorizationId?: string;
  authorizationStatus?: string; // CREATED | CAPTURED | PARTIALLY_CAPTURED | VOIDED ...
  captureId?: string;
  captureStatus?: string;
  capturedAmount?: string;
}

/** PayPal for the platform's account. Every method throws an Error carrying PayPal's message on failure. */
export interface Backend {
  createOrder(o: { amount: string; description: string; reference: string; returnUrl: string; cancelUrl: string }): Promise<{ orderId: string; approveUrl: string }>;
  getOrder(orderId: string): Promise<OrderView>;
  authorizeOrder(orderId: string): Promise<{ authorizationId: string; status: string }>;
  /** Takes `amount` of the held money and releases the rest. Without an amount the whole hold is taken. */
  captureAuthorization(authorizationId: string, requestId: string, amount?: string): Promise<{ captureId: string; status: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  refundCapture(captureId: string, requestId: string, amount?: string): Promise<{ refundId: string; status: string }>;
  /** Sends money from the platform's balance to a shop's PayPal account. */
  payout(o: { email: string; amount: string; note: string; reference: string }): Promise<{ payoutId: string; status: string }>;
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; refused: boolean; error: string };
