'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ColDef, GetRowIdFunc } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { MERCHANTS } from '@/lib/merchants';
import { ACTIONS_BY_KIND, type Action, type Case, type Item, type Outcome, type Phase } from '@/lib/types';
import { gridDefaults } from './grid';
import { CopyId, cents, day, dollars, period, sentence } from './ui';

const ACTION: Record<Action, string> = {
  close: 'Close',
  take_over: 'Take over',
  pause: 'Pause',
  refund: 'Refund',
  leave: 'Leave as is',
  waive: 'Ask to waive',
  pay_from_estate: 'Pay from the estate',
};
const KIND = { subscription: 'Subscription', charge: 'Charge', invoice: 'Invoice' };
const STATE: Record<Outcome['state'], string> = {
  done: 'Done',
  waiting: 'Waiting for approval',
  blocked: 'Blocked',
  failed: 'Failed',
  not_completed: 'Not completed',
};

export type Decide = (item: Item, action: Action, refundCaptureIds: string[]) => Promise<void>;
interface Shared {
  locked: boolean;
  decide: Decide;
  errors: Record<string, string>;
}
const Ctx = createContext<Shared>({ locked: true, decide: async () => {}, errors: {} });

/** What the row will do: the family's decision once they have made one, the agent's proposal until then. */
const choice = (item: Item) => item.decided ?? item.proposed;
const refundCents = (item: Item, captureIds: string[]) =>
  item.charges.filter((c) => captureIds.includes(c.captureId)).reduce((n, c) => n + cents(c.refundable), 0);

// Cells. Each one is used twice: by the grid on wide screens, and by the plain table on narrow screens and on paper.

type Cell = (p: { item: Item }) => ReactNode;

const MerchantCell: Cell = ({ item }) => <div className="cell">{MERCHANTS[item.merchant]?.name ?? item.merchant}</div>;

const ItemCell: Cell = ({ item }) => (
  <div className="cell">
    <span>{item.label}</span>
    <span className="small muted">
      {KIND[item.kind]}, ${item.amount}
      {item.cadence && ` a ${item.cadence}`}
    </span>
  </div>
);

const StatusCell: Cell = ({ item }) => <div className="cell">{sentence(item.liveStatus)}</div>;

const ActionCell: Cell = ({ item }) => {
  const { locked, decide } = useContext(Ctx);
  const [pending, setPending] = useState<Action | null>(null);
  const current = choice(item);

  async function change(action: Action) {
    setPending(action);
    // A one-off charge has a single thing to decide: refunding it or leaving it.
    const kept = current?.refunds.map((r) => r.captureId) ?? [];
    const refundable = item.charges.filter((c) => cents(c.refundable) > 0).map((c) => c.captureId);
    await decide(item, action, item.kind === 'charge' ? (action === 'refund' ? refundable : []) : kept);
    setPending(null);
  }

  return (
    <div className="cell">
      <select
        aria-label={`Action for ${item.label}`}
        value={pending ?? current?.action ?? ''}
        disabled={locked}
        onChange={(e) => change(e.target.value as Action)}
      >
        {!current && <option value="">Choose an action</option>}
        {ACTIONS_BY_KIND[item.kind].map((a) => (
          <option key={a} value={a}>
            {ACTION[a]}
          </option>
        ))}
      </select>
    </div>
  );
};

const RefundCell: Cell = ({ item }) => {
  const { locked, decide } = useContext(Ctx);
  const [pending, setPending] = useState<string[] | null>(null);
  const current = choice(item);
  const selected = pending ?? current?.refunds.map((r) => r.captureId) ?? [];

  if (!item.charges.length) return <div className="cell muted">No payment taken</div>;

  async function toggle(captureId: string, on: boolean) {
    const next = on ? [...selected, captureId] : selected.filter((id) => id !== captureId);
    setPending(next);
    const action = item.kind === 'charge' ? (next.length ? 'refund' : 'leave') : current?.action;
    if (action) await decide(item, action, next);
    setPending(null);
  }

  return (
    <div className="cell">
      <span className="num">{dollars(refundCents(item, selected))} to refund</span>
      {item.charges.map((c) => (
        <label key={c.captureId} className="charge">
          <input
            type="checkbox"
            checked={selected.includes(c.captureId)}
            disabled={locked || cents(c.refundable) === 0}
            onChange={(e) => toggle(c.captureId, e.target.checked)}
          />
          <span>
            {period(c.period)}
            <br />
            Refundable ${c.refundable} of ${c.amount}
          </span>
        </label>
      ))}
    </div>
  );
};

const ReasonCell: Cell = ({ item }) => {
  const { errors } = useContext(Ctx);
  return (
    <div className="cell">
      <span>{item.proposed?.reason}</span>
      {item.proposed?.question && (
        <p className="question">
          <b>The agent asks:</b> {item.proposed.question}
        </p>
      )}
      {errors[item.id] && (
        <p className="error" role="alert">
          {errors[item.id]}
        </p>
      )}
    </div>
  );
};

const DecisionCell: Cell = ({ item }) => {
  const refund = (item.decided?.refunds ?? []).reduce((n, r) => n + cents(r.amount), 0);
  return (
    <div className="cell">
      <span>{item.decided ? ACTION[item.decided.action] : 'No decision'}</span>
      {refund > 0 && <span className="small muted num">Refund {dollars(refund)}</span>}
    </div>
  );
};

const OutcomeCell: Cell = ({ item }) => {
  const o = item.outcome;
  if (!o) return <div className="cell muted">Not carried out yet</div>;
  const confirmed = o.state === 'done' && o.verified;
  const bad = o.state === 'blocked' || o.state === 'failed' || o.state === 'not_completed';
  return (
    <div className="cell">
      <span className={bad ? 'state state--bad' : 'state'}>
        {o.state === 'done' && !o.verified ? 'Reported done, not confirmed' : STATE[o.state]}
      </span>
      {confirmed && <span className="small muted">Confirmed with PayPal</span>}
      {o.note && <span className="small">{o.note}</span>}
      {o.state === 'waiting' && o.link && (
        <a className="btn btn--quiet" href={o.link} target="_blank" rel="noreferrer">
          Approve in PayPal sandbox
        </a>
      )}
    </div>
  );
};

const REF = { newSubscriptionId: 'New subscription', approveLink: 'Approval page', payLink: 'Payment page' };
const refLabel = (key: string) => (key.startsWith('refund:') ? 'Refund' : (REF[key as keyof typeof REF] ?? key));

const RefsCell: Cell = ({ item }) => {
  // The approval link already has its own button in the outcome column.
  const refs = Object.entries(item.refs).filter(([, v]) => v !== item.outcome?.link);
  return (
    <dl className="cell refs">
      {[[KIND[item.kind], item.paypalId], ...refs.map(([k, v]) => [refLabel(k), v, k])].map(([label, value, key]) => (
        <div key={key ?? label}>
          <dt>{label}</dt>
          <dd>{value.startsWith('http') ? <a href={value}>Open in PayPal sandbox</a> : <CopyId value={value} />}</dd>
        </div>
      ))}
    </dl>
  );
};

// Columns. A column without a width takes the room that is left.

type Col = { head: string; cell: Cell; width?: number };

const PLAN: Col[] = [
  { head: 'Merchant', cell: MerchantCell, width: 132 },
  { head: 'Item', cell: ItemCell, width: 190 },
  { head: 'Status', cell: StatusCell, width: 104 },
  { head: 'Action', cell: ActionCell, width: 196 },
  { head: 'Refund', cell: RefundCell, width: 256 },
  { head: 'The agent’s reason', cell: ReasonCell },
];
const DONE: Col[] = [
  { head: 'Merchant', cell: MerchantCell, width: 132 },
  { head: 'Item', cell: ItemCell, width: 190 },
  { head: 'Decision', cell: DecisionCell, width: 170 },
  { head: 'Outcome', cell: OutcomeCell },
  { head: 'PayPal references', cell: RefsCell, width: 300 },
];

const defs = (cols: Col[]): ColDef<Item>[] =>
  cols.map((c) => ({
    headerName: c.head,
    cellRenderer: (p: { data?: Item }) => (p.data ? <c.cell item={p.data} /> : null),
    ...(c.width ? { width: c.width } : { flex: 1, minWidth: 190 }),
    autoHeight: true,
  }));
const PLAN_DEFS = defs(PLAN);
const DONE_DEFS = defs(DONE);
const rowId: GetRowIdFunc<Item> = (p) => p.data.id;

function Items({ items, done }: { items: Item[]; done?: boolean }) {
  const cols = done ? DONE : PLAN;
  return (
    <>
      <div className="plan-grid grid--lead">
        <AgGridReact<Item>
          {...gridDefaults}
          rowData={items}
          columnDefs={done ? DONE_DEFS : PLAN_DEFS}
          getRowId={rowId}
          domLayout="autoHeight"
        />
      </div>
      <table className="itable">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.head} scope="col">
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              {cols.map((c) => (
                <td key={c.head} data-label={c.head}>
                  <c.cell item={item} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Plan(
  p: Shared & { c: Case; error: string; onApprove: () => void; onRun: (phase: Phase) => void; onEdit: () => void },
) {
  const { c, locked } = p;
  const filed = c.tier === 'filed';
  const read = c.document.extracted;
  return (
    <Ctx.Provider value={p}>
      <section className="stack" aria-labelledby="plan-h">
        <div className="stack--tight">
          <h2 id="plan-h">The plan</h2>
          <p>
            {c.paused
              ? 'Every active subscription is paused. Nothing has been closed or refunded.'
              : filed
                ? 'Nothing has been carried out yet. Change any row now, and approve once the document is matched.'
                : 'Nothing has been carried out yet. Change any row, then approve.'}
          </p>
        </div>

        {filed && (
          <div className="well stack--tight">
            <h3>Why the document was not matched</h3>
            <ul className="list">
              {c.document.mismatches.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {read && (
              <dl className="facts">
                <dt>Name on the document</dt>
                <dd>{read.fullName ?? 'Not found'}</dd>
                <dt>Date of death on the document</dt>
                <dd>{read.dateOfDeath ? day(read.dateOfDeath) : 'Not found'}</dd>
                <dt>Kind of document</dt>
                <dd>{read.kind ?? 'Not recognised'}</dd>
              </dl>
            )}
          </div>
        )}

        {c.notes.length > 0 && (
          <div className="well stack--tight">
            <h3>Notes from the agent</h3>
            <ul className="list">
              {c.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {c.items.length ? (
          <Items items={c.items} />
        ) : (
          <p className="well">The agent found nothing running at the three merchants for these email addresses.</p>
        )}

        <div className="stack--tight no-print">
          <div className="actions">
            <button
              className={filed ? 'btn btn--quiet' : 'btn'}
              type="button"
              onClick={p.onApprove}
              disabled={locked || filed || !c.items.length}
              aria-describedby={filed ? 'approve-why' : undefined}
            >
              Approve and carry out
            </button>
            {filed && !c.paused && (
              <button className="btn" type="button" onClick={() => p.onRun('pause')} disabled={locked}>
                Pause everything for now
              </button>
            )}
            {c.paused && (
              <button className={filed ? 'btn' : 'btn btn--quiet'} type="button" onClick={() => p.onRun('resume')} disabled={locked}>
                Resume everything
              </button>
            )}
            <button className="btn btn--quiet" type="button" onClick={p.onEdit} disabled={locked}>
              Edit the notice
            </button>
            <button className="btn btn--quiet" type="button" onClick={() => p.onRun('plan')} disabled={locked}>
              Plan again
            </button>
          </div>
          {filed && (
            <p className="help" id="approve-why">
              Approval is off because the document has not been matched. Pausing can be undone, so it is available now.
            </p>
          )}
          {p.error && (
            <p className="error" role="alert">
              {p.error}
            </p>
          )}
        </div>
      </section>
    </Ctx.Provider>
  );
}

/** The statement is plain text: a blank line parts paragraphs, and lines that start with "- " are a list. */
function Statement({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const list = line.startsWith('- ');
    const last = blocks.at(-1);
    if (!line.trim()) blocks.push({ list: false, lines: [] });
    else if (last?.lines.length && last.list === list) last.lines.push(list ? line.slice(2) : line);
    else blocks.push({ list, lines: [list ? line.slice(2) : line] });
  }
  return blocks.map((b, i) =>
    b.list ? (
      <ul key={i} className="list">
        {b.lines.map((l, j) => (
          <li key={j}>{l}</li>
        ))}
      </ul>
    ) : (
      b.lines.length > 0 && <p key={i}>{b.lines.join('\n')}</p>
    ),
  );
}

export function Done({ c, locked, error, onRetry, onCheck }: { c: Case; locked: boolean; error: string; onRetry: () => void; onCheck: () => void }) {
  // Approved, back under review and nothing running means the run stopped with an error before every row had an outcome.
  // While a run is starting the status is still "review" for a moment, which is not a stop.
  const stopped = c.status === 'review' && !locked;
  const verified = c.items.filter((i) => i.outcome?.verified);
  const count = (a: Action) => verified.filter((i) => i.decided?.action === a).length;
  const refunded = verified.reduce((n, i) => n + (i.decided?.refunds ?? []).reduce((m, r) => m + cents(r.amount), 0), 0);
  const pending = verified.filter((i) => i.decided?.action === 'take_over' && i.outcome?.state === 'waiting').length;
  const waiting = pending > 0;
  return (
    <section className="stack" aria-labelledby="done-h">
      <div className="stack--tight">
        <h2 id="done-h">
          {c.status === 'done' ? 'What was done' : stopped ? 'The plan stopped before it was finished' : 'Carrying out the plan'}
        </h2>
        {stopped && <p>Steps that were already carried out are not repeated.</p>}
      </div>
      <Items items={c.items} done />

      {stopped && (
        <div className="stack--tight no-print">
          <div className="actions">
            <button className="btn" type="button" onClick={onRetry} disabled={locked}>
              Carry out again
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {waiting && (
        <div className="stack--tight no-print">
          <p>
            A take-over starts when {c.representative.name} approves the new subscription at PayPal. The old one stays paused until then, and is
            cancelled as soon as the new one is approved.
          </p>
          <div className="actions">
            <button className="btn btn--quiet" type="button" onClick={onCheck} disabled={locked}>
              Check for approval
            </button>
          </div>
        </div>
      )}

      {c.status === 'done' && (
        <dl className="stats no-print">
          <div>
            <dt>Refunded</dt>
            <dd>{dollars(refunded)}</dd>
          </div>
          <div>
            <dt>Closed</dt>
            <dd>{count('close')}</dd>
          </div>
          <div>
            <dt>Taken over</dt>
            <dd>{count('take_over') - pending}</dd>
          </div>
          {pending > 0 && (
            <div>
              <dt>Waiting for approval</dt>
              <dd>{pending}</dd>
            </div>
          )}
          <div>
            <dt>Waived</dt>
            <dd>{count('waive')}</dd>
          </div>
        </dl>
      )}

      {c.statement && (
        <div className="stack--tight closing">
          <div className="split">
            <h2>Closing statement</h2>
            <button className="btn btn--quiet" type="button" onClick={() => window.print()}>
              Print this statement
            </button>
          </div>
          <article className="statement">
            <span className="statement__mark">Handover</span>
            <div className="statement__text">
              <Statement text={c.statement} />
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

