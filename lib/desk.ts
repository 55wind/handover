import { createHash } from 'node:crypto';
import { buildItems, guard, matchCustomers, toCents } from './guard';
import { MERCHANTS, SLUGS } from './merchants';
import { backendFor, names, toolkitTools } from './paypal';
import { store } from './store';
import type { Case, Desk, Item, MerchantSlug, Phase, ToolDef, ToolResult } from './types';

type Args = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any; // PayPal JSON, read field by field

// ---- what the merchants have on file --------------------------------------

function recordsAt(slug: MerchantSlug, c: Case) {
  const { owned, nearMatches } = matchCustomers(store.records.get(slug) ?? [], c.deceased);
  // A customer another case has claimed is that family's business, not a near match here. Every demo run seeds its own Daniel Reyes.
  const claimed = new Set([...store.cases.values()].filter((x) => x !== c).flatMap((x) => x.deceased.emails.map((e) => e.trim().toLowerCase())));
  return {
    customers: owned.map((record) => ({ record, items: buildItems(MERCHANTS[slug], [record], c.deceased.dateOfDeath, store.refunded) })),
    nearMatches: nearMatches
      .filter(({ record }) => !claimed.has(record.email.trim().toLowerCase()))
      .map(({ record, reason }) => ({ merchant: slug, fullName: record.fullName, email: record.email, reason })),
  };
}

/** Everything the three merchants hold for this person, matched by code. Does not touch `c.items`. */
export function inventory(c: Case): { items: Item[]; nearMatches: { merchant: MerchantSlug; fullName: string; email: string; reason: string }[] } {
  const all = SLUGS.map((slug) => recordsAt(slug, c));
  return { items: all.flatMap((m) => m.customers.flatMap((x) => x.items)), nearMatches: all.flatMap((m) => m.nearMatches) };
}

/** The case item a PayPal id belongs to: its own id, its plan, one of its captures or orders, or an id PayPal gave back for it. */
export function findItem(c: Case, targetId: string): Item | undefined {
  if (!targetId) return undefined;
  return c.items.find(
    (i) =>
      i.paypalId === targetId ||
      i.planId === targetId ||
      i.charges.some((ch) => ch.captureId === targetId || ch.orderId === targetId) ||
      Object.values(i.refs).includes(targetId),
  );
}

// ---- tools ----------------------------------------------------------------

/** The argument that names the PayPal object a tool acts on. Names are the toolkit's own. */
const TARGET: Record<string, string> = {
  show_subscription_details: 'subscription_id',
  suspend_subscription: 'subscription_id',
  activate_subscription: 'subscription_id',
  cancel_subscription: 'subscription_id',
  create_subscription: 'plan_id',
  create_refund: 'capture_id',
  get_refund: 'refund_id',
  get_order: 'id',
  get_invoice: 'invoice_id',
  cancel_invoice_auto_reminder: 'invoice_id',
  cancel_sent_invoice: 'invoice_id',
  generate_invoice_qr_code: 'invoice_id',
};
const READ = ['show_subscription_details', 'get_invoice', 'get_order', 'get_refund'];
const WRITE: Partial<Record<Phase, string[]>> = {
  pause: ['suspend_subscription'],
  resume: ['activate_subscription'],
  execute: ['suspend_subscription', 'cancel_subscription', 'create_refund', 'cancel_invoice_auto_reminder', 'cancel_sent_invoice', 'create_subscription', 'generate_invoice_qr_code'],
};
/** Cannot be undone, so each carries a PayPal-Request-Id. Pause and resume must stay repeatable and carry none. */
const ONCE = ['cancel_subscription', 'create_subscription', 'cancel_sent_invoice', 'create_refund'];

export function targetOf(tool: string, args: Args): { targetId: string; amountCents?: number } | null {
  const param = TARGET[tool];
  if (!param) return null;
  const targetId = typeof args[param] === 'string' ? (args[param] as string) : '';
  const value = tool === 'create_refund' ? (args.amount as { value?: unknown } | null | undefined)?.value : undefined;
  return value === undefined ? { targetId } : { targetId, amountCents: toCents(String(value)) };
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const SUBSCRIPTION = object(
  { subscription_id: { type: 'string', description: 'The PayPal subscription id.' }, reason: { type: 'string', description: 'Why, in a few words.' } },
  ['subscription_id', 'reason'],
);
const OWN: ToolDef[] = [
  {
    name: 'find_customer_records',
    write: false,
    parameters: object({}),
    description:
      'Look up what this merchant has on file for the person in the case. Takes no arguments. The desk matches customers by the emails the family gave. Returns each matching customer with their items (PayPal ids, and each recorded charge with its service period and the refundable amount already worked out), plus near matches that were left out and why.',
  },
  { name: 'get_policy', write: false, parameters: object({}), description: "Read this merchant's rules for refunds, invoices and take-over after a death. Takes no arguments." },
  { name: 'suspend_subscription', write: true, parameters: SUBSCRIPTION, description: 'Pause a subscription so that it stops billing. Can be undone with activate_subscription.' },
  { name: 'activate_subscription', write: true, parameters: SUBSCRIPTION, description: 'Resume a paused subscription.' },
];

let defs: Map<string, ToolDef> | undefined;
/** Every tool a desk can list: its own four, plus the toolkit's with the toolkit's own schemas. */
function toolDefs(): Map<string, ToolDef> {
  defs ??= new Map(
    [
      ...OWN,
      ...toolkitTools().map(({ name, description = '', parameters = {} }): ToolDef => {
        // The toolkit's schema for this one lets the model name the subscriber and the return address. Code sets those.
        if (name === 'create_subscription')
          return {
            name,
            write: true,
            parameters: object({ plan_id: { type: 'string', description: 'The plan id of the subscription being taken over' } }, ['plan_id']),
            description:
              'Create a replacement subscription on the same plan for the family representative. Returns a PayPal approval link: the subscription starts only after the representative approves it at PayPal.',
          };
        const schema = { ...parameters };
        delete schema.$schema;
        return { name, description: description.trim(), parameters: schema, write: !READ.includes(name) };
      }),
    ].map((t) => [t.name, t]),
  );
  return defs;
}

function listTools(phase: Phase): ToolDef[] {
  if (phase === 'intake') return [];
  return ['find_customer_records', 'get_policy', ...READ, ...(WRITE[phase] ?? [])].map((name) => toolDefs().get(name)!);
}

function customerRecords(slug: MerchantSlug, c: Case) {
  const { customers, nearMatches } = recordsAt(slug, c);
  return {
    customers: customers.map(({ record, items }) => ({
      full_name: record.fullName,
      email: record.email,
      items: items.map((i) => ({
        item_id: i.id,
        kind: i.kind,
        label: i.label,
        paypal_id: i.paypalId,
        plan_id: i.planId,
        amount: i.amount,
        cadence: i.cadence,
        charges: i.charges.map((ch) => ({
          capture_id: ch.captureId,
          order_id: ch.orderId,
          amount: ch.amount,
          description: ch.description,
          period: ch.period,
          refundable: ch.refundable,
        })),
      })),
    })),
    near_matches: nearMatches.map((n) => ({ full_name: n.fullName, email: n.email, reason: n.reason })),
  };
}

const capturesOf = (order: Json): Json[] => (order?.purchase_units ?? []).flatMap((u: Json) => u?.payments?.captures ?? []);

export function deskFor(slug: MerchantSlug): Desk {
  const merchant = MERCHANTS[slug];
  const m = merchant.name;

  return {
    slug,
    listTools,

    async callTool(name, args, caseId): Promise<ToolResult> {
      const c = store.cases.get(caseId);
      // While a phase runs only that phase's tools exist, whatever the model asks for. Outside a run the guard alone decides.
      const def = c && (c.running ? listTools(c.running) : [...toolDefs().values()]).find((t) => t.name === name);
      if (!c || !def) return { ok: false, denied: true, error: `${name} is not available at this desk now.` };

      let send = args; // what goes to PayPal; differs from what the model asked where code sets the values
      const ok = (target: string, summary: string, result: unknown, refs: Record<string, string> = {}): ToolResult => {
        store.log(slug, { caseId, tool: name, target, ok: true, denied: false, summary, refs });
        store.emit(caseId, { actor: `desk:${slug}`, type: 'tool', summary, detail: { tool: name, args: send, result } });
        return { ok: true, data: result };
      };

      if (name === 'get_policy') return ok('', `${m}: read the policy.`, { merchant: m, ...merchant.policy });
      if (name === 'find_customer_records') {
        const data = customerRecords(slug, c);
        const items = data.customers.reduce((n, x) => n + x.items.length, 0);
        return ok('', `${m}: looked up the customer records. ${items} ${items === 1 ? 'item' : 'items'} on file, ${data.near_matches.length} near ${data.near_matches.length === 1 ? 'match' : 'matches'} left out.`, data);
      }

      let targetId = targetOf(name, args)?.targetId ?? '';
      if (!targetId) return { ok: false, denied: false, error: `${name} needs ${TARGET[name]}.` };
      const found = findItem(c, targetId);
      const item = found?.merchant === slug ? found : undefined; // another merchant's item does not exist at this desk

      // Money, the subscriber and who gets email are set here, never by the model.
      const line = name === 'create_refund' ? item?.decided?.refunds.find((r) => r.captureId === targetId) : undefined;
      if (line) send = { capture_id: targetId, amount: { currency_code: 'USD', value: line.amount }, ...(typeof args.note_to_payer === 'string' ? { note_to_payer: args.note_to_payer } : {}) };
      if (name === 'create_subscription' && item?.planId) {
        targetId = item.planId; // one key per plan, however the model named the item
        const back = `${process.env.APP_URL ?? 'http://localhost:3000'}/case/${caseId}`;
        send = {
          plan_id: item.planId,
          subscriber: { name: names(c.representative.name), email_address: c.representative.email },
          application_context: { brand_name: m, user_action: 'SUBSCRIBE_NOW', return_url: back, cancel_url: back },
        };
      }
      if (name === 'cancel_sent_invoice') send = { invoice_id: targetId, send_to_recipient: false, ...(typeof args.note === 'string' ? { note: args.note } : {}) };

      // The guard judges the call as it will be sent.
      const verdict = guard({ tool: name, targetId, amountCents: line && toCents(line.amount), c, item, merchant, done: store.doneFor(caseId) });
      if (!verdict.allow || !item) {
        const reason = verdict.allow ? `${targetId} is not this customer's at ${m}.` : verdict.reason;
        store.log(slug, { caseId, tool: name, target: targetId, ok: false, denied: true, summary: reason, refs: {} });
        store.emit(caseId, { actor: 'guard', type: 'denied', summary: `Refused at ${m}: ${reason}`, detail: { tool: name, args, merchant: slug } });
        return { ok: false, denied: true, error: reason };
      }

      const backend = backendFor(slug);
      const key = `${name}:${targetId}`;
      const once = ONCE.includes(name);
      const requestId = once ? createHash('sha256').update(`${caseId}|${item.id}|${name}|${targetId}`).digest('hex').slice(0, 32) : undefined;
      // Taken before the call, not after: the model's tool calls run side by side, and an identical twin must meet the guard's "already done".
      if (once) store.doneFor(caseId).add(key);
      try {
        let data = await backend.exec(name, send, requestId);
        const r: Json = data ?? {};
        const refs: Record<string, string> = {};
        let summary = '';
        switch (name) {
          case 'show_subscription_details':
            summary = `${m}: read subscription ${targetId}, status ${r.status}.`;
            break;
          case 'get_invoice':
            summary = `${m}: read invoice ${targetId}, status ${r.status}.`;
            break;
          case 'get_refund':
            summary = `${m}: read refund ${targetId}, status ${r.status}.`;
            break;
          case 'get_order':
            summary = `${m}: read order ${targetId}, ${capturesOf(r).map((cap) => `capture ${cap.id} ${cap.status}`).join(', ') || `status ${r.status}`}.`;
            break;
          case 'suspend_subscription':
            summary = `${m}: paused subscription ${targetId}.`;
            break;
          case 'activate_subscription':
            summary = `${m}: resumed subscription ${targetId}.`;
            break;
          case 'cancel_subscription':
            summary = `${m}: cancelled subscription ${targetId}.`;
            break;
          case 'cancel_invoice_auto_reminder':
            summary = `${m}: stopped the reminders on invoice ${targetId}.`;
            break;
          case 'cancel_sent_invoice':
            summary = `${m}: cancelled invoice ${targetId}.`;
            break;
          case 'create_refund':
            if (typeof r.id === 'string') refs[`refund:${targetId}`] = r.id;
            store.refunded.set(targetId, (store.refunded.get(targetId) ?? 0) + toCents(line!.amount));
            summary = `${m}: refunded $${line!.amount} on capture ${targetId} to the payment method that paid, refund ${r.id}.`;
            break;
          case 'create_subscription': {
            const approve = (r.links ?? []).find((l: Json) => l?.rel === 'approve')?.href;
            if (typeof r.id === 'string') refs.newSubscriptionId = r.id;
            if (typeof approve === 'string') refs.approveLink = approve;
            summary = `${m}: created subscription ${r.id} on plan ${targetId} for ${c.representative.name}. It starts once approved at PayPal.`;
            break;
          }
          case 'generate_invoice_qr_code': {
            const invoice: Json = await backend.exec('get_invoice', { invoice_id: targetId });
            const payLink = invoice?.detail?.metadata?.recipient_view_url;
            if (typeof payLink === 'string') refs.payLink = payLink;
            data = { invoice_id: targetId, qr_code_generated: true, pay_link: refs.payLink ?? null }; // the image itself is of no use to the model
            summary = `${m}: made a payment code for invoice ${targetId}${refs.payLink ? `, payable at ${refs.payLink}` : ''}.`;
            break;
          }
        }
        if (def.write) store.doneFor(caseId).add(key);
        Object.assign(item.refs, refs);
        return ok(targetId, summary, data, refs);
      } catch (e) {
        if (once) store.doneFor(caseId).delete(key); // it did not happen, so it may be tried again
        const error = (e as Error).message;
        const summary = `${m}: ${name} on ${targetId} failed. PayPal said: ${error}`;
        store.log(slug, { caseId, tool: name, target: targetId, ok: false, denied: false, summary, refs: {} });
        store.emit(caseId, { actor: `desk:${slug}`, type: 'tool', summary, detail: { tool: name, args: send, error } });
        return { ok: false, denied: false, error };
      }
    },
  };
}

// ---- reading PayPal back --------------------------------------------------

/** The object's status as PayPal reports it now. */
export async function readLiveStatus(item: Item): Promise<string> {
  try {
    const backend = backendFor(item.merchant);
    let r: Json;
    if (item.kind === 'subscription') r = await backend.exec('show_subscription_details', { subscription_id: item.paypalId });
    else if (item.kind === 'invoice') r = await backend.exec('get_invoice', { invoice_id: item.paypalId });
    else r = capturesOf(await backend.exec('get_order', { id: item.charges[0]?.orderId })).find((cap) => cap.id === item.paypalId);
    return typeof r?.status === 'string' ? r.status : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Re-reads PayPal and says whether it shows what was decided for this item. Also refreshes `item.liveStatus`.
 * With `expect` (pause and resume, where nothing is decided yet) it only checks the subscription's status.
 */
export async function verifyOutcome(item: Item, expect?: 'SUSPENDED' | 'ACTIVE'): Promise<boolean> {
  const live = (item.liveStatus = await readLiveStatus(item));
  if (expect) return live === expect;
  const d = item.decided;
  if (!d) return false;
  const backend = backendFor(item.merchant);
  const reads = async (tool: string, args: Args): Promise<Json> => backend.exec(tool, args).catch(() => null);
  const refunded = async () => {
    for (const { captureId } of d.refunds) {
      const refundId = item.refs[`refund:${captureId}`];
      if (!refundId || (await reads('get_refund', { refund_id: refundId }))?.status !== 'COMPLETED') return false;
    }
    return true;
  };
  switch (d.action) {
    case 'leave':
      return true;
    case 'pause':
      return live === 'SUSPENDED';
    case 'close':
      return live === 'CANCELLED' && (await refunded());
    case 'refund':
      return refunded();
    case 'take_over': {
      const replacement = item.refs.newSubscriptionId;
      return live === 'SUSPENDED' && !!replacement && !!(await reads('show_subscription_details', { subscription_id: replacement }))?.id && (await refunded());
    }
    case 'waive':
      return live === 'CANCELLED';
    case 'pay_from_estate':
      return !!item.refs.payLink && live !== 'CANCELLED' && live !== 'unknown';
  }
}
