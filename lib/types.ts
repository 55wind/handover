/** ISO 3166-1 alpha-2, the form PayPal reports, e.g. "VN". */
export type CountryCode = string;

/** Money is a decimal string in USD, e.g. "44.00". Arithmetic happens in integer cents. */
export interface Product {
  id: string;
  title: string;
  blurb: string;
  listPrice: string;
}

/** What the seller decides once. Code applies it; no model can change it. */
export interface Rules {
  referenceCountry: CountryCode; // the market the list price was set for
  dial: number; // 0..100. 0 = the same dollars everywhere, 100 = the same hours everywhere
  floorPercent: number; // never below this share of the list price
  // How far the clerk may lower a price from the pool: on the buyer's word, with a document that supports it, and how often.
  help: { maxPercent: number; maxPercentWithProof: number; perMonth: number };
}

/** One product's price for one country, worked out by code from World Bank data and the seller's rules. */
export interface Price {
  country: CountryCode;
  countryName: string;
  year: number; // year of the income figure
  incomePerHour: string; // average income per working hour there, USD
  list: string;
  fair: string;
  hoursAtList: number; // hours of average income the list price costs there, one decimal
  hoursAtFair: number;
  limitedBy: 'floor' | 'list' | null; // which of the seller's limits decided the fair price, if any
}

export interface Quote {
  id: string;
  productId: string;
  price: Price;
  createdAt: string;
  expiresAt: string;
}

export type PurchaseStatus = 'open' | 'approving' | 'settling' | 'captured' | 'voided' | 'refunded';

export interface ChatMessage {
  from: 'buyer' | 'clerk';
  text: string;
  ts: string;
}

export interface Event {
  ts: string;
  actor: 'clerk' | 'agent' | 'desk' | 'rules' | 'buyer' | 'system';
  type: 'note' | 'tool' | 'refused' | 'outcome' | 'status' | 'error';
  summary: string;
  detail?: unknown;
}

export interface Purchase {
  id: string;
  createdAt: string;
  productId: string;
  quote: Quote;
  buyer: { language: string; viaAgent: boolean };
  gift: string; // "cover an hour for someone"; "0.00" when none
  help?: { amount: string; reason: string }; // granted by the clerk, paid from the pool
  /** What the clerk read in a document the buyer showed. The image itself is not kept. */
  evidence?: { kind: string; supports: boolean; note: string };
  amount: string; // what PayPal is asked to authorise: fair price, minus help, plus gift
  status: PurchaseStatus;
  running: boolean; // an agent is working on it right now
  paypal: {
    orderId?: string;
    approveUrl?: string;
    authorizationId?: string;
    captureId?: string;
    refundId?: string;
    payerId?: string;
    walletCountry?: CountryCode; // as PayPal reported it, never as the buyer said
  };
  outcome?: {
    captured: boolean;
    verified: boolean; // set by code after reading the capture or the void back from PayPal
    text: string; // what the buyer is told, in their language
    offer?: Quote; // after a mismatch: the price for the wallet's country
  };
  messages: ChatMessage[];
  events: Event[];
}

export interface PoolEntry {
  ts: string;
  purchaseId: string;
  kind: 'gift' | 'help';
  amount: string;
}
export interface Pool {
  balance: string;
  entries: PoolEntry[];
}

/** What PayPal says about an order. `payerCountry` is the proof of residence. */
export interface OrderView {
  status: string; // CREATED | PAYER_ACTION_REQUIRED | APPROVED | COMPLETED | VOIDED ...
  amount?: string;
  payerId?: string;
  payerCountry?: CountryCode;
  authorizationId?: string;
  authorizationStatus?: string; // CREATED | CAPTURED | VOIDED ...
  captureId?: string;
  captureStatus?: string;
}

/** PayPal for the seller's account. Every method throws an Error carrying PayPal's message on failure. */
export interface Backend {
  createOrder(o: { amount: string; description: string; purchaseId: string; returnUrl: string; cancelUrl: string }): Promise<{ orderId: string; approveUrl: string }>;
  getOrder(orderId: string): Promise<OrderView>;
  authorizeOrder(orderId: string): Promise<{ authorizationId: string; status: string }>;
  captureAuthorization(authorizationId: string, requestId: string): Promise<{ captureId: string; status: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  refundCapture(captureId: string, requestId: string): Promise<{ refundId: string; status: string }>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}
export type ToolResult = { ok: true; data: unknown } | { ok: false; refused: boolean; error: string };
