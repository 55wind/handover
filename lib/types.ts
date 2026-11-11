export type MerchantSlug = 'lumen' | 'ironwood' | 'harborlight';
export type Tier = 'filed' | 'verified';
export type Phase = 'intake' | 'plan' | 'pause' | 'resume' | 'execute';
export type CaseStatus = 'notice' | 'planning' | 'review' | 'executing' | 'done';
export type ItemKind = 'subscription' | 'charge' | 'invoice';
export type Action = 'close' | 'take_over' | 'pause' | 'refund' | 'leave' | 'waive' | 'pay_from_estate';

export const ACTIONS_BY_KIND: Record<ItemKind, Action[]> = {
  subscription: ['close', 'take_over', 'pause'],
  charge: ['refund', 'leave'],
  invoice: ['waive', 'pay_from_estate'],
};

export interface Policy {
  prorataCurrentPeriod: boolean; // refund the unused share of a period that contains the date of death
  waiveUndeliveredInvoices: boolean;
  allowTakeOver: boolean;
  summary: string; // plain-language text shown to the agent and in the UI
}
export interface Merchant {
  slug: MerchantSlug;
  name: string;
  blurb: string;
  policy: Policy;
}

/** Dates are YYYY-MM-DD. `end` is exclusive. */
export interface Period {
  start: string;
  end: string;
}
/** Money is a decimal string in USD, e.g. "17.99". */
export interface Charge {
  captureId: string;
  orderId?: string;
  amount: string;
  description: string;
  period: Period;
}

/** One thing a merchant has on file for a customer. */
export interface RecordItem {
  id: string; // merchant-local and unique per seeded run, e.g. "lumen-1-ab12"
  kind: ItemKind;
  label: string;
  paypalId: string; // subscription id | capture id | invoice id
  planId?: string; // subscriptions: needed for take-over
  amount: string;
  cadence?: 'month' | 'year';
  charges: Charge[]; // subscription: period charges the merchant recorded; charge: one entry; invoice: none
}
export interface CustomerRecord {
  /** Demo records are created for one case and only that case may act on them. */
  caseId?: string;
  customerId: string;
  fullName: string;
  email: string;
  items: RecordItem[];
}

export interface RefundLine {
  captureId: string;
  amount: string;
}
export interface Decision {
  action: Action;
  refunds: RefundLine[];
}
export interface Outcome {
  state: 'done' | 'waiting' | 'blocked' | 'failed' | 'not_completed';
  refs: Record<string, string>; // e.g. { refundId, newSubscriptionId }
  verified: boolean; // set by code after re-reading PayPal, never by the model
  note: string;
  link?: string;
}
export interface Item {
  id: string;
  merchant: MerchantSlug;
  kind: ItemKind;
  label: string;
  paypalId: string;
  planId?: string;
  liveStatus: string;
  amount: string;
  cadence?: 'month' | 'year';
  charges: (Charge & { refundable: string })[]; // refundable is computed by code
  /** Ids and links taken from PayPal responses by the desk, never from the model.
   *  Keys: `refund:<captureId>`, `newSubscriptionId`, `approveLink`, `payLink`. */
  refs: Record<string, string>;
  proposed?: Decision & { reason: string; question?: string };
  decided?: Decision;
  outcome?: Outcome;
}

export interface Event {
  ts: string;
  actor: 'agent' | `desk:${MerchantSlug}` | 'guard' | 'family' | 'system';
  type: 'note' | 'tool' | 'denied' | 'plan' | 'outcome' | 'status' | 'error';
  summary: string;
  detail?: unknown;
}

export interface Case {
  id: string;
  createdAt: string;
  demo: boolean;
  tier: Tier;
  status: CaseStatus;
  running: Phase | null;
  paused: boolean; // true after a pause phase, false again after resume
  representative: { name: string; relation: string; email: string };
  deceased: { fullName: string; emails: string[]; dateOfDeath: string };
  wishes: string;
  language: string;
  document: {
    dataUrl?: string;
    text?: string;
    extracted?: { fullName?: string; dateOfDeath?: string; kind?: string };
    mismatches: string[];
  };
  items: Item[];
  notes: string[]; // agent remarks for the family, e.g. a near match it left out
  approvedAt?: string;
  statement?: string;
  statementNote?: string; // the agent's covering note, kept so the statement can be rebuilt
  events: Event[];
}

export interface LedgerEntry {
  ts: string;
  caseId: string;
  tool: string;
  target: string;
  ok: boolean;
  denied: boolean;
  summary: string;
  refs: Record<string, string>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  write: boolean;
}
export type ToolResult = { ok: true; data: unknown } | { ok: false; denied: boolean; error: string };
export interface Desk {
  slug: MerchantSlug;
  listTools(phase: Phase): ToolDef[];
  callTool(name: string, args: Record<string, unknown>, caseId: string): Promise<ToolResult>;
}

/** A PayPal backend for one merchant. `null` from a seed function means the sandbox cannot do it. */
export interface Backend {
  /** Throws an Error carrying PayPal's message on failure. */
  exec(tool: string, args: Record<string, unknown>, requestId?: string): Promise<unknown>;
  seedSubscription(o: { label: string; price: string; payerName: string; payerEmail: string }): Promise<{ paypalId: string; planId: string } | null>;
  seedCharge(o: { label: string; amount: string; payerName: string; payerEmail: string }): Promise<{ captureId: string; orderId: string } | null>;
  seedInvoice(o: { label: string; amount: string; recipientName: string; recipientEmail: string }): Promise<{ invoiceId: string } | null>;
}
