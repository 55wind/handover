// Handover as an MCP server, so a family's own assistant can file a notice and follow the case.
// Streamable HTTP, stateless, plain JSON responses. Every tool goes through the same functions as the web page.
import { finalizeTakeOvers, runPhase } from './agent';
import { applyDecisions, applyNotice, approve } from './cases';
import { MERCHANTS, isConfigured } from './merchants';
import { seedDemoCase } from './seed';
import { store } from './store';
import { ACTIONS_BY_KIND, type Action, type Case, type Phase } from './types';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Handover settles the payments a person left behind after their death, on the PayPal sandbox. You are acting for a family member.
Flow: start_demo_case (demo data) -> file_notice (the Handover agent reads the document, finds the accounts and drafts a plan) -> show the plan to the family member, in plain words, including each reason and any question -> change_decision for anything they want different -> approve_and_carry_out only after they have clearly said yes -> get_case for outcomes and the closing statement.
Refund amounts and which accounts belong to the person are decided by Handover's code, not by you. Before the document is matched, only pause_everything and resume_everything are possible.`;

type Args = Record<string, unknown>;

/** The case as an assistant needs it: no raw events, plain field names. */
function view(c: Case) {
  const lastError = [...c.events].reverse().find((e) => e.type === 'error');
  return {
    case_id: c.id,
    page: `${process.env.APP_URL ?? 'http://localhost:3000'}/case/${c.id}`,
    status: c.status,
    document_check: c.tier === 'verified' ? 'matched' : { not_matched: c.document.mismatches, only_reversible_steps_available: true },
    person: c.deceased,
    family_representative: c.representative,
    wishes: c.wishes,
    document_text: c.document.text,
    paused: c.paused,
    approved_at: c.approvedAt,
    notes_from_the_agent: c.notes,
    items: c.items.map((i) => ({
      item_id: i.id,
      merchant: MERCHANTS[i.merchant].name,
      label: i.label,
      kind: i.kind,
      amount: i.amount,
      status_at_paypal: i.liveStatus,
      allowed_actions: ACTIONS_BY_KIND[i.kind],
      charges: i.charges.map((ch) => ({ capture_id: ch.captureId, period: ch.period, amount: ch.amount, refundable: ch.refundable })),
      proposed: i.proposed,
      decided: i.decided,
      outcome: i.outcome && {
        state: i.outcome.state,
        confirmed_with_paypal: i.outcome.verified,
        note: i.outcome.note,
        link_for_the_family: i.outcome.link,
        paypal_references: { id: i.paypalId, ...i.refs },
      },
    })),
    closing_statement: c.statement,
    ...(c.running ? { agent_is_working: `The agent is still working (${c.running}). Call get_case again in a few seconds.` } : {}),
    ...(c.status !== 'done' && lastError ? { last_error: lastError.summary } : {}),
  };
}

function caseOf(args: Args): Case {
  const c = store.cases.get(String(args.case_id));
  if (!c) throw new Error('This case is no longer available. Cases live in memory; start a new one.');
  if (c.running) throw new Error('The agent is already working on this case. Try again when it has finished.');
  return c;
}
const must = (error: string | null) => {
  if (error) throw new Error(error);
};
async function run(c: Case, phase: Phase) {
  if (!store.takeRunSlot(c.id)) throw new Error('This case has used its allowance of agent runs. Start a new demo case.');
  const done = runPhase(c.id, phase).catch(() => {});
  // Many MCP clients give up on a request that stays silent for about a minute. The run carries on either way,
  // and get_case shows where it stands.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([done, new Promise((resolve) => (timer = setTimeout(resolve, 45_000)))]);
  clearTimeout(timer);
  return view(c);
}

const CASE_ID = { case_id: { type: 'string' } };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

const TOOLS: { name: string; description: string; inputSchema: Record<string, unknown>; run: (args: Args) => Promise<unknown> }[] = [
  {
    name: 'start_demo_case',
    description:
      'Create a fresh demo estate on the PayPal sandbox (a fictional person with subscriptions, card payments and an invoice at three fictional merchants) and open a case for it with a prefilled notice. Nothing is filed yet.',
    inputSchema: schema({}),
    run: async () => {
      if (!isConfigured()) throw new Error('The PayPal sandbox is not configured on this server.');
      if (!store.takeDemoSlot()) throw new Error("Today's demo allowance is used up. Please try again tomorrow.");
      return view(await seedDemoCase());
    },
  },
  {
    name: 'file_notice',
    description:
      'File the notice of death for a case. The Handover agent then reads the document, looks for the person at each merchant and drafts a plan. Fields you leave out keep their current values. Returns the plan for the family to review. Can take a minute or two.',
    inputSchema: schema(
      {
        ...CASE_ID,
        full_name: { type: 'string' },
        emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses the person used with merchants' },
        date_of_death: { type: 'string', description: 'YYYY-MM-DD' },
        wishes: { type: 'string', description: "What the family wants, in their own words" },
        document_text: { type: 'string', description: 'Text of a funeral notice, death certificate or obituary' },
      },
      ['case_id'],
    ),
    run: async (a) => {
      const c = caseOf(a);
      must(
        applyNotice(c, {
          fullName: a.full_name ?? c.deceased.fullName,
          emails: a.emails ?? c.deceased.emails,
          dateOfDeath: a.date_of_death ?? c.deceased.dateOfDeath,
          representative: c.representative,
          wishes: a.wishes ?? c.wishes,
          documentText: a.document_text ?? c.document.text,
        }),
      );
      return run(c, 'intake');
    },
  },
  {
    name: 'get_case',
    description: 'Read a case: the document check, the plan with reasons and questions, outcomes confirmed with PayPal, and the closing statement.',
    inputSchema: schema(CASE_ID, ['case_id']),
    run: async (a) => {
      const c = store.cases.get(String(a.case_id));
      if (!c) throw new Error('This case is no longer available. Cases live in memory; start a new one.');
      return view(c);
    },
  },
  {
    name: 'change_decision',
    description:
      "Change what will be done with one item before approval. refund_capture_ids lists which of the item's charges to refund; only charges whose refundable amount is above 0.00 can be listed. The merchant's policy may refuse an action; the error says why.",
    inputSchema: schema(
      {
        ...CASE_ID,
        item_id: { type: 'string' },
        action: { type: 'string', enum: [...new Set(Object.values(ACTIONS_BY_KIND).flat())] },
        refund_capture_ids: { type: 'array', items: { type: 'string' } },
      },
      ['case_id', 'item_id', 'action'],
    ),
    run: async (a) => {
      const c = caseOf(a);
      must(
        applyDecisions(c, [
          { itemId: String(a.item_id), action: a.action as Action, refundCaptureIds: Array.isArray(a.refund_capture_ids) ? a.refund_capture_ids.map(String) : [] },
        ]),
      );
      return view(c);
    },
  },
  {
    name: 'approve_and_carry_out',
    description:
      'Approve the plan as it stands and have the agent carry it out on PayPal: refunds, cancellations, waived invoices, replacement subscriptions. This cannot be undone. Call it only after the family member has seen the plan and clearly said yes. Returns the outcomes and the closing statement.',
    inputSchema: schema(CASE_ID, ['case_id']),
    run: async (a) => {
      const c = caseOf(a);
      must(approve(c));
      return run(c, 'execute');
    },
  },
  {
    name: 'pause_everything',
    description: 'Pause every active subscription for this person. Reversible, and available before the document is matched.',
    inputSchema: schema(CASE_ID, ['case_id']),
    run: async (a) => {
      const c = caseOf(a);
      if (c.approvedAt) throw new Error('This case is already approved.');
      return run(c, 'pause');
    },
  },
  {
    name: 'resume_everything',
    description: 'Undo pause_everything.',
    inputSchema: schema(CASE_ID, ['case_id']),
    run: async (a) => {
      const c = caseOf(a);
      if (c.approvedAt) throw new Error('This case is already approved.');
      return run(c, 'resume');
    },
  },
  {
    name: 'check_take_over_approval',
    description:
      'After the family member has approved a replacement subscription at PayPal (the link on a waiting take-over), cancel the old subscription and mark the take-over done.',
    inputSchema: schema(CASE_ID, ['case_id']),
    run: async (a) => {
      const c = caseOf(a);
      await finalizeTakeOvers(c.id);
      return view(c);
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
        serverInfo: { name: 'handover', title: 'Handover', version: '0.1.0' },
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
