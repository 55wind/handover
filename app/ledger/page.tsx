'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { stamp, usd } from '@/components/format';
import { gridDefaults, gridTheme } from '@/components/grid';
import { CopyId, api } from '@/components/ui';
import type { LedgerRow, TreatStatus } from '@/lib/types';

interface Ledger {
  rows: LedgerRow[];
  totals: { treats: number; enjoyed: number; held: string; charged: string; released: string };
  fake: boolean;
  scripted: boolean;
}

const STATUS: Record<TreatStatus, string> = {
  draft: 'Being written',
  approving: 'Waiting for PayPal',
  held: 'Held',
  settling: 'At the counter',
  enjoyed: 'Enjoyed',
  released: 'Released',
};

// Blue while PayPal holds the money, green once the meal is eaten, slate for everything else.
const TONE: Partial<Record<TreatStatus, string>> = { held: ' pill--held', settling: ' pill--held', enjoyed: ' pill--success' };

const StatusCell = ({ data: row }: { data?: LedgerRow }) => row && <span className={`pill${TONE[row.status] ?? ''}`}>{STATUS[row.status] ?? row.status}</span>;

const ConfirmedCell = ({ data: row }: { data?: LedgerRow }) => row && <span className={`pill${row.verified ? ' pill--success' : ''}`}>{row.verified ? 'Yes' : 'Not yet'}</span>;

const IdsCell = ({ data: row }: { data?: LedgerRow }) => {
  if (!row) return null;
  const ids: [string, string | undefined][] = [
    ['Order', row.paypal.orderId],
    ['Hold', row.paypal.authorizationId],
    ['Capture', row.paypal.captureId],
    ['Payout', row.paypal.payoutId],
  ];
  return (
    <dl className="refs">
      {ids.map(
        ([label, id]) =>
          id && (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <CopyId value={id} />
                {label === 'Payout' && row.paypal.payoutStatus && <span className="small muted">{row.paypal.payoutStatus.toLowerCase()}</span>}
              </dd>
            </div>
          ),
      )}
    </dl>
  );
};

const wrap = { wrapText: true, autoHeight: true };
const money = { width: 108, type: 'rightAligned', valueFormatter: (p: { value: unknown }) => usd(p.value as string | undefined) };
const COLUMNS: ColDef<LedgerRow>[] = [
  { headerName: 'Time', field: 'ts', width: 124, valueFormatter: (p) => stamp(p.value) },
  { headerName: 'Treat', field: 'ref', width: 112, cellClass: 'mono' },
  { headerName: 'Status', field: 'status', width: 196, cellRenderer: StatusCell },
  { headerName: 'City', field: 'city', width: 128 },
  { headerName: 'Shop', field: 'shopName', width: 188, ...wrap },
  { headerName: 'Dish', field: 'item', width: 196, ...wrap },
  { headerName: 'Held', field: 'held', ...money },
  { headerName: 'Charged', field: 'charged', ...money },
  { headerName: 'Released', field: 'released', ...money },
  { headerName: 'Sent by', colId: 'sentBy', width: 144, valueGetter: (p) => (p.data?.viaAgent ? 'An AI assistant' : 'A person') },
  { headerName: 'Confirmed with PayPal', colId: 'confirmed', width: 184, valueGetter: (p) => (p.data?.verified ? 'Yes' : 'Not yet'), cellRenderer: ConfirmedCell },
  { headerName: 'PayPal ids', flex: 1, minWidth: 264, cellRenderer: IdsCell, ...wrap },
];
// The ledger grows with its rows up to about eight of them, then scrolls inside itself. A row's state is in its
// pill, so no row is tinted except the one under the pointer.
const ledgerTheme = gridTheme.withParams({ autoHeightMaxBodyHeight: 640 });

export default function LedgerPage() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    async function load() {
      const r = await api('/api/ledger');
      const ok = r.status === 200 && Array.isArray(r.data?.rows);
      setFailed(!ok);
      // An unchanged answer keeps the old object, so the grid is not redrawn every five seconds.
      if (ok) setLedger((old) => (JSON.stringify(old) === JSON.stringify(r.data) ? old : r.data));
    }
    void load();
    const timer = setInterval(() => !document.hidden && void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  const rows = ledger?.rows ?? [];
  const totals = ledger?.totals;

  return (
    <div className="container page">
      <header className="page-head">
        <h1>Every treat</h1>
        <p>
          Held means PayPal has set the amount aside on the sender’s account. It has not been taken. Only what is charged leaves
          the sender, when the meal is eaten, and the rest is released.
        </p>
        <p className="small muted">The list refreshes every five seconds. Names and cards are not shown here.</p>
      </header>

      <section className="stack" aria-labelledby="totals-h">
        <h2 id="totals-h" className="sr">
          Totals
        </h2>
        {totals && (
          <dl className="stats">
            <div>
              <dt>Treats</dt>
              <dd>{totals.treats}</dd>
            </div>
            <div>
              <dt>Enjoyed</dt>
              <dd>{totals.enjoyed}</dd>
            </div>
            <div>
              <dt>Held</dt>
              <dd>{usd(totals.held)}</dd>
            </div>
            <div>
              <dt>Charged</dt>
              <dd>{usd(totals.charged)}</dd>
            </div>
            <div>
              <dt>Released</dt>
              <dd>{usd(totals.released)}</dd>
            </div>
          </dl>
        )}
        <div role="status">
          {failed && <p className="error">The ledger could not be loaded. It is tried again every five seconds.</p>}
          {!ledger && !failed && <p className="muted">Loading the ledger.</p>}
          {ledger && rows.length === 0 && (
            <p className="well">
              No treats yet. <Link href="/send">Send one</Link> and it appears here, whether it is eaten or released.
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <div className="ledger">
            <AgGridReact<LedgerRow>
              {...gridDefaults}
              theme={ledgerTheme}
              rowData={rows}
              columnDefs={COLUMNS}
              getRowId={(p) => p.data.ref}
              domLayout="autoHeight"
            />
          </div>
        )}
      </section>
    </div>
  );
}
