'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const FAILED: Record<number, string> = {
  0: 'The server could not be reached. Check your connection and try again.',
  429: 'Today’s demo limit has been reached. Try again tomorrow.',
  503: 'The PayPal sandbox is not configured on this server, so the demo cannot run.',
};

export function DemoButton({ label = 'Try the demo case' }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true);
    setError('');
    let status = 0;
    let reason: string | undefined;
    try {
      const r = await fetch('/api/demo', { method: 'POST' });
      status = r.status;
      const data = await r.json().catch(() => null);
      if (r.ok && data?.caseId) return router.push(`/case/${data.caseId}`);
      reason = data?.error;
    } catch {}
    setError(FAILED[status] ?? reason ?? 'The demo case could not be created. Try again in a minute.');
    setBusy(false);
  }

  return (
    <div className="demo">
      <button className="btn" type="button" onClick={start} disabled={busy} aria-busy={busy}>
        {label}
      </button>
      <div className="demo__status" role="status">
        {busy && <div className="progress" />}
        {busy && 'Creating a fresh sandbox estate at three merchants. This takes a few seconds.'}
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
