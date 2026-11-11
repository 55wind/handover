'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Activity } from '@/components/Activity';
import { DemoButton } from '@/components/DemoButton';
import { NoticeForm, type Notice } from '@/components/NoticeForm';
import { Done, Plan, type Decide } from '@/components/Plan';
import { TIER, day } from '@/components/ui';
import type { Case, Phase } from '@/lib/types';

const STEPS = ['Notice', 'Plan', 'Done'];
const FAILED = 'That did not go through. Try again in a moment.';

async function api(path: string, method = 'GET', body?: unknown): Promise<{ status: number; data: any }> {
  try {
    const r = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const base = `/api/cases/${id}`;
  const [c, setCase] = useState<Case | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'gone' | 'failed'>('loading');
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    let stream: EventSource | undefined;

    async function fetchCase() {
      const r = await api(base);
      if (!live) return false;
      if (r.status === 200) setCase(r.data);
      setLoad(r.status === 200 ? 'ready' : r.status === 404 ? 'gone' : 'failed');
      return r.status === 200;
    }

    fetchCase().then((ok) => {
      if (!ok || !live) return;
      stream = new EventSource(`${base}/events`);
      stream.onmessage = (m) => setCase(JSON.parse(m.data).case);
      // The browser reconnects by itself after a dropped connection. It gives up only when the server
      // answers with an error, which is what happens once a restart has cleared the case.
      stream.onerror = () => {
        if (stream?.readyState === EventSource.CLOSED) fetchCase();
      };
    });

    return () => {
      live = false;
      stream?.close();
    };
  }, [base]);

  /** Asks the server to complete any take-over the family member has approved at PayPal. */
  async function checkApproval() {
    const r = await api(`${base}/finalize`, 'POST');
    if (r.status === 200) setCase(r.data);
    return r.status === 200 ? '' : (r.data?.error ?? FAILED);
  }
  // PayPal sends the family member back here with the subscription they approved.
  useEffect(() => {
    if (load !== 'ready' || !new URLSearchParams(window.location.search).has('subscription_id')) return;
    window.history.replaceState(null, '', window.location.pathname);
    checkApproval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** Sends one request, or a short chain of them, with the controls disabled meanwhile. */
  async function send(steps: () => Promise<string>) {
    setSending(true);
    setError('');
    setError(await steps());
    setSending(false);
  }

  /** Both return an empty string when the server accepted the request, and its reason when it did not. */
  async function patch(body: unknown) {
    const r = await api(base, 'PATCH', body);
    if (r.status === 200) setCase(r.data);
    return r.status === 200 ? '' : (r.data?.error ?? FAILED);
  }
  async function run(phase: Phase) {
    const r = await api(`${base}/run`, 'POST', { phase });
    if (r.status === 409) return 'The agent is already working on this case. Wait for it to finish.';
    return r.status === 202 ? '' : (r.data?.error ?? FAILED);
  }

  const fileNotice = (notice: Notice) =>
    send(async () => {
      const problem = await patch({ notice });
      if (problem) return problem;
      setEditing(false);
      return run('intake');
    });
  const approve = () => send(async () => (await patch({ approve: true })) || run('execute'));
  const decide: Decide = async (item, action, refundCaptureIds) => {
    const problem = await patch({ decisions: [{ itemId: item.id, action, refundCaptureIds }] });
    // The message is shown in its own row, so the item id the server puts in front of it is dropped.
    // A change that goes through clears earlier refusals; a refusal stays on its own row.
    setRowErrors((e) => (problem ? { ...e, [item.id]: problem.replace(/^Item \S+: /, '') } : {}));
  };

  if (load === 'loading') {
    return (
      <div className="container page">
        <p role="status">Opening the case.</p>
      </div>
    );
  }
  if (load !== 'ready' || !c) {
    return (
      <div className="container page">
        <div className="page-head">
          <h1>{load === 'gone' ? 'This demo case is no longer available' : 'The case could not be opened'}</h1>
          <p>
            {load === 'gone'
              ? 'Demo cases are kept in memory and are cleared when the server restarts. A new one takes a few seconds.'
              : 'The server did not answer. Reload the page, or start a new demo case.'}
          </p>
        </div>
        <DemoButton label="Start a new demo case" />
      </div>
    );
  }

  // Once the plan is approved the page shows outcomes, also when a run stopped and has to be carried out again.
  const approved = !!c.approvedAt;
  // While the agent is reading the notice the form steps aside for the activity.
  const noticeOpen = !approved && c.running === null && (c.status === 'notice' || editing);
  const step = approved ? 2 : noticeOpen ? 0 : 1;
  const locked = sending || c.running !== null;

  return (
    <div className="container page">
      <header className="page-head">
        <h1>The estate of {c.deceased.fullName}</h1>
        {step > 0 && (
          <p className="muted">
            Filed by {c.representative.name}, {c.representative.relation}. Date of death {day(c.deceased.dateOfDeath)}.
          </p>
        )}
        <ol className="rail no-print" aria-label="Steps">
          {STEPS.map((name, i) => (
            <li key={name} className={i < step ? 'is-past' : undefined} aria-current={i === step ? 'step' : undefined}>
              {name}
            </li>
          ))}
        </ol>
        {step > 0 && <p className="no-print">{TIER[c.tier]}</p>}
      </header>

      {noticeOpen && (
        <NoticeForm
          c={c}
          locked={locked}
          error={error}
          onFile={fileNotice}
          onCancel={c.status === 'review' ? () => setEditing(false) : undefined}
        />
      )}
      {(c.events.length > 0 || c.running) && <Activity events={c.events} running={c.running} />}
      {!approved && !editing && c.status === 'review' && (
        <Plan
          c={c}
          locked={locked}
          error={error}
          decide={decide}
          errors={rowErrors}
          onApprove={approve}
          onRun={(phase) => send(() => run(phase))}
          onEdit={() => setEditing(true)}
        />
      )}
      {approved && <Done c={c} locked={locked} error={error} onRetry={() => send(() => run('execute'))} onCheck={() => send(checkApproval)} />}
    </div>
  );
}
