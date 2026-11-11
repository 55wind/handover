import OpenAI from 'openai';
import { ACTIONS_BY_KIND, type Action, type Case, type Item, type MerchantSlug, type Phase } from './types';
import { store } from './store';
import { MERCHANTS, SLUGS, isScripted } from './merchants';
import { deskFor, inventory, readLiveStatus, verifyOutcome } from './desk';
import { fromCents, toCents, validatePlan, type PlanRow } from './guard';

// ---- model client (OpenAI-compatible chat completions; injectable for tests) ----

export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LlmCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface LlmReply {
  content: string | null;
  tool_calls?: LlmCall[];
}
export type LlmMessage =
  | { role: 'system' | 'user'; content: unknown }
  | ({ role: 'assistant' } & LlmReply)
  | { role: 'tool'; tool_call_id: string; content: string };
export type Llm = (messages: LlmMessage[], tools: LlmTool[]) => Promise<LlmReply>;

let client: OpenAI | undefined;
let standIn: Llm | undefined;
const defaultLlm: Llm = async (messages, tools) => {
  if (isScripted()) {
    standIn ??= (await import('./llm-scripted')).scripted();
    return standIn(messages, tools);
  }
  if (!process.env.OPENAI_API_KEY || !process.env.LLM_MODEL) {
    throw new Error('No language model is configured. Set OPENAI_API_KEY and LLM_MODEL.');
  }
  client ??= new OpenAI({ baseURL: process.env.OPENAI_BASE_URL || undefined });
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    messages: messages as never,
    ...(tools.length ? { tools } : {}),
  });
  const m = res.choices[0].message;
  return { content: m.content, tool_calls: m.tool_calls as LlmCall[] | undefined };
};

// ---- prompts ----

const PRINCIPLES = `You are Handover, an executor agent acting for a family after a death. You act through merchant desks. Each desk enforces its merchant's rules in code and may refuse a call. When a call is refused, do not repeat it: adapt, or report the item as blocked.

Rules:
- Use only ids returned by the tools. Never invent an id or an amount. The desk sets every refund amount.
- When something is uncertain, choose the reversible step.
- Follow the family's wishes wherever the merchant's policy allows.
- Before each batch of tool calls, write one short plain sentence saying what you are about to do.
- No condolences, no filler, no sales language.
- Write anything addressed to the family in the language of their wishes text.`;

const PLAN_TASK = `Task: propose what to do with every item this person left at the merchants.
1. For each merchant call find_customer_records and get_policy.
2. Confirm the live status of each subscription and invoice with the read tools.
3. Choose one action per item.
   - subscription: close, take_over or pause. take_over only when the policy allows it and the family wants to keep the service.
   - charge: refund or leave.
   - invoice: waive (only when the policy allows it) or pay_from_estate.
   In refund_capture_ids list every charge of that item whose "refundable" is above 0.00. Leave a charge out only when the wishes suggest the family would not want it back, and then say so in "question".
4. Call submit_plan with exactly one row per item_id.
   - reason: one or two plain sentences naming the policy or the wish behind the choice.
   - question: only when the family has to decide something.
   - notes: anything else the family should know, such as a customer you left out.
If submit_plan returns errors, correct those rows and call it again.`;

const EXECUTE_TASK = (id: string) => `Task: carry out the approved plan in the next message, then record the outcome of every item.
By action:
- close: create_refund for each listed capture, then cancel_subscription with payload.reason "Account holder deceased. Handover case ${id}."
- take_over: create_subscription with the item's plan_id, then suspend_subscription on the old subscription with reason "Being taken over by family. Handover case ${id}.", then create_refund for each listed capture.
- pause: suspend_subscription with reason "Paused by family. Handover case ${id}."
- refund: create_refund for each listed capture.
- leave: nothing to do.
- waive: cancel_invoice_auto_reminder, then cancel_sent_invoice with a one-line note. If no reminder is set, carry on.
- pay_from_estate: cancel_invoice_auto_reminder, then generate_invoice_qr_code.
For create_refund pass only capture_id and a short note_to_payer.
When an item is finished call record_outcome with its item_id, a state and a one-sentence note. States: done; waiting (take_over and pay_from_estate wait on the family); blocked (a desk or PayPal refused: say why and what the family can do next); failed. The system re-reads PayPal and decides whether the item is confirmed.
When every item has an outcome call finish with a note of two to four sentences for the family: what was done and what they still need to do. Put no amounts in the note; the system adds the figures.`;

const HOLD_TASK = (id: string, pause: boolean) =>
  pause
    ? `Task: the notice is filed but the document is not yet matched, so only reversible steps are allowed. Call suspend_subscription with reason "Notice of death filed. Handover case ${id}." on every subscription in the next message whose status is ACTIVE. Then call finish with one sentence for the family.`
    : `Task: undo the pause. Call activate_subscription with reason "Pause lifted by family. Handover case ${id}." on every subscription in the next message whose status is SUSPENDED. Then call finish with one sentence for the family.`;

const INTAKE_PROMPT = `You read a document a family provides as evidence of a death (a funeral home notice, a death certificate, an obituary). Reply with JSON only, no prose: {"full_name": string or null, "date_of_death": "YYYY-MM-DD" or null, "kind": short description of the document}. Report only what the document says.`;

// ---- local tools ----

const fn = (name: string, description: string, parameters: Record<string, unknown>): LlmTool => ({
  type: 'function',
  function: { name, description, parameters },
});
const ALL_ACTIONS = [...new Set(Object.values(ACTIONS_BY_KIND).flat())];

const SUBMIT_PLAN = fn('submit_plan', 'Submit the proposed plan: one row per item. Returns errors to correct, or accepted.', {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item_id: { type: 'string' },
          action: { type: 'string', enum: ALL_ACTIONS },
          refund_capture_ids: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          question: { type: 'string' },
        },
        required: ['item_id', 'action', 'refund_capture_ids', 'reason'],
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['rows'],
});
const RECORD_OUTCOME = fn('record_outcome', 'Record the outcome of one item after acting on it. The system verifies it against PayPal.', {
  type: 'object',
  properties: {
    item_id: { type: 'string' },
    state: { type: 'string', enum: ['done', 'waiting', 'blocked', 'failed'] },
    note: { type: 'string' },
  },
  required: ['item_id', 'state', 'note'],
});
const FINISH = fn('finish', 'Call once when the task is complete.', {
  type: 'object',
  properties: { note: { type: 'string' } },
  required: ['note'],
});

type Local = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

// ---- the loop ----

async function loop(
  c: Case,
  phase: Phase,
  system: string,
  user: unknown,
  localDefs: LlmTool[],
  local: Local,
  llm: Llm,
  done: () => boolean,
  nudge: () => string | null,
): Promise<void> {
  const tools: LlmTool[] = [
    ...SLUGS.flatMap((slug) =>
      deskFor(slug)
        .listTools(phase)
        .map((t) => fn(`${slug}__${t.name}`, `[${MERCHANTS[slug].name}] ${t.description}`, t.parameters)),
    ),
    ...localDefs,
  ];
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(user) },
  ];
  let nudges = 0;
  // ponytail: fixed turn cap; raise it if estates grow beyond a few dozen items.
  for (let turn = 0; turn < 40 && !done(); turn++) {
    const reply = await llm(messages, tools);
    const calls = reply.tool_calls ?? [];
    messages.push({ role: 'assistant', content: reply.content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (reply.content?.trim()) store.emit(c.id, { actor: 'agent', type: 'note', summary: reply.content.trim() });
    if (!calls.length) {
      const text = nudge();
      if (!text || nudges++ >= 2) break;
      messages.push({ role: 'user', content: text });
      continue;
    }
    const results = await Promise.all(
      calls.map(async (call) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* malformed arguments are treated as empty; the tool will say what is missing */
        }
        const name = call.function.name;
        let result: unknown;
        if (local[name]) result = await local[name](args);
        else {
          const [slug, tool] = name.split('__') as [MerchantSlug, string];
          result = SLUGS.includes(slug)
            ? await deskFor(slug).callTool(tool, args, c.id)
            : { ok: false, denied: true, error: `Unknown tool ${name}` };
        }
        return { role: 'tool' as const, tool_call_id: call.id, content: JSON.stringify(result).slice(0, 5000) };
      }),
    );
    messages.push(...results);
  }
}

// ---- phases ----

const tokens = (s: string) => s.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Same person if the first and last name tokens agree; middle names and initials are ignored. */
function sameName(a: string, b: string): boolean {
  const x = tokens(a);
  const y = tokens(b);
  return x.length > 0 && y.length > 0 && x[0] === y[0] && x.at(-1) === y.at(-1);
}

async function intake(c: Case, llm: Llm): Promise<void> {
  const d = c.document;
  d.mismatches = [];
  d.extracted = undefined;
  c.tier = 'filed';
  if (!d.text && !d.dataUrl) {
    d.mismatches = ['No document was provided.'];
  } else {
    const content = [
      { type: 'text', text: `Document provided by the family:\n\n${d.text ?? '(see image)'}` },
      ...(d.dataUrl ? [{ type: 'image_url', image_url: { url: d.dataUrl } }] : []),
    ];
    const reply = await llm(
      [
        { role: 'system', content: INTAKE_PROMPT },
        { role: 'user', content },
      ],
      [],
    );
    const json = /\{[\s\S]*\}/.exec(reply.content ?? '')?.[0];
    let x: { full_name?: string | null; date_of_death?: string | null; kind?: string } = {};
    try {
      x = JSON.parse(json ?? '{}');
    } catch {
      /* unreadable reply counts as nothing extracted */
    }
    d.extracted = { fullName: x.full_name ?? undefined, dateOfDeath: x.date_of_death ?? undefined, kind: x.kind };
    if (!x.full_name || !sameName(x.full_name, c.deceased.fullName)) {
      d.mismatches.push(`The document names ${x.full_name ? `"${x.full_name}"` : 'no one'}; the notice says "${c.deceased.fullName}".`);
    }
    if (x.date_of_death !== c.deceased.dateOfDeath) {
      d.mismatches.push(`The document gives ${x.date_of_death ?? 'no date of death'}; the notice says ${c.deceased.dateOfDeath}.`);
    }
  }
  if (!d.mismatches.length) c.tier = 'verified';
  store.emit(c.id, {
    actor: 'agent',
    type: 'status',
    summary:
      c.tier === 'verified'
        ? `Read the document (${d.extracted?.kind ?? 'document'}). The name and the date of death match the notice.`
        : `The document could not be matched: ${d.mismatches.join(' ')} Only reversible steps are available until it matches.`,
  });
}

const SAFE_DEFAULT: Record<Item['kind'], Action> = { subscription: 'pause', charge: 'leave', invoice: 'pay_from_estate' };

async function plan(c: Case, llm: Llm): Promise<void> {
  if (c.approvedAt) throw new Error('This case is already approved.');
  c.status = 'planning';
  const inv = inventory(c);
  c.items = inv.items;
  c.notes = inv.nearMatches.map(
    (n) => `${MERCHANTS[n.merchant].name} also has a customer named ${n.fullName} (${n.email}). ${n.reason} It was left out.`,
  );
  let attempts = 0;
  let accepted = false;
  const local: Local = {
    submit_plan: async (args) => {
      attempts++;
      const rows = (Array.isArray(args.rows) ? args.rows : []) as PlanRow[];
      const { decisions, errors } = validatePlan(rows, c.items, MERCHANTS);
      if (errors.length && attempts < 3) return { accepted: false, errors };
      for (const item of c.items) {
        const d = decisions.get(item.id);
        const row = rows.find((r) => r.item_id === item.id);
        if (!d || !row) continue;
        item.proposed = { ...d, reason: String(row.reason ?? ''), ...(row.question ? { question: String(row.question) } : {}) };
        item.decided = { action: d.action, refunds: d.refunds.map((r) => ({ ...r })) };
      }
      for (const n of Array.isArray(args.notes) ? args.notes : []) c.notes.push(String(n));
      accepted = true;
      return { accepted: true, dropped: errors };
    },
  };
  await loop(
    c,
    'plan',
    `${PRINCIPLES}\n\n${PLAN_TASK}`,
    {
      case_id: c.id,
      today: new Date().toISOString().slice(0, 10),
      person: c.deceased,
      family_representative: c.representative,
      wishes: c.wishes,
      merchants: SLUGS.map((slug) => ({ slug, name: MERCHANTS[slug].name, policy: MERCHANTS[slug].policy.summary })),
    },
    [SUBMIT_PLAN],
    local,
    llm,
    () => accepted,
    () => 'Call submit_plan with one row for every item.',
  );
  for (const item of c.items) {
    if (item.decided) continue;
    const action = SAFE_DEFAULT[item.kind];
    item.proposed = { action, refunds: [], reason: 'No valid proposal was produced for this item, so the reversible default is shown. Please choose.' };
    item.decided = { action, refunds: [] };
  }
  await Promise.all(c.items.map(async (item) => void (item.liveStatus = await readLiveStatus(item))));
  c.status = 'review';
  store.emit(c.id, {
    actor: 'agent',
    type: 'plan',
    summary: c.items.length
      ? `Plan ready: ${c.items.length} items at ${new Set(c.items.map((i) => i.merchant)).size} merchants.`
      : 'No accounts were found for the emails given.',
  });
}

async function hold(c: Case, llm: Llm, pause: boolean): Promise<void> {
  if (c.approvedAt) throw new Error('This case is already approved.');
  if (!c.items.length) c.items = inventory(c).items;
  const subs = c.items.filter((i) => i.kind === 'subscription');
  await Promise.all(subs.map(async (item) => void (item.liveStatus = await readLiveStatus(item))));
  let finished = false;
  await loop(
    c,
    pause ? 'pause' : 'resume',
    `${PRINCIPLES}\n\n${HOLD_TASK(c.id, pause)}`,
    { subscriptions: subs.map((i) => ({ merchant: i.merchant, label: i.label, subscription_id: i.paypalId, status: i.liveStatus })) },
    [FINISH],
    { finish: async () => ((finished = true), { ok: true }) },
    llm,
    () => finished,
    () => 'Continue, then call finish.',
  );
  const want = pause ? 'SUSPENDED' : 'ACTIVE';
  for (const item of subs) await verifyOutcome(item, want);
  c.paused = subs.some((i) => i.liveStatus === 'SUSPENDED');
  const n = subs.filter((i) => i.liveStatus === want).length;
  store.emit(c.id, {
    actor: 'system',
    type: 'outcome',
    summary: `${n} of ${subs.length} subscriptions are ${pause ? 'paused' : 'active'}, confirmed with PayPal.`,
  });
}

const WAITS: Action[] = ['take_over', 'pay_from_estate'];

function setOutcome(item: Item, verified: boolean, claimed: string, note: string): void {
  const action = item.decided!.action;
  const state = verified ? (WAITS.includes(action) ? 'waiting' : 'done') : claimed === 'failed' ? 'failed' : claimed === 'not_completed' ? 'not_completed' : 'blocked';
  item.outcome = {
    state,
    refs: { ...item.refs },
    verified,
    note: verified || claimed === 'blocked' || claimed === 'failed' || claimed === 'not_completed' ? note : `${note} PayPal does not show this as completed.`.trim(),
    link: item.refs.approveLink ?? item.refs.payLink,
  };
}

const DONE_TEXT: Record<Action, string> = {
  close: 'closed',
  take_over: 'being taken over; the old subscription is paused until the new one is approved in PayPal',
  pause: 'paused',
  refund: 'refunded',
  leave: 'left as it is',
  waive: 'waived; the invoice is cancelled',
  pay_from_estate: 'to be paid from the estate; reminders are stopped and a payment link is ready',
};

function buildStatement(c: Case, note: string): string {
  let total = 0;
  const lines = c.items.map((item) => {
    const o = item.outcome!;
    const d = item.decided!;
    const refunds = d.refunds.filter((r) => item.refs[`refund:${r.captureId}`]);
    if (o.verified) total += refunds.reduce((sum, r) => sum + toCents(r.amount), 0);
    const refundText = refunds.length
      ? ` Refunded $${fromCents(refunds.reduce((sum, r) => sum + toCents(r.amount), 0))} to the original payment method (${refunds.map((r) => item.refs[`refund:${r.captureId}`]).join(', ')}).`
      : '';
    const status = o.verified ? `${DONE_TEXT[d.action]}. Confirmed with PayPal.` : `not completed. ${o.note}`;
    return `- ${MERCHANTS[item.merchant].name}, ${item.label} (${item.paypalId}): ${status}${o.verified ? refundText : ''}`;
  });
  return [
    'Closing statement',
    `Case ${c.id}, ${new Date().toISOString().slice(0, 10)}`,
    `Prepared for ${c.representative.name} regarding the accounts of ${c.deceased.fullName}.`,
    '',
    note,
    '',
    ...lines,
    '',
    `Total refunded: $${fromCents(total)}`,
  ].join('\n');
}

async function execute(c: Case, llm: Llm): Promise<void> {
  if (c.tier !== 'verified' || !c.approvedAt) throw new Error('The plan has not been approved.');
  c.status = 'executing';
  const todo = () => c.items.filter((i) => !i.outcome);
  let note = '';
  let finished = false;
  const local: Local = {
    record_outcome: async (args) => {
      const item = c.items.find((i) => i.id === args.item_id);
      if (!item) return { error: `There is no item ${String(args.item_id)}.` };
      const verified = await verifyOutcome(item);
      setOutcome(item, verified, String(args.state), String(args.note ?? ''));
      store.emit(c.id, {
        actor: 'system',
        type: 'outcome',
        summary: `${MERCHANTS[item.merchant].name}, ${item.label}: ${item.outcome!.verified ? `${DONE_TEXT[item.decided!.action]}. Confirmed with PayPal.` : `${item.outcome!.state}. ${item.outcome!.note}`}`,
        detail: { itemId: item.id, outcome: item.outcome },
      });
      return { recorded: item.outcome!.state, confirmed_with_paypal: verified, live_status: item.liveStatus, items_without_outcome: todo().map((i) => i.id) };
    },
    finish: async (args) => {
      note = String(args.note ?? '');
      finished = true;
      return { ok: true, items_without_outcome: todo().map((i) => i.id) };
    },
  };
  await loop(
    c,
    'execute',
    `${PRINCIPLES}\n\n${EXECUTE_TASK(c.id)}`,
    {
      case_id: c.id,
      family_representative: c.representative,
      plan: c.items.map((i) => ({
        item_id: i.id,
        merchant: i.merchant,
        kind: i.kind,
        label: i.label,
        paypal_id: i.paypalId,
        plan_id: i.planId,
        action: i.decided!.action,
        refunds: i.decided!.refunds.map((r) => ({ capture_id: r.captureId, amount: r.amount })),
      })),
    },
    [RECORD_OUTCOME, FINISH],
    local,
    llm,
    () => finished && !todo().length,
    () => (todo().length ? `These items have no recorded outcome yet: ${todo().map((i) => i.id).join(', ')}. Finish them and record each outcome.` : finished ? null : 'Call finish with the note for the family.'),
  );
  // Anything the model left unrecorded is judged by PayPal's state alone.
  for (const item of todo()) {
    const verified = await verifyOutcome(item);
    setOutcome(item, verified, 'not_completed', verified ? '' : 'The agent stopped before finishing this item. Nothing is shown as done that PayPal does not confirm.');
  }
  c.statement = buildStatement(c, note || 'The steps below were carried out for you.');
  c.status = 'done';
  store.emit(c.id, { actor: 'system', type: 'status', summary: 'Closing statement ready.' });
}

// ---- entry point ----

const STARTED: Record<Phase, string> = {
  intake: 'Reading the document.',
  plan: 'Looking for accounts at each merchant and drafting a plan.',
  pause: 'Pausing every active subscription. This can be undone.',
  resume: 'Lifting the pause.',
  execute: 'Carrying out the approved plan.',
};

/** Runs one phase to completion. `intake` continues into `plan`. Errors are reported on the case, not thrown. */
export async function runPhase(caseId: string, phase: Phase, llm: Llm = defaultLlm): Promise<void> {
  const c = store.cases.get(caseId);
  if (!c) throw new Error('Unknown case.');
  if (c.running) throw new Error('A run is already active for this case.');
  const before = c.status;
  try {
    for (const step of phase === 'intake' ? (['intake', 'plan'] as Phase[]) : [phase]) {
      c.running = step;
      store.emit(c.id, { actor: 'system', type: 'status', summary: STARTED[step] });
      if (step === 'intake') await intake(c, llm);
      else if (step === 'plan') await plan(c, llm);
      else if (step === 'execute') await execute(c, llm);
      else await hold(c, llm, step === 'pause');
    }
  } catch (e) {
    if (c.status === 'planning' || c.status === 'executing') c.status = c.status === 'planning' ? before : 'review';
    c.running = null;
    store.emit(c.id, { actor: 'system', type: 'error', summary: `Stopped: ${(e as Error).message}` });
    return;
  }
  c.running = null;
  store.emit(c.id, { actor: 'system', type: 'status', summary: 'Ready.' });
}
