import { ACTIONS_BY_KIND } from './types';
import type { Action, Case, Charge, CustomerRecord, Decision, Item, Merchant, MerchantSlug, Policy, RefundLine } from './types';

// ---- money and dates ------------------------------------------------------

// ponytail: float multiply then round. Exact for plain USD strings like "17.99"; not for "1,000.00" or 3-decimal currencies.
export function toCents(s: string): number {
  return Math.round(Number(s) * 100);
}
export function fromCents(n: number): string {
  return (n / 100).toFixed(2);
}

/** Whole days from a to b. YYYY-MM-DD parses as UTC midnight, so clock changes cannot skew it. */
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** The one refund rule. Dates compare as strings; `period.end` is exclusive. */
export function refundableCents(charge: Charge, dateOfDeath: string, policy: Policy, alreadyRefundedCents: number): number {
  const { start, end } = charge.period;
  const amount = toCents(charge.amount);
  let cents = 0;
  if (start >= dateOfDeath) cents = amount;
  else if (dateOfDeath < end && policy.prorataCurrentPeriod) cents = Math.floor((amount * days(dateOfDeath, end)) / days(start, end));
  return Math.max(0, cents - alreadyRefundedCents);
}

// ---- ownership ------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase();
const familyName = (s: string) => norm(s).split(/\s+/).pop();

export function matchCustomers(
  records: CustomerRecord[],
  deceased: Case['deceased'],
): { owned: CustomerRecord[]; nearMatches: { record: CustomerRecord; reason: string }[] } {
  const emails = new Set(deceased.emails.map(norm).filter(Boolean)); // a blank email must never match a blank record
  const family = familyName(deceased.fullName);
  const isOwned = (r: CustomerRecord) => emails.has(norm(r.email));
  return {
    owned: records.filter(isOwned),
    nearMatches: records
      .filter((r) => !isOwned(r) && !!family && familyName(r.fullName) === family)
      .map((record) => ({
        record,
        reason:
          norm(record.fullName) === norm(deceased.fullName)
            ? 'Same name, but the email on file is not one the family gave.'
            : `The name on file is ${record.fullName}, not ${deceased.fullName}, and the email on file is not one the family gave.`,
      })),
  };
}

export function buildItems(merchant: Merchant, owned: CustomerRecord[], dateOfDeath: string, refunded: Map<string, number>): Item[] {
  return owned.flatMap((r) =>
    r.items.map((it) => ({
      ...it,
      merchant: merchant.slug,
      liveStatus: 'unknown',
      refs: {},
      charges: it.charges.map((ch) => ({
        ...ch,
        refundable: fromCents(refundableCents(ch, dateOfDeath, merchant.policy, refunded.get(ch.captureId) ?? 0)),
      })),
    })),
  );
}

// ---- plan validation ------------------------------------------------------

export interface PlanRow {
  item_id: string;
  action: Action;
  refund_capture_ids: string[];
  reason: string;
  question?: string;
}

const CAN_REFUND: Action[] = ['close', 'take_over', 'refund'];

/** Rows come from the model or the family. Only rows without an error become decisions; refund amounts are always ours. */
export function validatePlan(
  rows: PlanRow[],
  items: Item[],
  merchants: Record<MerchantSlug, Merchant>,
): { decisions: Map<string, Decision>; errors: string[] } {
  const decisions = new Map<string, Decision>();
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const item = items.find((i) => i.id === row.item_id);
    if (!item) {
      errors.push(`There is no item "${row.item_id}" in this case. Use only the item ids from the customer records.`);
      continue;
    }
    const id = item.id;
    if (seen.has(id)) {
      errors.push(`Item ${id} has more than one row. Send exactly one row per item.`);
      decisions.delete(id);
      continue;
    }
    seen.add(id);

    const before = errors.length;
    const { name, policy } = merchants[item.merchant];
    const allowed = ACTIONS_BY_KIND[item.kind];
    const captures = [...new Set(row.refund_capture_ids ?? [])]; // the model may leave the list out
    if (!allowed.includes(row.action)) errors.push(`Item ${id} is of kind ${item.kind}, so its action must be one of ${allowed.join(', ')}. "${row.action}" is not allowed.`);
    else if (row.action === 'take_over' && !policy.allowTakeOver) errors.push(`Item ${id}: ${name} does not allow take-over. Choose close or pause.`);
    else if (row.action === 'waive' && !policy.waiveUndeliveredInvoices) errors.push(`Item ${id}: ${name} does not waive invoices. Choose pay_from_estate.`);
    else if (row.action === 'refund' && !captures.length) errors.push(`Item ${id}: the action refund needs at least one capture id in refund_capture_ids. Choose leave if nothing is to be refunded.`);
    else if (captures.length && !CAN_REFUND.includes(row.action)) errors.push(`Item ${id}: the action ${row.action} cannot carry refunds. Empty refund_capture_ids, or choose close, take_over or refund.`);

    const refunds: RefundLine[] = [];
    for (const captureId of captures) {
      const charge = item.charges.find((ch) => ch.captureId === captureId);
      if (!charge) errors.push(`Item ${id}: capture ${captureId} is not one of this item's charges.`);
      else if (!(toCents(charge.refundable) > 0)) errors.push(`Item ${id}: capture ${captureId} has nothing refundable. Remove it from refund_capture_ids.`);
      else refunds.push({ captureId, amount: charge.refundable });
    }
    if (errors.length === before) decisions.set(id, { action: row.action, refunds });
  }

  for (const item of items) if (!seen.has(item.id)) errors.push(`Item ${item.id} has no row. Every item needs exactly one row.`);
  return { decisions, errors };
}

// ---- guard ----------------------------------------------------------------

export interface GuardInput {
  tool: string;
  targetId: string;
  amountCents?: number;
  c: Case;
  item?: Item; // the case item the target id belongs to; absent when the id is not this customer's
  merchant: Merchant;
  done: Set<string>; // "tool:targetId" of calls that already went through for this case
  replacementActive?: boolean; // take-over only: the family member's new subscription is approved at PayPal
}

const READ = ['show_subscription_details', 'get_invoice', 'get_order', 'get_refund'];
const REVERSIBLE = ['suspend_subscription', 'activate_subscription', 'cancel_invoice_auto_reminder', 'generate_invoice_qr_code'];
/** Irreversible tools and the approved action each one carries out. create_refund is checked per capture instead. */
const NEEDS = new Map<string, Action>([
  ['cancel_subscription', 'close'],
  ['create_subscription', 'take_over'],
  ['cancel_sent_invoice', 'waive'],
]);

export function guard({ tool, targetId, amountCents, c, item, merchant, done, replacementActive }: GuardInput): { allow: true } | { allow: false; reason: string } {
  const deny = (reason: string) => ({ allow: false as const, reason });
  const need = NEEDS.get(tool);
  const irreversible = !!need || tool === 'create_refund';

  if (!irreversible && !READ.includes(tool) && !REVERSIBLE.includes(tool)) return deny(`${tool} is not a tool this desk permits.`);
  if (!item || item.merchant !== merchant.slug) return deny(`${targetId} is not this customer's at ${merchant.name}, so it cannot be read or changed.`);
  // Reversible writes may repeat: pause, resume, pause must work, and a repeat cannot move money.
  if (!irreversible) return { allow: true };

  if (c.tier !== 'verified') return deny(`${tool} cannot be undone, so it needs a verified notice. Until then only pausing is possible.`);
  if (!c.approvedAt) return deny(`${tool} cannot be undone, and the family has not approved the plan yet.`);
  if (done.has(`${tool}:${targetId}`)) return deny(`${tool} on ${targetId} is already done for this case. Do not repeat it.`);

  if (need) {
    if (item.decided?.action === need) return { allow: true };
    // A take-over ends with the old subscription cancelled, but only once the replacement is approved.
    if (tool === 'cancel_subscription' && item.decided?.action === 'take_over') {
      return replacementActive
        ? { allow: true }
        : deny(`Item ${item.id} is being taken over. Its old subscription can be cancelled only after the replacement is approved at PayPal.`);
    }
    return deny(`${tool} needs the approved action for item ${item.id} to be ${need}, but it is ${item.decided?.action ?? 'not decided'}.`);
  }

  const line = item.decided?.refunds.find((r) => r.captureId === targetId);
  if (!line) return deny(`The approved plan has no refund for capture ${targetId} on item ${item.id}.`);
  const cents = amountCents ?? NaN; // a missing or NaN amount fails both comparisons
  if (cents > 0 && cents <= toCents(line.amount)) return { allow: true };
  return deny(`A refund on capture ${targetId} needs an amount above 0.00 and at most ${line.amount}, the approved amount.`);
}
